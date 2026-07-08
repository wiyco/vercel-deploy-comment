import { describe, expect, it } from "vitest";
import { runBuiltAction } from "./helpers/run-built-action";

describe("comment-only smoke", () => {
  it("runs dist/index.js and writes deployment outputs and table markers", () => {
    const result = runBuiltAction({
      inputs: {
        "comment-marker": "smoke",
        deployments: JSON.stringify([
          {
            deploymentUrl: "https://web-preview.vercel.app",
            displayName: "Web App",
            environment: "preview",
            projectId: "project-web",
            projectUrl: "https://vercel.com/octocat/web",
            status: "ready",
          },
        ]),
        "github-token": "github_smoke_secret",
        header: "Smoke Preview",
        mode: "comment-only",
      },
    });

    expect(result.exitCode, result.failureDetails).toBe(0);
    expect(result.outputs["comment-id"]).toBe("1000");
    expect(result.outputs["comment-url"]).toBe(
      "https://github.test/octocat/repo/pull/42#issuecomment-1000",
    );
    expect(JSON.parse(result.outputs["deployment-urls"] ?? "[]")).toEqual([
      "https://web-preview.vercel.app/",
    ]);
    expect(JSON.parse(result.outputs.statuses ?? "[]")).toEqual([
      "ready",
    ]);

    const comment = result.comments.at(-1);
    expect(comment?.body).toContain("## Smoke Preview");
    expect(comment?.body).toContain("<!-- vercel-deploy-comment:smoke -->");
    expect(comment?.body).toContain(
      "<!-- vercel-deploy-comment:row:project-web:preview -->",
    );
    expect(comment?.body).toContain(
      "[Preview](https://web-preview.vercel.app/)",
    );
  });
});
