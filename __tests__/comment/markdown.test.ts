import { describe, expect, it } from "vitest";
import {
  buildCommentMarker,
  buildRowMarker,
  parseDeploymentCommentRows,
  renderDeploymentComment,
  upsertDeploymentCommentRows,
} from "../../src/comment/markdown";
import { buildDeploymentRowKey } from "../../src/shared/deployment-key";

describe("renderDeploymentComment", () => {
  it("renders the required table with row markers, footer, and marker", () => {
    const markdown = renderDeploymentComment({
      header: "Vercel Preview Deployment",
      footer: "See the preview before merging.",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
        {
          environment: "preview",
          projectId: "prj_admin",
          projectName: "admin",
          projectUrl: "https://vercel.com/team/admin",
          previewUrl: "https://admin-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "failed",
            emoji: "\u274c",
            label: "Failed",
          },
          updatedAtUtc: "2026-04-19T00:01:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("## Vercel Preview Deployment");
    expect(markdown).toContain(
      "| Project | Status | Preview | Updated (UTC) |",
    );
    expect(markdown).toContain(buildRowMarker("prj_web", "preview"));
    expect(markdown).toContain(buildRowMarker("prj_admin", "preview"));
    expect(markdown).toContain(
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | \u2705 [Ready]`,
    );
    expect(markdown).toContain("2026-04-19 00:00:00 UTC");
    expect(markdown).toContain("2026-04-19 00:01:00 UTC");
    expect(markdown).not.toContain("2026-04-19T00:00:00.000Z");
    expect(markdown).toContain("See the preview before merging.");
    expect(markdown).toContain(buildCommentMarker("default"));
  });

  it("adds an Environment column when any row uses a custom environment", () => {
    const markdown = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
        {
          environment: "staging",
          projectId: "prj_admin",
          projectName: "admin",
          projectUrl: "https://vercel.com/team/admin",
          previewUrl: "https://admin-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:01:00.000Z",
        },
      ],
    });

    expect(markdown).toContain(
      "| Project | Environment | Status | Preview | Updated (UTC) |",
    );
    expect(markdown).toContain("| staging | \u2705 [Ready]");
    expect(markdown).toContain("| preview | \u2705 [Ready]");
  });

  it("escapes table-sensitive text", () => {
    const markdown = renderDeploymentComment({
      header: "Preview\nDeployments",
      marker: "default",
      rows: [
        {
          environment: "staging | blue",
          projectId: "prj_web",
          projectName: "web | app [main]",
          projectUrl: "https://vercel.com/team/web",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
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
    expect(markdown).toContain("| staging \\| blue |");
    expect(markdown).toContain("| Unavailable |");
  });

  it("keeps invalid timestamps unchanged", () => {
    const markdown = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "not-a-date",
        },
      ],
    });

    expect(markdown).toContain("| not-a-date |");
  });

  it("allows HTTP status links and escapes URL parentheses", () => {
    const markdown = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app/(preview)",
          runUrl: "http://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("[web](https://vercel.com/team/web)");
    expect(markdown).toContain(
      "[Preview](https://web-git-feature-team.vercel.app/%28preview%29)",
    );
    expect(markdown).toContain(
      "[Ready](http://github.com/acme/repo/actions/runs/123)",
    );
  });

  it.each([
    {
      name: "project links",
      row: {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "http://vercel.com/team/web",
        previewUrl: "https://web-git-feature-team.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/123",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:00:00.000Z",
      },
    },
    {
      name: "preview links",
      row: {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "http://web-git-feature-team.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/123",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:00:00.000Z",
      },
    },
  ])("rejects non-https $name", ({ row }) => {
    expect(() =>
      renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          row,
        ],
      }),
    ).toThrow("https URLs");
  });

  it("rejects non-http status links", () => {
    expect(() =>
      renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          {
            environment: "preview",
            projectId: "prj_web",
            projectName: "web",
            projectUrl: "https://vercel.com/team/web",
            runUrl: "ftp://github.com/acme/repo/actions/runs/123",
            status: {
              key: "ready",
              emoji: "\u2705",
              label: "Ready",
            },
            updatedAtUtc: "2026-04-19T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow("http and https");
  });
});

describe("parseDeploymentCommentRows", () => {
  it("parses rows rendered without an Environment column", () => {
    const body = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectName: "web | app",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "ready",
            emoji: "\u2705",
            label: "Ready",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web | app",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "https://web-git-feature-team.vercel.app/",
        runUrl: "https://github.com/acme/repo/actions/runs/123",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19 00:00:00 UTC",
      },
    ]);
  });

  it("parses rows rendered with an Environment column", () => {
    const body = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "staging",
          projectId: "prj_web",
          projectName: "web",
          projectUrl: "https://vercel.com/team/web",
          previewUrl: "https://web-git-feature-team.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/123",
          status: {
            key: "in_progress",
            emoji: "\u23f3",
            label: "In Progress",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "staging",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "https://web-git-feature-team.vercel.app/",
        runUrl: "https://github.com/acme/repo/actions/runs/123",
        status: {
          key: "in_progress",
          emoji: "\u23f3",
          label: "In Progress",
        },
        updatedAtUtc: "2026-04-19 00:00:00 UTC",
      },
    ]);
  });

  it("parses unavailable previews and normalizes known and custom status labels", () => {
    const body = renderDeploymentComment({
      header: "Preview",
      marker: "default",
      rows: [
        {
          environment: "preview",
          projectId: "prj_failed",
          projectName: "failed",
          projectUrl: "https://vercel.com/team/failed",
          previewUrl: "https://failed.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/1",
          status: {
            key: "failed",
            emoji: "X",
            label: "Failed",
          },
          updatedAtUtc: "2026-04-19T00:00:00.000Z",
        },
        {
          environment: "preview",
          projectId: "prj_cancelled",
          projectName: "cancelled",
          projectUrl: "https://vercel.com/team/cancelled",
          previewUrl: "https://cancelled.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/2",
          status: {
            key: "cancelled",
            emoji: "!",
            label: "Cancelled",
          },
          updatedAtUtc: "2026-04-19T00:01:00.000Z",
        },
        {
          environment: "preview",
          projectId: "prj_skipped",
          projectName: "skipped",
          projectUrl: "https://vercel.com/team/skipped",
          runUrl: "https://github.com/acme/repo/actions/runs/3",
          status: {
            key: "skipped",
            emoji: "-",
            label: "Skipped",
          },
          updatedAtUtc: "2026-04-19T00:02:00.000Z",
        },
        {
          environment: "preview",
          projectId: "prj_unknown",
          projectName: "unknown",
          projectUrl: "https://vercel.com/team/unknown",
          previewUrl: "https://unknown.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/4",
          status: {
            key: "unknown",
            emoji: "?",
            label: "Unknown",
          },
          updatedAtUtc: "2026-04-19T00:03:00.000Z",
        },
        {
          environment: "preview",
          projectId: "prj_custom",
          projectName: "custom",
          projectUrl: "https://vercel.com/team/custom",
          previewUrl: "https://custom.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/5",
          status: {
            key: "pending_review",
            emoji: "~",
            label: "Pending Review",
          },
          updatedAtUtc: "2026-04-19T00:04:00.000Z",
        },
      ],
    });

    expect(
      parseDeploymentCommentRows(body).map((row) => ({
        projectId: row.projectId,
        previewUrl: row.previewUrl,
        statusKey: row.status.key,
      })),
    ).toEqual([
      {
        projectId: "prj_failed",
        previewUrl: "https://failed.vercel.app/",
        statusKey: "failed",
      },
      {
        projectId: "prj_cancelled",
        previewUrl: "https://cancelled.vercel.app/",
        statusKey: "cancelled",
      },
      {
        projectId: "prj_skipped",
        previewUrl: undefined,
        statusKey: "skipped",
      },
      {
        projectId: "prj_unknown",
        previewUrl: "https://unknown.vercel.app/",
        statusKey: "unknown",
      },
      {
        projectId: "prj_custom",
        previewUrl: "https://custom.vercel.app/",
        statusKey: "pending_review",
      },
    ]);
  });

  it.each([
    [
      "non-table rows with markers",
      `${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |`,
    ],
    [
      "rows with an empty project cell",
      `|  | ${buildRowMarker("prj_web", "preview")} X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |`,
    ],
    [
      "rows with an empty project label",
      `| ${buildRowMarker("prj_web", "preview")} [](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |`,
    ],
    [
      "rows with status cells missing an emoji prefix",
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |`,
    ],
    [
      "rows with malformed status links",
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready] | [Preview](https://web.vercel.app) | now |`,
    ],
    [
      "rows with a malformed row marker missing the environment separator",
      "| <!-- vercel-deploy-comment:row:prj_web --> [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |",
    ],
    [
      "rows with a malformed row marker missing the project id",
      "| <!-- vercel-deploy-comment:row::preview --> [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |",
    ],
    [
      "rows with a malformed row marker missing the environment",
      "| <!-- vercel-deploy-comment:row:prj_web: --> [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://web.vercel.app) | now |",
    ],
  ])("ignores %s", (_name, line) => {
    expect(parseDeploymentCommentRows(line)).toEqual([]);
  });

  it("ignores rows with malformed marker percent-encoding and keeps valid rows", () => {
    const body = [
      "| <!-- vercel-deploy-comment:row:prj_bad:%E0%A4%A --> [bad](https://vercel.com/team/bad) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://bad.vercel.app) | now |",
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/2) | [Preview](https://web.vercel.app) | now |`,
    ].join("\n");

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "https://web.vercel.app/",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "X",
          label: "Ready",
        },
        updatedAtUtc: "now",
      },
    ]);
  });

  it("ignores rows with invalid URLs and keeps parsing later rows", () => {
    const body = [
      `| ${buildRowMarker("prj_bad", "preview")} [bad](https://%zz) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://bad.vercel.app) | now |`,
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/2) | [Preview](https://web.vercel.app) | later |`,
    ].join("\n");

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "https://web.vercel.app/",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "X",
          label: "Ready",
        },
        updatedAtUtc: "later",
      },
    ]);
  });

  it("ignores rows with non-https project URLs and keeps later rows", () => {
    const body = [
      `| ${buildRowMarker("prj_bad", "preview")} [bad](http://vercel.com/team/bad) | X [Ready](https://github.com/acme/repo/actions/runs/1) | [Preview](https://bad.vercel.app) | now |`,
      `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/2) | [Preview](https://web.vercel.app) | later |`,
    ].join("\n");

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: "https://web.vercel.app/",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "X",
          label: "Ready",
        },
        updatedAtUtc: "later",
      },
    ]);
  });

  it("drops non-https preview links while keeping the row", () => {
    const body = `| ${buildRowMarker("prj_web", "preview")} [web](https://vercel.com/team/web) | X [Ready](https://github.com/acme/repo/actions/runs/2) | [Preview](http://web.vercel.app) | later |`;

    expect(parseDeploymentCommentRows(body)).toEqual([
      {
        environment: "preview",
        projectId: "prj_web",
        projectName: "web",
        projectUrl: "https://vercel.com/team/web",
        previewUrl: undefined,
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "X",
          label: "Ready",
        },
        updatedAtUtc: "later",
      },
    ]);
  });
});

describe("upsertDeploymentCommentRows", () => {
  it("updates only the targeted row and preserves unrelated rows", () => {
    const existingRows = [
      {
        environment: "staging",
        projectId: "prj_staging",
        projectName: "staging",
        projectUrl: "https://vercel.com/team/staging",
        previewUrl: "https://staging-old.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/1",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:00:00.000Z",
      },
      {
        environment: "beta",
        projectId: "prj_beta",
        projectName: "beta",
        projectUrl: "https://vercel.com/team/beta",
        previewUrl: "https://beta-old.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/1",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:01:00.000Z",
      },
    ];

    const result = upsertDeploymentCommentRows(
      existingRows,
      [
        {
          environment: "staging",
          projectId: "prj_staging",
          projectName: "staging",
          projectUrl: "https://vercel.com/team/staging",
          previewUrl: "https://staging-new.vercel.app",
          runUrl: "https://github.com/acme/repo/actions/runs/2",
          status: {
            key: "failed",
            emoji: "\u274c",
            label: "Failed",
          },
          updatedAtUtc: "2026-04-20T00:00:00.000Z",
        },
      ],
      [
        buildDeploymentRowKey("prj_staging", "staging"),
      ],
    );

    expect(result).toEqual([
      {
        environment: "staging",
        projectId: "prj_staging",
        projectName: "staging",
        projectUrl: "https://vercel.com/team/staging",
        previewUrl: "https://staging-new.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "failed",
          emoji: "\u274c",
          label: "Failed",
        },
        updatedAtUtc: "2026-04-20T00:00:00.000Z",
      },
      existingRows[1],
    ]);
  });

  it("adds new rows in input order before untouched existing rows", () => {
    const existingRows = [
      {
        environment: "staging",
        projectId: "prj_staging",
        projectName: "staging",
        projectUrl: "https://vercel.com/team/staging",
        previewUrl: "https://staging.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/1",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:00:00.000Z",
      },
    ];
    const nextRows = [
      {
        environment: "production",
        projectId: "prj_prod",
        projectName: "prod",
        projectUrl: "https://vercel.com/team/prod",
        previewUrl: "https://prod.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-20T00:00:00.000Z",
      },
      {
        environment: "beta",
        projectId: "prj_beta",
        projectName: "beta",
        projectUrl: "https://vercel.com/team/beta",
        previewUrl: "https://beta.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-20T00:01:00.000Z",
      },
    ];

    expect(
      upsertDeploymentCommentRows(existingRows, nextRows, [
        buildDeploymentRowKey("prj_beta", "beta"),
        buildDeploymentRowKey("prj_prod", "production"),
      ]),
    ).toEqual([
      nextRows[1],
      nextRows[0],
      existingRows[0],
    ]);
  });

  it("deduplicates input order and ignores missing replacement rows", () => {
    const existingRows = [
      {
        environment: "staging",
        projectId: "prj_staging",
        projectName: "staging",
        projectUrl: "https://vercel.com/team/staging",
        previewUrl: "https://staging.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/1",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-19T00:00:00.000Z",
      },
    ];
    const nextRows = [
      {
        environment: "beta",
        projectId: "prj_beta",
        projectName: "beta",
        projectUrl: "https://vercel.com/team/beta",
        previewUrl: "https://beta.vercel.app",
        runUrl: "https://github.com/acme/repo/actions/runs/2",
        status: {
          key: "ready",
          emoji: "\u2705",
          label: "Ready",
        },
        updatedAtUtc: "2026-04-20T00:01:00.000Z",
      },
    ];

    expect(
      upsertDeploymentCommentRows(existingRows, nextRows, [
        buildDeploymentRowKey("prj_beta", "beta"),
        buildDeploymentRowKey("prj_beta", "beta"),
        buildDeploymentRowKey("prj_missing", "preview"),
      ]),
    ).toEqual([
      nextRows[0],
      existingRows[0],
    ]);
  });
});
