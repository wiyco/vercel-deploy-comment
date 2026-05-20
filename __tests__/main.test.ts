import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
const setFailed = vi.fn();
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
const updatePullRequestComment = vi.fn();
const GitHubClient = vi.fn().mockImplementation(function MockGitHubClient() {
  return {
    createPullRequestComment,
    findExistingActionComment,
    updatePullRequestComment,
  };
});
const getVercelDeploymentDetails = vi.fn();
const getVercelProjectDetails = vi.fn();
const runVercelDeploy = vi.fn();
const toHttpUrl = vi.fn();

vi.mock("@actions/core", () => ({
  info,
  setFailed,
  setOutput,
  setSecret,
  warning,
}));

vi.mock("../src/action/input", () => ({
  readActionInputs,
}));

vi.mock("../src/github/client", () => ({
  GitHubClient,
  buildRunUrl,
  readGitHubRuntimeContext,
}));

vi.mock("../src/vercel/deployment", () => ({
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

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    runVercelDeploy.mockRejectedValue(
      new Error("deploy failed with ghs_token and vercel_token"),
    );

    const { run } = await import("../src/main");

    await expect(run()).rejects.toThrow("deploy failed with *** and ***");
    expect(warning).toHaveBeenCalledWith("deploy failed with *** and ***");
    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
  });

  it("runs deployments in parallel and updates the comment once after all rows are resolved", async () => {
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

    const { run } = await import("../src/main");

    const runPromise = run();

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
    expect(createPullRequestComment).not.toHaveBeenCalled();

    webDeployment.resolve("https://web-git-feature-team.vercel.app");
    await Promise.resolve();
    expect(createPullRequestComment).not.toHaveBeenCalled();

    docsDeployment.resolve("https://docs-git-feature-team.vercel.app");
    await expect(runPromise).resolves.toBeUndefined();

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    const commentBody = createPullRequestComment.mock.calls[0]?.[0];
    expect(commentBody).toContain("<!-- vercel-deploy-comment:default -->");
    expect(commentBody.indexOf("row:prj_web:preview")).toBeLessThan(
      commentBody.indexOf("row:prj_admin:preview"),
    );
    expect(commentBody.indexOf("row:prj_admin:preview")).toBeLessThan(
      commentBody.indexOf("row:prj_docs:preview"),
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

    const { run } = await import("../src/main");

    await expect(run()).resolves.toBeUndefined();

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
});
