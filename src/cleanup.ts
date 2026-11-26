export type CleanupTask = () => Promise<void>;

export interface Cleanup {
  add(task: CleanupTask): void;
  /** Runs each task once, newest first. Returns the messages of any that failed. */
  run(): Promise<string[]>;
}

export function createCleanup(): Cleanup {
  const tasks: CleanupTask[] = [];
  return {
    add(task) {
      tasks.push(task);
    },
    async run() {
      const failures: string[] = [];
      for (const task of tasks.splice(0).reverse()) {
        try {
          await task();
        } catch (error) {
          failures.push(error instanceof Error ? error.message : 'unknown error');
        }
      }
      return failures;
    },
  };
}

export interface SignalSource {
  on(signal: string, listener: () => void): unknown;
  exit(code: number): unknown;
}

const SIGNAL_EXIT_CODES: readonly (readonly [string, number])[] = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
];

/** Runs cleanup when the process is interrupted, then exits with the conventional code. */
export function cleanOnSignal(cleanup: Cleanup, source: SignalSource): void {
  for (const [signal, code] of SIGNAL_EXIT_CODES) {
    source.on(signal, () => {
      void cleanup.run().then(() => source.exit(code));
    });
  }
}
