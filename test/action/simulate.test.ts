import { execFile, spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseActionFile, type ActionStep } from './parse-action.js';

/**
 * Runs the shell steps of action.yml offline. Three things are replaced: the build step (it
 * needs the registry), the setup-node `uses:` step, and the check itself (it needs live Sanity
 * access). The check is answered by a launcher that records its arguments. The comment
 * subcommand runs the real source through tsx, and its API calls go to a local HTTP server.
 */

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const actionText = await readFileText(join(repoRoot, 'action.yml'));
const action = parseActionFile(actionText);
const SKIPPED_BY_TEST = new Set(['Build the schema impact CLI']);
const TOKEN_GATE = 'sanity-viewer-token-for-test';
const RUNNER_TOKEN = 'github-runner-token-for-test';
const REPORT = '<!-- sanity-schema-impact -->\n## Schema impact\n\nNo schema changes found.\n';
const tsxLoader = createRequire(import.meta.url).resolve('tsx/esm');

async function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

interface ApiRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

let server: Server;
let apiRoot: string;
let apiRequests: ApiRequest[];
let existingComments: { id: number; body: string }[];
let scratch: string;
let workspace: string;
let actionDir: string;
let runCount = 0;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'action-sim-'));

  const origin = join(scratch, 'origin');
  const seed = join(scratch, 'seed');
  await mkdir(seed);
  await run('git', ['init', '-q', '-b', 'main', seed]);
  await writeFile(join(seed, 'README.md'), 'fixture\n');
  await run('git', ['-C', seed, 'add', '.']);
  await run('git', [
    '-C',
    seed,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '-m',
    'init',
  ]);
  await run('git', ['clone', '-q', '--bare', seed, origin]);
  workspace = join(scratch, 'workspace');
  await run('git', ['clone', '-q', '--depth', '1', `file://${origin}`, workspace]);

  actionDir = join(scratch, 'action');
  await mkdir(join(actionDir, 'dist'), { recursive: true });
  await writeFile(join(actionDir, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(actionDir, 'dist', 'cli.js'), launcherSource());

  server = createServer((request, response) => {
    void handleApi(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port.');
  apiRoot = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await rm(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  apiRequests = [];
  existingComments = [];
});

function launcherSource(): string {
  const cliSource = pathToFileURL(join(repoRoot, 'src', 'cli.ts')).href;
  return `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'comment') {
  await import(${JSON.stringify(cliSource)});
} else {
  appendFileSync(process.env.STUB_ARGV_LOG, JSON.stringify(args) + '\\n');
  process.stdout.write(${JSON.stringify(REPORT)});
  process.exitCode = Number(process.env.STUB_CHECK_EXIT ?? '0');
}
`;
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const method = request.method ?? 'GET';
  const url = request.url ?? '';
  apiRequests.push({
    method,
    url,
    authorization: request.headers.authorization,
    body: Buffer.concat(chunks).toString('utf8'),
  });

  const path = url.split('?')[0] ?? '';
  const json = (status: number, data: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data));
  };
  if (method === 'GET' && path === '/repos/acme/shop/issues/7/comments') {
    json(
      200,
      existingComments.map((c) => ({ ...c, created_at: '2026-01-01T00:00:00Z' })),
    );
  } else if (method === 'POST' && path === '/repos/acme/shop/issues/7/comments') {
    json(201, { id: 21 });
  } else if (method === 'PATCH' && path.startsWith('/repos/acme/shop/issues/comments/')) {
    json(200, { id: 11 });
  } else {
    json(404, { message: 'Not Found' });
  }
}

interface StepResult {
  readonly name: string;
  readonly status: 'ran' | 'skipped';
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Scenario {
  readonly event: 'pull_request' | 'push';
  readonly inputs?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly checkExit?: number;
}

interface Outcome {
  readonly steps: readonly StepResult[];
  readonly summary: string;
  readonly argv: string[];
  readonly output: string;
}

/** Input values as the runner resolves them: defaults first, then the scenario's overrides. */
function inputValues(
  overrides: Readonly<Record<string, string>>,
  github: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of action.inputs) {
    if (input.default !== undefined) values[input.name] = input.default;
  }
  const merged = { ...values, studio: 'fixtures/studio', ...overrides };
  const scope: Scope = { inputs: merged, github, steps: {} };
  return Object.fromEntries(
    Object.entries(merged).map(([name, value]) => [name, expand(value, scope)]),
  );
}

function lookup(path: string, scope: Scope): string {
  let value: unknown = scope;
  for (const part of path.split('.')) {
    value =
      value !== null && typeof value === 'object'
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof value !== 'string') throw new Error(`Unknown expression: ${path}`);
  return value;
}

interface Scope {
  readonly inputs: Record<string, string>;
  readonly github: Record<string, string>;
  readonly steps: Record<string, { outputs: Record<string, string> }>;
}

function expand(value: string, scope: Scope): string {
  return value.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_match, expr: string) => lookup(expr, scope));
}

/** Only `a == 'x'` and `a != 'x'` joined by `&&`, which is all this action uses. */
function holds(condition: string | undefined, scope: Scope): boolean {
  if (condition === undefined) return true;
  return condition.split('&&').every((term) => {
    const match = /^\s*([\w.-]+)\s*(==|!=)\s*'([^']*)'\s*$/.exec(term);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      throw new Error(`Unsupported condition in action.yml: ${term}`);
    }
    const actual = lookup(match[1], scope);
    return match[2] === '==' ? actual === match[3] : actual !== match[3];
  });
}

function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return outputs;
}

async function runAction(scenario: Scenario): Promise<Outcome> {
  runCount += 1;
  const runDir = join(scratch, `run-${String(runCount)}`);
  const temp = join(runDir, 'temp');
  await mkdir(temp, { recursive: true });
  const summaryFile = join(runDir, 'summary.md');
  const argvLog = join(runDir, 'argv.log');
  const eventFile = join(runDir, 'event.json');
  await writeFile(summaryFile, '');
  await writeFile(argvLog, '');
  const eventPayload =
    scenario.event === 'pull_request'
      ? { action: 'synchronize', pull_request: { number: 7 } }
      : { ref: 'refs/heads/main' };
  await writeFile(eventFile, JSON.stringify(eventPayload));

  const github = { token: RUNNER_TOKEN, event_name: scenario.event };
  const scope: Scope = {
    inputs: inputValues(scenario.inputs ?? {}, github),
    github,
    steps: {},
  };
  const baseEnv: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
    HOME: process.env['HOME'] ?? '',
    NODE_OPTIONS: `--import=${pathToFileURL(tsxLoader).href}`,
    GITHUB_ACTION_PATH: actionDir,
    GITHUB_WORKSPACE: workspace,
    GITHUB_EVENT_NAME: scenario.event,
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_BASE_REF: 'main',
    GITHUB_REPOSITORY: 'acme/shop',
    GITHUB_API_URL: apiRoot,
    RUNNER_TEMP: temp,
    SANITY_AUTH_TOKEN: TOKEN_GATE,
    STUB_ARGV_LOG: argvLog,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    STUB_CHECK_EXIT: String(scenario.checkExit ?? 0),
    ...(scenario.env ?? {}),
  };

  const results: StepResult[] = [];
  const outputFile = (index: number): string => join(runDir, `output-${String(index)}.txt`);

  for (const [index, step] of action.steps.entries()) {
    const skip = (reason: string): void => {
      results.push({ name: step.name, status: 'skipped', code: 0, stdout: reason, stderr: '' });
    };
    if (step.uses !== undefined) {
      skip('uses');
      continue;
    }
    if (SKIPPED_BY_TEST.has(step.name)) {
      skip('registry');
      continue;
    }
    if (!holds(step.if, scope)) {
      skip('if');
      continue;
    }

    const outFile = outputFile(index);
    await writeFile(outFile, '');
    const env = stepEnv(step, scope, {
      ...baseEnv,
      GITHUB_OUTPUT: outFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    });
    const result = await execScript(step, env);
    results.push({ name: step.name, status: 'ran', ...result });
    if (step.id !== undefined) {
      scope.steps[step.id] = { outputs: parseOutputs(await readFile(outFile, 'utf8')) };
    }
    if (result.code !== 0 && !step.continueOnError) break;
  }

  return {
    steps: results,
    summary: await readFile(summaryFile, 'utf8'),
    argv: await firstInvocation(argvLog),
    output: results.map((r) => `${r.stdout}${r.stderr}`).join('\n'),
  };
}

async function firstInvocation(path: string): Promise<string[]> {
  const first = (await readFile(path, 'utf8')).split('\n').find((line) => line !== '');
  return first === undefined ? [] : (JSON.parse(first) as string[]);
}

function stepEnv(
  step: ActionStep,
  scope: Scope,
  base: Record<string, string>,
): Record<string, string> {
  const env = { ...base };
  for (const [key, value] of Object.entries(step.env)) {
    env[key] = expand(value, scope);
  }
  return env;
}

async function execScript(
  step: ActionStep,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const script = step.run ?? '';
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: env['GITHUB_WORKSPACE'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const LONG = 60_000;

describe('action steps run offline', () => {
  it('skips every later step with a warning when the Sanity token is missing', async () => {
    const outcome = await runAction({ event: 'pull_request', env: { SANITY_AUTH_TOKEN: '' } });

    const gate = outcome.steps[0];
    expect(gate?.code).toBe(0);
    expect(gate?.stdout).toContain(
      '::warning::skipped: SANITY_AUTH_TOKEN is not available, which is expected for pull requests from forks',
    );
    expect(outcome.steps.slice(1).every((step) => step.status === 'skipped')).toBe(true);
    expect(outcome.argv).toEqual([]);
    expect(apiRequests).toEqual([]);
  });

  it(
    'fetches the base branch and runs the check against origin/main',
    async () => {
      const outcome = await runAction({ event: 'pull_request' });

      expect(outcome.argv).toEqual([
        '--base',
        'origin/main',
        '--studio',
        'fixtures/studio',
        '--format',
        'md',
      ]);
      expect(outcome.summary).toContain('## Schema impact');
    },
    LONG,
  );

  it(
    'uses main outside pull requests',
    async () => {
      const outcome = await runAction({ event: 'push', inputs: { comment: 'true' } });

      expect(outcome.argv[1]).toBe('origin/main');
      expect(apiRequests).toEqual([]);
    },
    LONG,
  );

  it(
    'passes fail-on and skip-validation through when they are set',
    async () => {
      const outcome = await runAction({
        event: 'pull_request',
        inputs: { 'fail-on': 'any', 'skip-validation': 'true', base: 'main' },
      });

      expect(outcome.argv).toEqual([
        '--base',
        'origin/main',
        '--studio',
        'fixtures/studio',
        '--format',
        'md',
        '--fail-on',
        'any',
        '--skip-validation',
      ]);
    },
    LONG,
  );

  it(
    'exits with the check code, so the fail-on rules gate the job',
    async () => {
      const outcome = await runAction({ event: 'pull_request', checkExit: 1 });

      const finish = outcome.steps.at(-1);
      expect(finish?.name).toBe('Exit with the check result');
      expect(finish?.code).toBe(1);
    },
    LONG,
  );

  it(
    'creates the pull request comment with the runner token and no leaked secrets',
    async () => {
      const outcome = await runAction({ event: 'pull_request' });

      const post = apiRequests.find((request) => request.method === 'POST');
      expect(post?.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
      expect(JSON.parse(post?.body ?? '{}')).toEqual({ body: REPORT });
      expect(outcome.output).not.toContain(RUNNER_TOKEN);
      expect(outcome.output).not.toContain(TOKEN_GATE);
    },
    LONG,
  );

  it(
    'updates the marked comment that is already on the pull request',
    async () => {
      existingComments = [{ id: 11, body: `${REPORT}\nold` }];

      await runAction({ event: 'pull_request' });

      expect(apiRequests.map((request) => request.method)).toEqual(['GET', 'PATCH']);
      expect(apiRequests[1]?.url).toBe('/repos/acme/shop/issues/comments/11');
    },
    LONG,
  );

  it(
    'does not comment when comment is false',
    async () => {
      await runAction({ event: 'pull_request', inputs: { comment: 'false' } });

      expect(apiRequests).toEqual([]);
    },
    LONG,
  );

  it(
    'refuses a boolean input that is neither true nor false',
    async () => {
      const outcome = await runAction({ event: 'pull_request', inputs: { comment: 'yes' } });

      expect(outcome.steps[0]?.code).toBe(2);
      expect(outcome.steps[0]?.stderr).toContain('comment must be true or false.');
    },
    LONG,
  );
});
