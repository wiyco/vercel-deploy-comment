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
const GitHubClient = vi.fn(
  class {
    createPullRequestComment = createPullRequestComment;
    findExistingActionComment = findExistingActionComment;
    updatePullRequestComment = updatePullRequestComment;
  },
);
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

  it("runs deployments in parallel and updates the comment once after all rows are ready", async () => {
    const webDeployment = createDeferred<string>();
    const adminDeployment = createDeferred<string>();

    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      vercelToken: "vercel_token",
      mode: "deploy-and-comment",
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

        return adminDeployment.promise;
      },
    );

    const { run } = await import("../src/main");

    const runPromise = run();

    expect(runVercelDeploy).toHaveBeenCalledTimes(2);

    adminDeployment.resolve("https://admin-git-feature-team.vercel.app");
    await Promise.resolve();
    expect(createPullRequestComment).not.toHaveBeenCalled();

    webDeployment.resolve("https://web-git-feature-team.vercel.app");
    await expect(runPromise).resolves.toBeUndefined();

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    const commentBody = createPullRequestComment.mock.calls[0]?.[0];
    expect(commentBody).toContain("<!-- vercel-deploy-comment:default -->");
    expect(commentBody.indexOf("row:prj_web:preview")).toBeLessThan(
      commentBody.indexOf("row:prj_admin:preview"),
    );
    expect(setOutput).toHaveBeenNthCalledWith(
      3,
      "deployment-urls",
      JSON.stringify([
        "https://web-git-feature-team.vercel.app",
        "https://admin-git-feature-team.vercel.app",
      ]),
    );
    expect(setOutput).toHaveBeenNthCalledWith(
      4,
      "statuses",
      JSON.stringify([
        "ready",
        "ready",
      ]),
    );
  });
});
