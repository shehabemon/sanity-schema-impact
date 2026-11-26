import { redact } from '../adapters/process.js';
import { COMMENT_MARKER } from '../report/markdown.js';

/** GitHub rejects issue comment bodies longer than this. */
export const COMMENT_BODY_LIMIT = 65_536;

export const TRUNCATION_NOTE =
  "The report was cut to fit GitHub's comment size limit. The full report is in the job summary.";

const DEFAULT_API_URL = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_ERROR_MESSAGE = 200;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface IssueComment {
  readonly id: number;
  readonly body: string;
  readonly created_at: string;
}

export interface PullRequestContext {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface UpsertOptions {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly body: string;
  /** The marker the comment starts with. Defaults to the report marker. */
  readonly marker?: string;
  /** GitHub Enterprise Server API root. Defaults to api.github.com. */
  readonly apiUrl?: string;
  readonly fetch?: FetchLike;
}

export interface UpsertResult {
  readonly action: 'created' | 'updated';
  readonly id: number;
}

interface ApiReply {
  readonly data: unknown;
  readonly link: string | null;
}

type ApiCall = (method: string, url: string, payload?: unknown) => Promise<ApiReply>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The newest comment whose body starts with `marker`. Matching on the marker alone is deliberate:
 * a token passed as `github-token` may be a personal token, and its comments are authored by a
 * user, not a bot. Filtering on the bot type would then post a new comment on every run.
 */
export function findMarkedComment(
  comments: readonly IssueComment[],
  marker: string,
): IssueComment | undefined {
  let found: IssueComment | undefined;
  for (const comment of comments) {
    if (!comment.body.trimStart().startsWith(marker)) continue;
    if (found === undefined || isNewer(comment, found)) found = comment;
  }
  return found;
}

function isNewer(a: IssueComment, b: IssueComment): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

/**
 * The pull request an event refers to, or null when the event isn't a pull request event. A
 * malformed repository name on a pull request event is an error, not a skip.
 */
export function readPullRequestContext(
  event: unknown,
  env: Readonly<Record<string, string | undefined>>,
): PullRequestContext | null {
  if (!isRecord(event) || !isRecord(event['pull_request'])) return null;
  const number = event['pull_request']['number'];
  if (typeof number !== 'number') return null;

  const [owner, repo, ...rest] = (env['GITHUB_REPOSITORY'] ?? '').split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error('GITHUB_REPOSITORY must be owner/repo.');
  }
  return { owner, repo, number };
}

/** The `rel="next"` URL from a Link header, if there is one. */
export function nextPageUrl(linkHeader: string | null): string | undefined {
  if (linkHeader === null) return undefined;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/**
 * Cuts a body to GitHub's limit. The cut moves back to a line break when one falls in the second
 * half of the budget, so a table row or code line isn't left half-written. It never splits a
 * surrogate pair. The note goes last.
 */
export function fitCommentBody(body: string): string {
  if (body.length <= COMMENT_BODY_LIMIT) return body;

  const note = `\n\n${TRUNCATION_NOTE}`;
  const budget = COMMENT_BODY_LIMIT - note.length;
  let kept = body.slice(0, budget);
  const lineBreak = kept.lastIndexOf('\n');
  if (lineBreak > budget / 2) kept = kept.slice(0, lineBreak);
  if (isHighSurrogate(kept.charCodeAt(kept.length - 1))) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}${note}`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function parseComment(value: unknown): IssueComment {
  if (!isRecord(value) || typeof value['id'] !== 'number') {
    throw new Error('GitHub API returned a comment without an id.');
  }
  return {
    id: value['id'],
    body: typeof value['body'] === 'string' ? value['body'] : '',
    created_at: typeof value['created_at'] === 'string' ? value['created_at'] : '',
  };
}

/**
 * Creates the pull request comment, or updates the one that starts with the marker. Every page
 * of comments is read first, following the Link header. A Link header that points off the API
 * host is refused, so the token never goes anywhere else.
 */
export async function upsertComment(options: UpsertOptions): Promise<UpsertResult> {
  const { token, owner, repo, number } = options;
  const marker = options.marker ?? COMMENT_MARKER;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const apiRoot = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const repoPath = `${apiRoot}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const body = fitCommentBody(options.body);

  const call: ApiCall = (method, url, payload) =>
    apiRequest({ fetchFn, token, method, url, payload });

  const comments = await listComments(
    call,
    `${repoPath}/issues/${String(number)}/comments`,
    apiRoot,
  );
  const existing = findMarkedComment(comments, marker);
  if (existing !== undefined) {
    const updated = parseComment(
      (await call('PATCH', `${repoPath}/issues/comments/${String(existing.id)}`, { body })).data,
    );
    return { action: 'updated', id: updated.id };
  }
  const created = parseComment(
    (await call('POST', `${repoPath}/issues/${String(number)}/comments`, { body })).data,
  );
  return { action: 'created', id: created.id };
}

interface RequestOptions {
  readonly fetchFn: FetchLike;
  readonly token: string;
  readonly method: string;
  readonly url: string;
  readonly payload: unknown;
}

async function apiRequest(options: RequestOptions): Promise<ApiReply> {
  const { fetchFn, token, method, url, payload } = options;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'sanity-schema-impact',
  };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const label = `${method} ${new URL(url).pathname}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(redact(`GitHub API ${label} could not be reached: ${reason}`, [token]));
  }
  if (!response.ok) {
    const message = await apiMessage(response);
    const status = String(response.status);
    throw new Error(
      redact(`GitHub API ${label} failed with status ${status}: ${message}`, [token]),
    );
  }
  const data: unknown = await response.json();
  return { data, link: response.headers.get('link') };
}

async function listComments(
  call: ApiCall,
  firstUrl: string,
  apiRoot: string,
): Promise<IssueComment[]> {
  const comments: IssueComment[] = [];
  const origin = new URL(apiRoot).origin;
  const seen = new Set<string>();
  let url: string | undefined = `${firstUrl}?per_page=${String(PAGE_SIZE)}`;

  while (url !== undefined) {
    if (seen.has(url)) throw new Error('GitHub API pagination repeated a page.');
    seen.add(url);

    const reply = await call('GET', url);
    if (!Array.isArray(reply.data)) throw new Error('GitHub API returned no comment list.');
    comments.push(...reply.data.map(parseComment));

    url = nextPageUrl(reply.link);
    if (url !== undefined && new URL(url).origin !== origin) {
      throw new Error('Refusing to follow a page link outside the API host.');
    }
  }
  return comments;
}

async function apiMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  let message = response.statusText;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed['message'] === 'string') message = parsed['message'];
  } catch {
    // Not JSON: keep the status text.
  }
  return message.slice(0, MAX_ERROR_MESSAGE);
}
