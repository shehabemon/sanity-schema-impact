import { describe, expect, it } from 'vitest';
import { redact, runCommand } from '../../src/adapters/process.js';

const node = process.execPath;
const pathEnv = { PATH: process.env['PATH'] ?? '' };

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    expect(redact('token abc and abc, also xyz', ['abc', 'xyz'])).toBe(
      'token [redacted] and [redacted], also [redacted]',
    );
  });

  it('leaves the text alone when no secret is given or a secret is empty', () => {
    expect(redact('Unauthorized', [])).toBe('Unauthorized');
    expect(redact('Unauthorized', [''])).toBe('Unauthorized');
  });
});

describe('runCommand', () => {
  it('returns the exit code, stdout and stderr of the child', async () => {
    const result = await runCommand({
      cmd: node,
      args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'],
      cwd: process.cwd(),
      env: pathEnv,
      timeoutMs: 10_000,
    });

    expect(result).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
  });

  it('passes arguments without a shell, so variables are not expanded', async () => {
    const result = await runCommand({
      cmd: node,
      args: ['-e', 'process.stdout.write(process.argv[1] ?? "")', '$HOME; rm -rf x'],
      cwd: process.cwd(),
      env: pathEnv,
      timeoutMs: 10_000,
    });

    expect(result.stdout).toBe('$HOME; rm -rf x');
  });

  it('gives the child only the environment it is passed', async () => {
    const result = await runCommand({
      cmd: node,
      args: ['-e', 'process.stdout.write(String(process.env.SANITY_SCHEMA_IMPACT_PROBE))'],
      cwd: process.cwd(),
      env: pathEnv,
      timeoutMs: 10_000,
    });

    expect(result.stdout).toBe('undefined');
  });

  it('kills a child that runs past the timeout and rejects', async () => {
    await expect(
      runCommand({
        cmd: node,
        args: ['-e', 'setTimeout(() => {}, 60_000)'],
        cwd: process.cwd(),
        env: pathEnv,
        timeoutMs: 200,
      }),
    ).rejects.toThrow('timed out after 200 ms');
  });

  it('keeps a secret out of the error when the command cannot start', async () => {
    const secret = 'token-value-for-test';

    const attempt = runCommand({
      cmd: `/no/such/dir/${secret}/sanity`,
      args: [],
      cwd: process.cwd(),
      env: pathEnv,
      timeoutMs: 10_000,
      secrets: [secret],
    });

    await expect(attempt).rejects.toThrow('[redacted]');
    await attempt.catch((error: unknown) => {
      expect(String(error)).not.toContain(secret);
    });
  });
});
