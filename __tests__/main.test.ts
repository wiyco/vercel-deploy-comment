import { beforeEach, describe, expect, it, vi } from "vitest";

const setSecret = vi.fn();
const warning = vi.fn();

const readActionInputs = vi.fn();
const buildRunUrl = vi.fn(
  () => "https://github.test/acme/repo/actions/runs/123",
);
const readGitHubRuntimeContext = vi.fn(() => ({
  apiUrl: "https://api.github.test",
  serverUrl: "https://github.test",
  owner: "acme",
  repo: "repo",
  runId: "123",
  issueNumber: 42,
}));
const runVercelDeploy = vi.fn();

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  setSecret,
  warning,
}));

vi.mock("../src/action/input", () => ({
  readActionInputs,
}));

vi.mock("../src/github/client", () => ({
  GitHubClient: class {},
  buildRunUrl,
  readGitHubRuntimeContext,
}));

vi.mock("../src/vercel/deployment", () => ({
  getVercelDeploymentDetails: vi.fn(),
  getVercelProjectDetails: vi.fn(),
  runVercelDeploy,
  toHttpUrl: vi.fn(),
}));

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
});
