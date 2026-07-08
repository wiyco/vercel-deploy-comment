import { describe, expect, it } from "vitest";
import {
  createSmokeWorkspace,
  runBuiltAction,
} from "./helpers/run-built-action";

describe("deploy-and-comment smoke", () => {
  it("runs Vercel CLI steps in order and enriches the final comment", () => {
    const workspace = createSmokeWorkspace({
      ".git/config": "[core]\nrepositoryformatversion = 0\n",
      ".vercel/ignored.txt": "do-not-copy\n",
      "package.json": '{"name":"web"}\n',
      "src/index.js": "export const value = 1;\n",
    });
    const result = runBuiltAction({
      fakeVercel: {
        deployUrl: "https://web-git-feature-octocat.vercel.app",
      },
      fetchScenario: {
        vercelDeployments: {
          "web-git-feature-octocat.vercel.app": {
            project: {
              name: "Web Smoke",
            },
            readyState: "READY",
            url: "web-git-feature-octocat.vercel.app",
          },
        },
        vercelProjects: {
          "project-web": {
            id: "project-web",
            name: "Web Smoke",
          },
        },
      },
      inputs: {
        "comment-marker": "deploy-smoke",
        deployments: JSON.stringify([
          {
            cwd: workspace,
            environment: "preview",
            orgId: "team_123",
            projectId: "project-web",
            projectUrl: "https://vercel.com/octocat/web",
          },
        ]),
        "deployment-concurrency": "1",
        "github-token": "github_smoke_secret",
        mode: "deploy-and-comment",
        "vercel-token": "vercel_smoke_secret",
      },
    });

    expect(result.exitCode, result.failureDetails).toBe(0);
    expect(result.vercelCalls.map((call) => call.args)).toEqual([
      [
        "pull",
        "--yes",
        "--environment",
        "preview",
      ],
      [
        "build",
        "--yes",
      ],
      [
        "deploy",
        "--prebuilt",
      ],
    ]);
    expect(result.vercelCalls.map((call) => call.envToken)).toEqual([
      "vercel_smoke_secret",
      undefined,
      "vercel_smoke_secret",
    ]);
    expect(
      result.vercelCalls.every((call) => call.inputEnvKeys.length === 0),
    ).toBe(true);
    expect(
      result.vercelCalls.every((call) =>
        call.args.every((arg) => !arg.includes("vercel_smoke_secret")),
      ),
    ).toBe(true);
    expect(result.vercelCalls.every((call) => call.sourceFileExists)).toBe(
      true,
    );
    expect(result.vercelCalls.every((call) => !call.gitDirectoryExists)).toBe(
      true,
    );
    expect(
      result.vercelCalls.every((call) => !call.ignoredVercelFileExists),
    ).toBe(true);
    expect(result.vercelCalls[0]?.projectFile).toContain(
      '"projectId": "project-web"',
    );
    expect(result.vercelCalls[0]?.projectFile).toContain('"orgId": "team_123"');
    expect(JSON.parse(result.outputs.statuses ?? "[]")).toEqual([
      "ready",
    ]);
    expect(JSON.parse(result.outputs["deployment-urls"] ?? "[]")).toEqual([
      "https://web-git-feature-octocat.vercel.app/",
    ]);

    const comment = result.comments.at(-1);
    expect(comment?.body).toContain("Web Smoke");
    expect(comment?.body).toContain("Ready");
    expect(comment?.body).toContain(
      "[Preview](https://web-git-feature-octocat.vercel.app/)",
    );
  });
});
