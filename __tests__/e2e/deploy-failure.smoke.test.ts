import { describe, expect, it } from "vitest";
import {
  createSmokeWorkspace,
  runBuiltAction,
} from "./helpers/run-built-action";

describe("deploy failure smoke", () => {
  it("flushes failed rows to the comment when comment-on-failure is true", () => {
    const workspace = createSmokeWorkspace({
      "package.json": '{"name":"web"}\n',
    });
    const result = runBuiltAction({
      fakeVercel: {
        deployUrl: "https://web-failed-octocat.vercel.app",
        failStep: "deploy",
      },
      fetchScenario: {
        vercelDeployments: {
          "web-failed-octocat.vercel.app": {
            project: {
              name: "Web Smoke",
            },
            readyState: "ERROR",
            url: "web-failed-octocat.vercel.app",
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
        "comment-marker": "failure-smoke",
        "comment-on-failure": "true",
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

    expect(result.exitCode).toBe(1);
    expect(result.failureDetails).toContain(
      "Vercel deploy failed with exit code 1.",
    );
    expect(JSON.parse(result.outputs.statuses ?? "[]")).toEqual([
      "failed",
    ]);
    expect(JSON.parse(result.outputs["deployment-urls"] ?? "[]")).toEqual([
      "https://web-failed-octocat.vercel.app/",
    ]);

    const comment = result.comments.at(-1);
    expect(comment?.body).toContain("Failed");
    expect(comment?.body).toContain("| N/A |");
  });
});
