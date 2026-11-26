import { spawn } from 'node:child_process';

export interface CommandOptions {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Replaces the whole environment of the child. Nothing is inherited. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Values scrubbed from any error message. */
  readonly secrets?: readonly string[];
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Replaces every occurrence of each secret with `[redacted]`. Longer secrets go first. */
export function redact(text: string, secrets: readonly string[]): string {
  const ordered = secrets.filter((s) => s !== '').sort((a, b) => b.length - a.length);
  return ordered.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/**
 * Runs a command without a shell. Resolves with the exit code and both streams. Rejects if the
 * command can't start, is killed by a signal, or runs past `timeoutMs` (the child is killed).
 */
export function runCommand(options: CommandOptions): Promise<CommandResult> {
  const { cmd, args, cwd, env, timeoutMs } = options;
  const secrets = options.secrets ?? [];

  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;

    const child = spawn(cmd, [...args], {
      cwd,
      env: { ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(`${cmd} timed out after ${String(timeoutMs)} ms.`);
    }, timeoutMs);

    function finish(): void {
      settled = true;
      clearTimeout(timer);
    }

    function fail(message: string): void {
      if (settled) return;
      finish();
      reject(new Error(redact(message, secrets)));
    }

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      fail(`Could not start ${cmd}: ${error.message}`);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      finish();
      if (code === null) {
        reject(new Error(redact(`${cmd} stopped by signal ${signal ?? 'unknown'}.`, secrets)));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}
