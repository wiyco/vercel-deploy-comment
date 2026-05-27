import { beforeEach, describe, expect, it, vi } from "vitest";

const setFailed = vi.fn();
const runActionMain = vi.fn();
const toError = vi.fn((error: unknown) =>
  error instanceof Error ? error : new Error(String(error)),
);

vi.mock("@actions/core", () => ({
  setFailed,
}));

vi.mock("../src/action/run", () => ({
  runActionMain,
}));

vi.mock("../src/action/runtime", () => ({
  toError,
}));

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runActionMain.mockResolvedValue(undefined);
    toError.mockImplementation((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
  });

  it("delegates to runActionMain", async () => {
    const { run } = await import("../src/main");

    await expect(run()).resolves.toBeUndefined();

    expect(runActionMain).toHaveBeenCalledTimes(1);
  });

  it("rethrows runActionMain failures unchanged", async () => {
    runActionMain.mockRejectedValue(new Error("deploy failed"));
    const { run } = await import("../src/main");

    await expect(run()).rejects.toThrow("deploy failed");

    expect(setFailed).not.toHaveBeenCalled();
  });
});
