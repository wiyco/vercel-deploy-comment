export async function mapWithConcurrencyLimit<TItem, TResult>(
  items: readonly (TItem | undefined)[],
  concurrency: number,
  mapItem: (item: TItem | undefined, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  const workerCount = Math.min(concurrency, items.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  async function runWorker(): Promise<void> {
    while (true) {
      if (hasError) {
        return;
      }

      const currentIndex = nextIndex;

      if (currentIndex >= items.length) {
        return;
      }

      nextIndex += 1;

      try {
        results[currentIndex] = await mapItem(
          items[currentIndex],
          currentIndex,
        );
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        return;
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: workerCount,
      },
      () => runWorker(),
    ),
  );

  if (hasError) {
    throw firstError;
  }

  return results;
}
