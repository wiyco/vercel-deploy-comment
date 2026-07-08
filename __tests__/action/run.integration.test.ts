import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDeploymentComment } from "../../src/comment/markdown";

const info = vi.fn();
const setOutput = vi.fn();
const setSecret = vi.fn();
const warning = vi.fn();

const readActionInputs = vi.fn();
const buildRunUrl = vi.fn(
  () => "https://github.test/acme/repo/actions/runs/123",
);
const readGitHubRuntimeContext = vi.fn(() => ({
  apiUrl: "https://api.github.test",
  graphqlUrl: "https://api.github.test/graphql",
  serverUrl: "https://github.test",
  owner: "acme",
  repo: "repo",
  runId: "123",
  issueNumber: 42,
}));
const findExistingActionComment = vi.fn();
const createPullRequestComment = vi.fn();
const deletePullRequestComment = vi.fn();
const getPullRequestComment = vi.fn();
const updatePullRequestComment = vi.fn();
const GitHubClient = vi.fn().mockImplementation(function MockGitHubClient() {
  return {
    createPullRequestComment,
    deletePullRequestComment,
    findExistingActionComment,
    getPullRequestComment,
    updatePullRequestComment,
  };
});
const getVercelDeploymentDetails = vi.fn();
const getVercelProjectDetails = vi.fn();
const runVercelDeploy = vi.fn();
const toHttpUrl = vi.fn();

vi.mock("@actions/core", () => ({
  info,
  setOutput,
  setSecret,
  warning,
}));

vi.mock("../../src/action/input", () => ({
  readActionInputs,
}));

vi.mock("../../src/github/client", () => ({
  GitHubApiError: class GitHubApiError extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
      this.name = "GitHubApiError";
    }
  },
  GitHubClient,
  buildRunUrl,
  readGitHubRuntimeContext,
}));

vi.mock("../../src/vercel/deployment", () => ({
  getVercelDeploymentDetails,
  getVercelProjectDetails,
  runVercelDeploy,
  toHttpUrl,
}));

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

describe("runActionMain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.resetModules();
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "deploy-and-comment",
      deploymentConcurrency: 2,
      deployments: [
        {
          cwd: ".",
          environment: "preview",
          orgId: "team_123",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    findExistingActionComment.mockResolvedValue(undefined);
    createPullRequestComment.mockResolvedValue({
      action: "created",
      htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
    deletePullRequestComment.mockResolvedValue(undefined);
    getPullRequestComment.mockResolvedValue({
      body: "",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
    updatePullRequestComment.mockResolvedValue({
      action: "updated",
      htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
    getVercelProjectDetails.mockResolvedValue(undefined);
    getVercelDeploymentDetails.mockResolvedValue(undefined);
    toHttpUrl.mockImplementation((value: string) => value);
  });

  it("rethrows terminal failures with secrets redacted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    runVercelDeploy.mockRejectedValue(
      new Error("deploy failed with ghs_token and vercel_token"),
    );

    const { runActionMain } = await import("../../src/action/run");

    const runPromise = runActionMain();
    const runExpectation = expect(runPromise).rejects.toThrow(
      "deploy failed with *** and ***",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await runExpectation;

    expect(warning).toHaveBeenCalledWith("deploy failed with *** and ***");
    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment.mock.calls[0]?.[1]).not.toContain(
      "row:prj_web:preview",
    );
    expect(deletePullRequestComment).not.toHaveBeenCalled();
    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
  });

  it("redacts initialization failures after inputs are read", async () => {
    readGitHubRuntimeContext.mockImplementationOnce(() => {
      throw new Error("context failed with ghs_token and vercel_token");
    });

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).rejects.toThrow(
      "context failed with *** and ***",
    );

    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
    expect(setOutput).not.toHaveBeenCalled();
  });

  it("rejects undefined deployment entries with a descriptive index error", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "deploy-and-comment",
      deploymentConcurrency: 2,
      deployments: [
        undefined,
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).rejects.toThrow(
      "Deployment at index 0 is undefined.",
    );

    expect(createPullRequestComment).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalled();
  });

  it("preserves both build and flush failures in the thrown error cause", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    runVercelDeploy.mockRejectedValue(new Error("deploy failed"));
    updatePullRequestComment.mockRejectedValue(
      new Error("final comment write failed"),
    );
    getPullRequestComment.mockRejectedValue(new Error("refresh failed"));

    const { runActionMain } = await import("../../src/action/run");

    const runPromise = runActionMain();
    const errorPromise = runPromise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await errorPromise;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "deploy failed; failed to flush managed pull request comment updates: final comment write failed",
    );
    expect((error as Error).cause).toBeInstanceOf(AggregateError);

    const aggregateError = (error as Error).cause as AggregateError;
    const aggregateErrors = aggregateError.errors as Error[];

    expect(aggregateError.message).toBe(
      "deploy failed; failed to flush managed pull request comment updates: final comment write failed",
    );
    expect(aggregateError.cause).toBe(aggregateErrors[0]);
    expect(aggregateErrors).toHaveLength(2);
    expect(aggregateErrors[0]?.message).toBe("deploy failed");
    expect(aggregateErrors[1]?.message).toBe(
      "failed to flush managed pull request comment updates: final comment write failed",
    );
    expect(aggregateErrors[1]?.cause).toBeInstanceOf(Error);
    expect((aggregateErrors[1]?.cause as Error).message).toBe(
      "final comment write failed",
    );
  });

  it("fails without whole-comment rollback when an incremental comment update ultimately fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    runVercelDeploy.mockResolvedValue(
      "https://web-git-feature-team.vercel.app",
    );
    updatePullRequestComment.mockRejectedValue(
      new Error("final comment write failed"),
    );
    getPullRequestComment.mockRejectedValue(new Error("refresh failed"));

    const { runActionMain } = await import("../../src/action/run");

    const runPromise = runActionMain();
    const runExpectation = expect(runPromise).rejects.toThrow(
      "final comment write failed",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await runExpectation;

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment).toHaveBeenCalledTimes(3);
    expect(deletePullRequestComment).not.toHaveBeenCalled();
    expect(setOutput).not.toHaveBeenCalled();
  });

  it("writes an initial In Progress comment and publishes resolved rows incrementally", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    const webDeployment = createDeferred<string>();
    const adminDeployment = createDeferred<string>();
    const docsDeployment = createDeferred<string>();

    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "deploy-and-comment",
      deploymentConcurrency: 2,
      deployments: [
        {
          cwd: ".",
          environment: "preview",
          orgId: "team_123",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
        {
          cwd: "admin",
          environment: "preview",
          orgId: "team_123",
          projectId: "prj_admin",
          projectUrl: "https://vercel.com/team/admin",
        },
        {
          cwd: "docs",
          environment: "preview",
          orgId: "team_123",
          projectId: "prj_docs",
          projectUrl: "https://vercel.com/team/docs",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    findExistingActionComment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        body: "## Preview\n\n<!-- vercel-deploy-comment:default -->\n",
        id: 10,
      });
    runVercelDeploy.mockImplementation(
      ({
        deployment,
      }: {
        deployment: {
          projectId: string;
        };
      }) => {
        if (deployment.projectId === "prj_web") {
          return webDeployment.promise;
        }

        if (deployment.projectId === "prj_admin") {
          return adminDeployment.promise;
        }

        return docsDeployment.promise;
      },
    );

    const { runActionMain } = await import("../../src/action/run");

    const runPromise = runActionMain();
    await vi.waitFor(() => {
      expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    });

    expect(runVercelDeploy).toHaveBeenCalledTimes(2);
    expect(
      runVercelDeploy.mock.calls.map(([arg]) => arg.deployment.projectId),
    ).toEqual([
      "prj_web",
      "prj_admin",
    ]);

    adminDeployment.resolve("https://admin-git-feature-team.vercel.app");
    await vi.waitFor(() => {
      expect(runVercelDeploy).toHaveBeenCalledTimes(3);
    });
    expect(runVercelDeploy.mock.calls[2]?.[0].deployment.projectId).toBe(
      "prj_docs",
    );
    const initialCommentBody = createPullRequestComment.mock.calls[0]?.[0];
    expect(initialCommentBody).toContain(
      "<!-- vercel-deploy-comment:default -->",
    );
    expect(initialCommentBody).toContain("[In Progress]");

    webDeployment.resolve("https://web-git-feature-team.vercel.app");
    await vi.waitFor(() => {
      expect(runVercelDeploy).toHaveBeenCalledTimes(3);
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
    const firstIncrementalBody = updatePullRequestComment.mock.calls[0]?.[1];
    expect(firstIncrementalBody).toContain("row:prj_web:preview");
    expect(firstIncrementalBody).toContain("[Ready]");
    expect(firstIncrementalBody).toContain("row:prj_admin:preview");
    expect(firstIncrementalBody).toContain("row:prj_docs:preview");
    expect(firstIncrementalBody).toContain("[In Progress]");

    adminDeployment.resolve("https://admin-git-feature-team.vercel.app");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(updatePullRequestComment).toHaveBeenCalledTimes(2);
    const secondIncrementalBody = updatePullRequestComment.mock.calls[1]?.[1];
    expect(secondIncrementalBody).toContain("row:prj_web:preview");
    expect(secondIncrementalBody).toContain("row:prj_admin:preview");
    expect(secondIncrementalBody).toContain("[Ready]");
    expect(secondIncrementalBody).toContain("row:prj_docs:preview");
    expect(secondIncrementalBody).toContain("[In Progress]");

    docsDeployment.resolve("https://docs-git-feature-team.vercel.app");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(runPromise).resolves.toBeUndefined();

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment).toHaveBeenCalledTimes(3);
    const finalCommentBody = updatePullRequestComment.mock.calls[2]?.[1];
    expect(finalCommentBody).toContain("[Ready]");
    expect(finalCommentBody.indexOf("row:prj_web:preview")).toBeLessThan(
      finalCommentBody.indexOf("row:prj_admin:preview"),
    );
    expect(finalCommentBody.indexOf("row:prj_admin:preview")).toBeLessThan(
      finalCommentBody.indexOf("row:prj_docs:preview"),
    );
    expect(setOutput).toHaveBeenCalledWith(
      "deployment-urls",
      JSON.stringify([
        "https://web-git-feature-team.vercel.app",
        "https://admin-git-feature-team.vercel.app",
        "https://docs-git-feature-team.vercel.app",
      ]),
    );
    expect(setOutput).toHaveBeenCalledWith(
      "statuses",
      JSON.stringify([
        "ready",
        "ready",
        "ready",
      ]),
    );
  });

  it("publishes failed rows when comment-on-failure is true and then fails the action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "deploy-and-comment",
      deploymentConcurrency: 1,
      deployments: [
        {
          cwd: ".",
          environment: "preview",
          orgId: "team_123",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: true,
    });
    runVercelDeploy.mockRejectedValue(new Error("deploy failed"));

    const { runActionMain } = await import("../../src/action/run");

    const runPromise = runActionMain();
    const runExpectation = expect(runPromise).rejects.toThrow("deploy failed");
    await vi.advanceTimersByTimeAsync(1_000);
    await runExpectation;

    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment.mock.calls[0]?.[1]).toContain("[Failed]");
    expect(setOutput).toHaveBeenCalledWith(
      "statuses",
      JSON.stringify([
        "failed",
      ]),
    );
  });

  it("emits non-ready status keys for comment-only rows when Vercel readyState or fallback status differs", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_ready",
          projectUrl: "https://vercel.com/team/ready",
          deploymentUrl: "https://ready-git-feature-team.vercel.app",
        },
        {
          environment: "preview",
          projectId: "prj_failed",
          projectUrl: "https://vercel.com/team/failed",
          deploymentUrl: "https://failed-git-feature-team.vercel.app",
        },
        {
          environment: "preview",
          projectId: "prj_building",
          projectUrl: "https://vercel.com/team/building",
          deploymentUrl: "https://building-git-feature-team.vercel.app",
        },
        {
          environment: "preview",
          projectId: "prj_skipped",
          projectUrl: "https://vercel.com/team/skipped",
          deploymentUrl: "https://skipped-git-feature-team.vercel.app",
        },
        {
          environment: "preview",
          projectId: "prj_unknown",
          projectUrl: "https://vercel.com/team/unknown",
          deploymentUrl: "https://unknown-git-feature-team.vercel.app",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "skipped",
      commentOnFailure: false,
    });
    getVercelDeploymentDetails.mockImplementation(
      async ({ deploymentUrl }: { deploymentUrl: string }) => {
        if (deploymentUrl.includes("ready-")) {
          return {
            readyState: "READY",
          };
        }

        if (deploymentUrl.includes("failed-")) {
          return {
            readyState: "ERROR",
          };
        }

        if (deploymentUrl.includes("building-")) {
          return {
            readyState: "BUILDING",
          };
        }

        if (deploymentUrl.includes("unknown-")) {
          return {
            readyState: "ALIEN",
          };
        }

        return undefined;
      },
    );

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).resolves.toBeUndefined();

    expect(runVercelDeploy).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledWith(
      "statuses",
      JSON.stringify([
        "ready",
        "failed",
        "in_progress",
        "skipped",
        "unknown",
      ]),
    );
  });

  it("prefers explicit per-deployment statuses in comment-only mode", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_ready",
          projectUrl: "https://vercel.com/team/ready",
          deploymentUrl: "https://ready-git-feature-team.vercel.app",
          status: "ready",
        },
        {
          environment: "preview",
          projectId: "prj_failed",
          projectUrl: "https://vercel.com/team/failed",
          deploymentUrl: "https://failed-git-feature-team.vercel.app",
          status: "failed",
        },
        {
          environment: "preview",
          projectId: "prj_cancelled",
          projectUrl: "https://vercel.com/team/cancelled",
          deploymentUrl: "https://cancelled-git-feature-team.vercel.app",
          status: "cancelled",
        },
        {
          environment: "preview",
          projectId: "prj_skipped",
          projectUrl: "https://vercel.com/team/skipped",
          deploymentUrl: "https://skipped-git-feature-team.vercel.app",
          status: "skipped",
        },
        {
          environment: "preview",
          projectId: "prj_building",
          projectUrl: "https://vercel.com/team/building",
          deploymentUrl: "https://building-git-feature-team.vercel.app",
          status: "in_progress",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    getVercelDeploymentDetails.mockImplementation(
      async ({ deploymentUrl }: { deploymentUrl: string }) => {
        if (deploymentUrl.includes("ready-")) {
          return {
            readyState: "ERROR",
          };
        }

        if (
          deploymentUrl.includes("failed-") ||
          deploymentUrl.includes("cancelled-") ||
          deploymentUrl.includes("skipped-") ||
          deploymentUrl.includes("building-")
        ) {
          return {
            readyState: "READY",
          };
        }

        return undefined;
      },
    );

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).resolves.toBeUndefined();

    expect(setOutput).toHaveBeenCalledWith(
      "statuses",
      JSON.stringify([
        "ready",
        "failed",
        "cancelled",
        "skipped",
        "in_progress",
      ]),
    );
  });

  it("updates an existing comment in comment-only mode without Vercel metadata lookups", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: undefined,
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_ready",
          projectUrl: "https://vercel.com/team/ready",
          deploymentUrl: "https://ready-git-feature-team.vercel.app",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    findExistingActionComment.mockResolvedValue({
      body: "## Preview\n\n<!-- vercel-deploy-comment:default -->\n",
      id: 10,
    });

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).resolves.toBeUndefined();

    expect(getVercelProjectDetails).not.toHaveBeenCalled();
    expect(getVercelDeploymentDetails).not.toHaveBeenCalled();
    expect(createPullRequestComment).not.toHaveBeenCalled();
    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
  });

  it("warns and continues when optional Vercel metadata lookups fail", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_ready",
          projectUrl: "https://vercel.com/team/ready",
          deploymentUrl: "https://ready-git-feature-team.vercel.app",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    getVercelProjectDetails.mockRejectedValue(
      new Error("project lookup failed for vercel_token"),
    );

    const { runActionMain } = await import("../../src/action/run");

    await expect(runActionMain()).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith("project lookup failed for ***");
    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
  });
});

describe("runActionPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.resetModules();
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: undefined,
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
          deploymentUrl: "https://web-git-feature-team.vercel.app",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });
    findExistingActionComment.mockResolvedValue({
      body: renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          {
            environment: "preview",
            projectId: "prj_web",
            projectName: "web",
            projectUrl: "https://vercel.com/team/web",
            runUrl: "https://github.test/acme/repo/actions/runs/122",
            status: {
              key: "in_progress",
              emoji: "\u23f3",
              label: "In Progress",
            },
            updatedAtUtc: "2026-05-21T00:00:00.000Z",
          },
          {
            environment: "preview",
            projectId: "prj_docs",
            projectName: "docs",
            projectUrl: "https://vercel.com/team/docs",
            previewUrl: "https://docs-git-feature-team.vercel.app",
            runUrl: "https://github.test/acme/repo/actions/runs/122",
            status: {
              key: "ready",
              emoji: "\u2705",
              label: "Ready",
            },
            updatedAtUtc: "2026-05-21T00:00:00.000Z",
          },
        ],
      }),
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
    updatePullRequestComment.mockResolvedValue({
      action: "updated",
      htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
  });

  it("marks unresolved rows as failed after a failed job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "success",
      }),
    ).resolves.toBeUndefined();

    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
    const body = updatePullRequestComment.mock.calls[0]?.[1];
    expect(body).toContain("row:prj_web:preview");
    expect(body).toContain("\u274c [Failed]");
    expect(body).not.toContain("\u23f3 [In Progress]");
    expect(body).toContain("\u2705 [Ready]");
    expect(body).toContain("2026-05-22 00:00:00 UTC");
  });

  it("marks unresolved rows as cancelled when the main action did not finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "started",
      }),
    ).resolves.toBeUndefined();

    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment.mock.calls[0]?.[1]).toContain(
      "\ud83d\udeab [Cancelled]",
    );
  });

  it("skips cleanup when there is no managed comment", async () => {
    findExistingActionComment.mockResolvedValue(undefined);
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "failure",
      }),
    ).resolves.toBeUndefined();

    expect(updatePullRequestComment).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Post cleanup found no in-progress rows to finalize.",
    );
  });

  it("skips cleanup when there is no terminal job status", async () => {
    const { runActionPost } = await import("../../src/action/run");

    await expect(runActionPost()).resolves.toBeUndefined();

    expect(findExistingActionComment).not.toHaveBeenCalled();
    expect(updatePullRequestComment).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Post cleanup skipped because no terminal job status was set.",
    );
  });

  it("skips cleanup when the managed comment has no in-progress rows", async () => {
    findExistingActionComment.mockResolvedValue({
      body: renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          {
            environment: "preview",
            projectId: "prj_docs",
            projectName: "docs",
            projectUrl: "https://vercel.com/team/docs",
            previewUrl: "https://docs-git-feature-team.vercel.app",
            runUrl: "https://github.test/acme/repo/actions/runs/122",
            status: {
              key: "ready",
              emoji: "\u2705",
              label: "Ready",
            },
            updatedAtUtc: "2026-05-21T00:00:00.000Z",
          },
        ],
      }),
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "failure",
      }),
    ).resolves.toBeUndefined();

    expect(updatePullRequestComment).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Post cleanup found no in-progress rows to finalize.",
    );
  });

  it("warns without failing when cleanup cannot read inputs", async () => {
    readActionInputs.mockImplementationOnce(() => {
      throw new Error("input failed");
    });
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "failure",
      }),
    ).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith("input failed");
    expect(updatePullRequestComment).not.toHaveBeenCalled();
  });

  it("warns with redacted secrets when cleanup update fails", async () => {
    updatePullRequestComment.mockRejectedValue(
      new Error("update failed with ghs_token"),
    );
    const { runActionPost } = await import("../../src/action/run");

    await expect(
      runActionPost({
        mainOutcome: "failure",
      }),
    ).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith("update failed with ***");
  });
});
