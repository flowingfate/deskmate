/**
 * Coalesces concurrent installs of the same key into a single in-flight promise.
 *
 * Used by `installRuntime` (key = `${tool}-${version}`) and `installPythonVersion`
 * (key = `python-${version}`) so that two callers asking for the same install at
 * the same time wait on one process instead of fighting for the same files.
 *
 * On settle the entry is dropped — a follow-up install (e.g. after a failure or
 * after the user picks a different version) will spawn fresh work.
 */
export class InstallLockMap {
  private locks: Map<string, Promise<void>> = new Map();

  /**
   * Get the current in-flight promise for `key`, or `undefined` if none.
   * Callers MUST `await` the returned promise to honour the lock.
   */
  get(key: string): Promise<void> | undefined {
    return this.locks.get(key);
  }

  /**
   * Run `factory()` under lock for `key`. Concurrent calls with the same key
   * receive the same promise. The lock is released (entry deleted) once the
   * underlying promise settles, regardless of success or failure.
   */
  async run(key: string, factory: () => Promise<void>): Promise<void> {
    const existing = this.locks.get(key);
    if (existing) {
      return existing;
    }

    const promise = factory();
    this.locks.set(key, promise);

    try {
      await promise;
    } finally {
      this.locks.delete(key);
    }
  }
}
