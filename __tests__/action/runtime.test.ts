import { beforeEach, describe, expect, it, vi } from "vitest";

const setSecret = vi.fn();
const buildRunUrl = vi.fn(
  () => "https://github.test/acme/repo/actions/runs/123",
);
const readActionInputs = vi.fn();
const readGitHubRuntimeContext = vi.fn(() => ({
  apiUrl: "https://api.github.test",
  graphqlUrl: "https://api.github.test/graphql",
  serverUrl: "https://github.test",
  owner: "acme",
  repo: "repo",
  runId: "123",
  issueNumber: 42,
}));
const GitHubClient = vi.fn().mockImplementation(function MockGitHubClient(
  token: string,
  context: unknown,
) {
  return {
    context,
    token,
  };
});

vi.mock("@actions/core", () => ({
  setSecret,
}));

vi.mock("../../src/action/input", () => ({
  readActionInputs,
}));

vi.mock("../../src/github/client", () => ({
  GitHubClient,
  buildRunUrl,
  readGitHubRuntimeContext,
}));

describe("maskActionSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always masks the GitHub token and optionally the Vercel token", async () => {
    const { maskActionSecrets } = await import("../../src/action/runtime");

    maskActionSecrets({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
    });
    maskActionSecrets({
      githubToken: "ghs_other",
    });

    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
    expect(setSecret).toHaveBeenNthCalledWith(3, "ghs_other");
  });
});

describe("initializeActionRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "comment-only",
      deployments: [],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
  });

  it("builds a client, run url, and masks secrets from action inputs", async () => {
    const { initializeActionRuntime } = await import(
      "../../src/action/runtime"
    );

    const runtime = initializeActionRuntime();

    expect(readActionInputs).toHaveBeenCalledTimes(1);
    expect(readGitHubRuntimeContext).toHaveBeenCalledTimes(1);
    expect(GitHubClient).toHaveBeenCalledWith("ghs_token", {
      apiUrl: "https://api.github.test",
      graphqlUrl: "https://api.github.test/graphql",
      serverUrl: "https://github.test",
      owner: "acme",
      repo: "repo",
      runId: "123",
      issueNumber: 42,
    });
    expect(buildRunUrl).toHaveBeenCalledTimes(1);
    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
    expect(runtime.runUrl).toBe(
      "https://github.test/acme/repo/actions/runs/123",
    );
    expect(runtime.inputs.githubToken).toBe("ghs_token");
    expect(runtime.client).toEqual({
      context: {
        apiUrl: "https://api.github.test",
        graphqlUrl: "https://api.github.test/graphql",
        serverUrl: "https://github.test",
        owner: "acme",
        repo: "repo",
        runId: "123",
        issueNumber: 42,
      },
      token: "ghs_token",
    });
  });
});

describe("toError", () => {
  it("returns Error instances unchanged and wraps non-Error values", async () => {
    const { toError } = await import("../../src/action/runtime");
    const error = new Error("boom");

    expect(toError(error)).toBe(error);
    expect(toError("failed")).toEqual(new Error("failed"));
  });
});

describe("sanitizeErrorMessage", () => {
  it("redacts both GitHub and Vercel tokens from Error messages", async () => {
    const { sanitizeErrorMessage } = await import("../../src/action/runtime");

    expect(
      sanitizeErrorMessage(new Error("ghs_token vercel_token"), {
        githubToken: "ghs_token",
        vercelToken: "vercel_token",
      }),
    ).toBe("*** ***");
  });

  it("handles non-Error values and optional missing Vercel tokens", async () => {
    const { sanitizeErrorMessage } = await import("../../src/action/runtime");

    expect(
      sanitizeErrorMessage("ghs_token failed", {
        githubToken: "ghs_token",
      }),
    ).toBe("*** failed");
  });
});
