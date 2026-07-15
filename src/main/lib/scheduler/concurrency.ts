/**
 * Execute independent asynchronous work with a bounded number of in-flight operations.
 * Results preserve input order and retain every rejection for the caller to inspect.
 */
export async function settleWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }

  const settled: Array<PromiseSettledResult<R> | undefined> = Array.from(
    { length: items.length },
    () => undefined,
  );
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const [result] = await Promise.allSettled([run(items[index])]);
      settled[index] = result;
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxConcurrency, items.length) }, runWorker));
  return settled.map((result) => {
    if (!result) {
      throw new Error('Concurrency worker completed without a result.');
    }
    return result;
  });
}
