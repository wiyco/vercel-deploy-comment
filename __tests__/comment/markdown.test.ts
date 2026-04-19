import { describe, expect, it } from "vitest";
import {
  buildCommentMarker,
  renderDeploymentComment,
} from "../../src/comment/markdown";

describe("renderDeploymentComment", () => {
  it("renders the required table with multiple rows, footer, and marker", () => {
    const markdown = renderDeploymentComment({
      header: "Vercel Preview Deployment",
      footer: "See the preview before merging.",
      marker: "default",
      rows: [
        {
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "✅",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
        {
          projectName: "admin",
          projectUrl: "https://vercel.com/team/admin",
          previewUrl: "https://admin-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "failed",
            emoji: "❌",
            label: "Failed",
          },
          updatedAtUtc: "2026-04-19T00:01:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("## Vercel Preview Deployment");
    expect(markdown).toContain(
      "| Project | Deployment | Preview | Updated (UTC) |",
    );
    expect(markdown).toContain(
      "| [web](https://vercel.com/team/web) | ✅ [Ready]",
    );
    expect(markdown).toContain(
      "| [admin](https://vercel.com/team/admin) | ❌ [Failed]",
    );
    expect(markdown).toContain("2026-04-19 00:00:00 UTC");
    expect(markdown).toContain("2026-04-19 00:01:00 UTC");
    expect(markdown).not.toContain("2026-04-19T00:00:00.000Z");
    expect(markdown).toContain("See the preview before merging.");
    expect(markdown).toContain(buildCommentMarker("default"));
  });

  it("escapes table-sensitive text", () => {
    const markdown = renderDeploymentComment({
      header: "Preview\nDeployments",
      marker: "default",
      rows: [
        {
          projectName: "web | app [main]",
          projectUrl: "https://vercel.com/team/web",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "✅",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("## Preview Deployments");
    expect(markdown).toContain(
      "[web \\| app \\[main\\]](https://vercel.com/team/web)",
    );
    expect(markdown).toContain("| Unavailable |");
  });

  it("keeps invalid timestamps unchanged", () => {
    const markdown = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "✅",
            label: "Ready",
          },
          updatedAtUtc: "not-a-date",
        },
      ],
    });

    expect(markdown).toContain("| not-a-date |");
  });

  it("allows HTTP links and escapes URL parentheses", () => {
    const markdown = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          projectName: "web",
          projectUrl: "http://vercel.com/team/web",
          previewUrl: "http://web-git-feature-team.vercel.app/(preview)",
          runUrl: "http://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "✅",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("[web](http://vercel.com/team/web)");
    expect(markdown).toContain(
      "[Preview](http://web-git-feature-team.vercel.app/%28preview%29)",
    );
  });

  it("rejects non-HTTP markdown links", () => {
    expect(() =>
      renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          {
            projectName: "web",
            projectUrl: "ftp://vercel.com/team/web",
            runUrl: "https://github.com/acme/repo/actions/runs/123",
            status: {
              key: "ready",
              emoji: "✅",
              label: "Ready",
            },
            updatedAtUtc: "2026-04-19T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow("http and https");
  });
});
