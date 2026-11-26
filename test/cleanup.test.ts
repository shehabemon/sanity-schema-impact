import { describe, expect, it, vi } from 'vitest';
import { cleanOnSignal, createCleanup, type SignalSource } from '../src/cleanup.js';

function fakeSignals(): {
  source: SignalSource;
  listeners: Map<string, () => void>;
  exits: number[];
} {
  const listeners = new Map<string, () => void>();
  const exits: number[] = [];
  return {
    listeners,
    exits,
    source: {
      on: (signal, listener) => {
        listeners.set(signal, listener);
      },
      exit: (code) => {
        exits.push(code);
      },
    },
  };
}

describe('createCleanup', () => {
  it('runs the registered tasks newest first', async () => {
    const cleanup = createCleanup();
    const order: string[] = [];
    cleanup.add(() => {
      order.push('first registered');
      return Promise.resolve();
    });
    cleanup.add(() => {
      order.push('second registered');
      return Promise.resolve();
    });

    await cleanup.run();
    expect(order).toEqual(['second registered', 'first registered']);
  });

  it('keeps going after a task fails and returns the message of the failure', async () => {
    const cleanup = createCleanup();
    const ran: string[] = [];
    cleanup.add(() => {
      ran.push('kept');
      return Promise.resolve();
    });
    cleanup.add(() => Promise.reject(new Error('could not remove worktree')));

    expect(await cleanup.run()).toEqual(['could not remove worktree']);
    expect(ran).toEqual(['kept']);
  });

  it('runs each task once, even when run is called again', async () => {
    const cleanup = createCleanup();
    const task = vi.fn(() => Promise.resolve());
    cleanup.add(task);

    await cleanup.run();
    await cleanup.run();
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('cleanOnSignal', () => {
  it('runs cleanup on SIGINT and exits with 130', async () => {
    const cleanup = createCleanup();
    const task = vi.fn(() => Promise.resolve());
    cleanup.add(task);
    const signals = fakeSignals();

    cleanOnSignal(cleanup, signals.source);
    signals.listeners.get('SIGINT')?.();

    await vi.waitFor(() => {
      expect(signals.exits).toEqual([130]);
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('exits with 143 on SIGTERM', async () => {
    const signals = fakeSignals();
    cleanOnSignal(createCleanup(), signals.source);
    signals.listeners.get('SIGTERM')?.();

    await vi.waitFor(() => {
      expect(signals.exits).toEqual([143]);
    });
  });
});
