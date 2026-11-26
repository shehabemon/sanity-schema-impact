import { describe, expect, it } from 'vitest';
import {
  COMMENT_BODY_LIMIT,
  TRUNCATION_NOTE,
  fitCommentBody,
  findMarkedComment,
  nextPageUrl,
  readPullRequestContext,
  upsertComment,
  type FetchLike,
  type IssueComment,
} from '../../src/github/comment.js';

const MARKER = '<!-- sanity-schema-impact -->';
const TOKEN = 'ghs_token_value_for_test';
const API = 'https://api.github.com';
const ISSUES = `${API}/repos/acme/shop/issues/7/comments`;

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function comment(id: number, body: string, createdAt = `2026-01-0${String(id)}T00:00:00Z`) {
  return { id, body, created_at: createdAt };
}

function fakeGitHub(respond: (call: Call) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: input,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetch, calls };
}

describe('findMarkedComment', () => {
  it('returns the newest comment that starts with the marker', () => {
    const comments: IssueComment[] = [
      { id: 3, body: `${MARKER}\nnewer`, created_at: '2026-03-01T00:00:00Z' },
      { id: 1, body: `${MARKER}\nold`, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, body: `${MARKER}\nmiddle`, created_at: '2026-02-01T00:00:00Z' },
    ];

    expect(findMarkedComment(comments, MARKER)?.id).toBe(3);
  });

  it('ignores a comment that only quotes the marker', () => {
    const comments = [
      { id: 1, body: `Quoting ${MARKER} here`, created_at: '2026-01-01T00:00:00Z' },
    ];

    expect(findMarkedComment(comments, MARKER)).toBeUndefined();
  });

  it('returns nothing when no comment has the marker', () => {
    expect(findMarkedComment([comment(1, 'hello')], MARKER)).toBeUndefined();
  });
});

describe('readPullRequestContext', () => {
  const env = { GITHUB_REPOSITORY: 'acme/shop' };

  it('reads the repository and the pull request number', () => {
    const event = { action: 'synchronize', pull_request: { number: 7 } };

    expect(readPullRequestContext(event, env)).toEqual({ owner: 'acme', repo: 'shop', number: 7 });
  });

  it('returns null for a push event', () => {
    expect(readPullRequestContext({ ref: 'refs/heads/main' }, env)).toBeNull();
  });

  it('returns null for a comment on an issue', () => {
    expect(readPullRequestContext({ issue: { number: 7 } }, env)).toBeNull();
  });

  it('refuses a repository name that is not owner/repo', () => {
    const event = { pull_request: { number: 7 } };

    expect(() => readPullRequestContext(event, { GITHUB_REPOSITORY: 'shop' })).toThrow(
      'GITHUB_REPOSITORY must be owner/repo.',
    );
  });
});

describe('nextPageUrl', () => {
  it('finds the rel="next" link among several', () => {
    const header = `<${ISSUES}?page=3>; rel="last", <${ISSUES}?page=2>; rel="next"`;

    expect(nextPageUrl(header)).toBe(`${ISSUES}?page=2`);
  });

  it('returns nothing without a next link', () => {
    expect(nextPageUrl(null)).toBeUndefined();
    expect(nextPageUrl(`<${ISSUES}?page=1>; rel="prev"`)).toBeUndefined();
  });
});

describe('fitCommentBody', () => {
  it('leaves a body that fits unchanged', () => {
    expect(fitCommentBody('short report')).toBe('short report');
  });

  it('cuts at a line break and points to the job summary', () => {
    const line = `${'x'.repeat(99)}\n`;
    const body = line.repeat(Math.ceil(COMMENT_BODY_LIMIT / line.length) + 10);

    const fitted = fitCommentBody(body);
    const kept = fitted.slice(0, fitted.length - ('\n\n' + TRUNCATION_NOTE).length);

    expect(fitted.length).toBeLessThanOrEqual(COMMENT_BODY_LIMIT);
    expect(fitted.endsWith(TRUNCATION_NOTE)).toBe(true);
    expect(body.startsWith(kept)).toBe(true);
    expect(body[kept.length]).toBe('\n');
  });

  it('never leaves half of a surrogate pair at the end', () => {
    const budget = COMMENT_BODY_LIMIT - ('\n\n' + TRUNCATION_NOTE).length;
    const body = `${'a'.repeat(budget - 1)}${'😀'.repeat(10)}`;

    const fitted = fitCommentBody(body);

    expect(fitted.length).toBeLessThanOrEqual(COMMENT_BODY_LIMIT);
    expect(() => encodeURIComponent(fitted)).not.toThrow();
  });
});

describe('upsertComment', () => {
  const base = { token: TOKEN, owner: 'acme', repo: 'shop', number: 7, body: `${MARKER}\nreport` };

  it('creates a comment when none carries the marker', async () => {
    const { fetch, calls } = fakeGitHub((call) =>
      call.method === 'GET' ? json([comment(1, 'hello')]) : json({ id: 9 }, 201),
    );

    const result = await upsertComment({ ...base, fetch });

    expect(result).toEqual({ action: 'created', id: 9 });
    expect(calls[1]).toMatchObject({ method: 'POST', url: ISSUES, body: { body: base.body } });
    expect(calls[0]?.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
    });
  });

  it('updates the marked comment in place', async () => {
    const { fetch, calls } = fakeGitHub((call) =>
      call.method === 'GET'
        ? json([comment(4, `${MARKER}\nold report`), comment(5, 'thanks')])
        : json({ id: 4 }),
    );

    const result = await upsertComment({ ...base, fetch });

    expect(result).toEqual({ action: 'updated', id: 4 });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      url: `${API}/repos/acme/shop/issues/comments/4`,
      body: { body: base.body },
    });
  });

  it('follows the Link header to find a marked comment on a later page', async () => {
    const next = `${ISSUES}?per_page=100&page=2`;
    const { fetch, calls } = fakeGitHub((call) => {
      const page = new URL(call.url).searchParams.get('page');
      if (call.method === 'PATCH') return json({ id: 42 });
      if (page === null) {
        return json([comment(1, 'first page')], 200, { link: `<${next}>; rel="next"` });
      }
      return json([comment(42, `${MARKER}\nold`)]);
    });

    const result = await upsertComment({ ...base, fetch });

    expect(result).toEqual({ action: 'updated', id: 42 });
    expect(calls[0]?.url).toBe(`${ISSUES}?per_page=100`);
    expect(calls[1]?.url).toBe(next);
  });

  it('truncates a body over the limit and keeps the marker', async () => {
    const line = `${'y'.repeat(120)}\n`;
    const body = `${MARKER}\n${line.repeat(Math.ceil(COMMENT_BODY_LIMIT / line.length) + 5)}`;
    const { fetch, calls } = fakeGitHub((call) =>
      call.method === 'GET' ? json([]) : json({ id: 1 }, 201),
    );

    await upsertComment({ ...base, body, fetch });

    const sent = (calls[1]?.body as { body: string }).body;
    expect(sent.length).toBeLessThanOrEqual(COMMENT_BODY_LIMIT);
    expect(sent.startsWith(MARKER)).toBe(true);
    expect(sent.endsWith(TRUNCATION_NOTE)).toBe(true);
  });

  it('reports the status and the API message, and never the token', async () => {
    const { fetch } = fakeGitHub(() =>
      json({ message: `Resource not accessible. Token ${TOKEN} rejected` }, 403),
    );

    const error: unknown = await upsertComment({ ...base, fetch }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('status 403');
    expect(message).toContain('Resource not accessible');
    expect(message).not.toContain(TOKEN);
  });

  it('refuses to follow a Link header that leaves the API host', async () => {
    const { fetch, calls } = fakeGitHub(() =>
      json([], 200, { link: '<https://elsewhere.example/comments?page=2>; rel="next"' }),
    );

    await expect(upsertComment({ ...base, fetch })).rejects.toThrow('outside the API host');
    expect(calls).toHaveLength(1);
  });

  it('talks to a GitHub Enterprise API URL when one is given', async () => {
    const { fetch, calls } = fakeGitHub((call) =>
      call.method === 'GET' ? json([]) : json({ id: 3 }, 201),
    );

    await upsertComment({ ...base, fetch, apiUrl: 'https://ghe.example.com/api/v3/' });

    expect(calls[0]?.url).toBe(
      'https://ghe.example.com/api/v3/repos/acme/shop/issues/7/comments?per_page=100',
    );
  });
});
