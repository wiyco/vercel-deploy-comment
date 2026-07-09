import { beforeEach, describe, expect, it, vi } from "vitest";

const setFailed = vi.fn();
const getInput = vi.fn();
const getState = vi.fn();
const saveState = vi.fn();
const runActionMain = vi.fn();
const runActionPost = vi.fn();
const toError = vi.fn((error: unknown) =>
  error instanceof Error ? error : new Error(String(error)),
);

vi.mock("@actions/core", () => ({
  getInput,
  getState,
  saveState,
  setFailed,
}));

vi.mock("../src/action/run", () => ({
  runActionMain,
  runActionPost,
}));

vi.mock("../src/action/runtime", () => ({
  toError,
}));

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getInput.mockReturnValue("");
    getState.mockReturnValue("");
    runActionMain.mockResolvedValue(undefined);
    runActionPost.mockResolvedValue(undefined);
    toError.mockImplementation((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    );
  });

  it("delegates to runActionMain", async () => {
    const { run } = await import("../src/main");

    await expect(run()).resolves.toBeUndefined();

    expect(runActionMain).toHaveBeenCalledTimes(1);
    expect(runActionPost).not.toHaveBeenCalled();
    expect(saveState).toHaveBeenCalledWith(
      "vercelDeployCommentPostCleanupRegistered",
      "true",
    );
    expect(saveState).toHaveBeenCalledWith(
      "vercelDeployCommentMainOutcome",
      "started",
    );
    expect(saveState).toHaveBeenCalledWith(
      "vercelDeployCommentMainOutcome",
      "success",
    );
  });

  it("rethrows runActionMain failures unchanged", async () => {
    runActionMain.mockRejectedValue(new Error("deploy failed"));
    const { run } = await import("../src/main");

    await expect(run()).rejects.toThrow("deploy failed");

    expect(saveState).toHaveBeenCalledWith(
      "vercelDeployCommentMainOutcome",
      "failure",
    );
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("delegates to runActionPost during post execution", async () => {
    getState.mockImplementation((name: string) => {
      if (name === "vercelDeployCommentPostCleanupRegistered") {
        return "true";
      }

      if (name === "vercelDeployCommentMainOutcome") {
        return "failure";
      }

      return "";
    });
    const { run } = await import("../src/main");

    await expect(run()).resolves.toBeUndefined();

    expect(runActionMain).not.toHaveBeenCalled();
    expect(getInput).toHaveBeenCalledWith("job-status");
    expect(runActionPost).toHaveBeenCalledWith({
      jobStatus: "",
      mainOutcome: "failure",
    });
  });
});
