import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrencyLimit } from "../../src/shared/concurrency";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("mapWithConcurrencyLimit", () => {
  it("returns an empty array when no items are provided", async () => {
    const mapItem = vi.fn(
      async (item: string | undefined) => item ?? "missing",
    );

    await expect(
      mapWithConcurrencyLimit<string, string>([], 1, mapItem),
    ).resolves.toEqual([]);
    expect(mapItem).not.toHaveBeenCalled();
  });

  it("maps explicit undefined items instead of treating them as termination", async () => {
    const mapItem = vi.fn(
      async (item: string | undefined, index: number) =>
        `${index}:${item ?? "missing"}`,
    );

    await expect(
      mapWithConcurrencyLimit<string | undefined, string>(
        [
          "web",
          undefined,
          "docs",
        ],
        1,
        mapItem,
      ),
    ).resolves.toEqual([
      "0:web",
      "1:missing",
      "2:docs",
    ]);
    expect(mapItem).toHaveBeenNthCalledWith(1, "web", 0);
    expect(mapItem).toHaveBeenNthCalledWith(2, undefined, 1);
    expect(mapItem).toHaveBeenNthCalledWith(3, "docs", 2);
  });

  it("maps sparse array holes as undefined values", async () => {
    const items = new Array<string | undefined>(3);
    items[0] = "web";
    items[2] = "docs";
    const mapItem = vi.fn(
      async (item: string | undefined, index: number) =>
        item ?? `hole-${index}`,
    );

    await expect(mapWithConcurrencyLimit(items, 1, mapItem)).resolves.toEqual([
      "web",
      "hole-1",
      "docs",
    ]);
    expect(mapItem).toHaveBeenNthCalledWith(1, "web", 0);
    expect(mapItem).toHaveBeenNthCalledWith(2, undefined, 1);
    expect(mapItem).toHaveBeenNthCalledWith(3, "docs", 2);
  });

  it("rethrows undefined rejections", async () => {
    await expect(
      mapWithConcurrencyLimit(
        [
          "web",
          "docs",
        ],
        1,
        async (item) => {
          if (item === "docs") {
            throw undefined;
          }

          return item ?? "missing";
        },
      ),
    ).rejects.toBeUndefined();
  });

  it("stops scheduling more items after another worker fails", async () => {
    const slowItem = createDeferred<string>();
    const mapItem = vi.fn(async (item: string | undefined) => {
      if (item === "fail") {
        throw new Error("boom");
      }

      if (item === "slow") {
        return slowItem.promise;
      }

      return `${item ?? "missing"}-done`;
    });

    const runPromise = mapWithConcurrencyLimit(
      [
        "fail",
        "slow",
        "skipped",
      ],
      2,
      mapItem,
    );

    await vi.waitFor(() => {
      expect(mapItem).toHaveBeenCalledTimes(2);
    });
    expect(mapItem).toHaveBeenNthCalledWith(1, "fail", 0);
    expect(mapItem).toHaveBeenNthCalledWith(2, "slow", 1);

    slowItem.resolve("slow-done");

    await expect(runPromise).rejects.toThrow("boom");
    expect(mapItem).toHaveBeenCalledTimes(2);
  });

  it("keeps the first error when multiple workers fail", async () => {
    const firstFailure = createDeferred<never>();
    const secondFailure = createDeferred<never>();
    const mapItem = vi.fn(async (item: string | undefined) => {
      if (item === "first") {
        return firstFailure.promise;
      }

      return secondFailure.promise;
    });

    const runPromise = mapWithConcurrencyLimit(
      [
        "first",
        "second",
      ],
      2,
      mapItem,
    );

    await vi.waitFor(() => {
      expect(mapItem).toHaveBeenCalledTimes(2);
    });

    firstFailure.reject(new Error("first boom"));
    secondFailure.reject(new Error("second boom"));

    await expect(runPromise).rejects.toThrow("first boom");
  });
});
