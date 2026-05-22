import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedCommentWriter } from "../../src/comment/writer";
import { GitHubApiError, type IssueComment } from "../../src/github/client";
import { buildDeploymentRowKey } from "../../src/shared/deployment-key";
import type { DeploymentCommentRow } from "../../src/shared/types";

function buildRow(options: {
  environment?: string;
  previewUrl?: string;
  projectId: string;
  projectName?: string;
  statusLabel: string;
  statusEmoji: string;
  statusKey: string;
  updatedAtUtc?: string;
}): DeploymentCommentRow {
  return {
    environment: options.environment ?? "preview",
    previewUrl: options.previewUrl,
    projectId: options.projectId,
    projectName: options.projectName ?? options.projectId,
    projectUrl: `https://vercel.com/acme/${options.projectId}`,
    runUrl: "https://github.test/acme/repo/actions/runs/123",
    status: {
      emoji: options.statusEmoji,
      key: options.statusKey,
      label: options.statusLabel,
    },
    updatedAtUtc: options.updatedAtUtc ?? "2026-05-22T00:00:00.000Z",
  };
}

describe("ManagedCommentWriter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects flush before any comment has been published", async () => {
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [],
      marker: "default",
    });

    await expect(writer.flush()).rejects.toThrow(
      "Managed comment writer has not published a comment yet.",
    );
  });

  it("publishes incremental row snapshots while preserving unrelated rows", async () => {
    const createPullRequestComment = vi.fn(async (_body: string) => ({
      action: "created" as const,
      htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    }));
    const updatePullRequestComment = vi.fn(
      async (_commentId: number, _body: string) => ({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      }),
    );
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment,
      } as never,
      existingRows: [
        buildRow({
          projectId: "prj_docs",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
        buildDeploymentRowKey("prj_admin", "preview"),
      ],
      marker: "default",
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
      buildRow({
        projectId: "prj_admin",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.updateRow(
      buildRow({
        previewUrl: "https://web.vercel.app",
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );
    writer.updateRow(
      buildRow({
        previewUrl: "https://admin.vercel.app",
        projectId: "prj_admin",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );

    await writer.flush();

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    expect(updatePullRequestComment).toHaveBeenCalledTimes(2);

    const initialBody = createPullRequestComment.mock.calls[0]?.[0] ?? "";
    expect(initialBody).toContain("row:prj_web:preview");
    expect(initialBody).toContain("row:prj_admin:preview");
    expect(initialBody).toContain("row:prj_docs:preview");
    expect(initialBody).toContain("⏳ [In Progress]");

    const firstUpdateBody = updatePullRequestComment.mock.calls[0]?.[1] ?? "";
    expect(firstUpdateBody).toContain("✅ [Ready]");
    expect(firstUpdateBody).toContain("⏳ [In Progress]");
    expect(firstUpdateBody.indexOf("row:prj_web:preview")).toBeLessThan(
      firstUpdateBody.indexOf("row:prj_admin:preview"),
    );
    expect(firstUpdateBody.indexOf("row:prj_admin:preview")).toBeLessThan(
      firstUpdateBody.indexOf("row:prj_docs:preview"),
    );

    const secondUpdateBody = updatePullRequestComment.mock.calls[1]?.[1] ?? "";
    expect(secondUpdateBody).toContain("row:prj_web:preview");
    expect(secondUpdateBody).toContain("row:prj_admin:preview");
    expect(secondUpdateBody).toContain("row:prj_docs:preview");
    expect(secondUpdateBody).not.toContain("⏳ [In Progress]");
  });

  it("restores only the targeted rows from the initial snapshot", async () => {
    const updatePullRequestComment = vi.fn(
      async (_commentId: number, _body: string) => ({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      }),
    );
    const existingComment: IssueComment = {
      body: "existing body",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    };
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment,
      } as never,
      comment: existingComment,
      existingRows: [
        buildRow({
          projectId: "prj_web",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
          updatedAtUtc: "2026-05-21T00:00:00.000Z",
        }),
        buildRow({
          projectId: "prj_docs",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
          updatedAtUtc: "2026-05-21T00:01:00.000Z",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
        buildDeploymentRowKey("prj_new", "preview"),
      ],
      marker: "default",
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
      buildRow({
        projectId: "prj_new",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.restoreRow("prj_web", "preview");
    writer.restoreRow("prj_new", "preview");

    await writer.flush();

    expect(updatePullRequestComment).toHaveBeenCalledTimes(3);

    const restoredExistingRowBody =
      updatePullRequestComment.mock.calls[1]?.[1] ?? "";
    expect(restoredExistingRowBody).toContain("row:prj_web:preview");
    expect(restoredExistingRowBody).toContain("✅ [Ready]");
    expect(restoredExistingRowBody).toContain("row:prj_new:preview");

    const removedNewRowBody = updatePullRequestComment.mock.calls[2]?.[1] ?? "";
    expect(removedNewRowBody).toContain("row:prj_web:preview");
    expect(removedNewRowBody).toContain("row:prj_docs:preview");
    expect(removedNewRowBody).not.toContain("row:prj_new:preview");
  });

  it("enforces a minimum interval between mutative writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));

    const callTimes: number[] = [];
    const createPullRequestComment = vi.fn(async (_body: string) => {
      callTimes.push(Date.now());
      return {
        action: "created" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      };
    });
    const updatePullRequestComment = vi.fn(
      async (_commentId: number, _body: string) => {
        callTimes.push(Date.now());
        return {
          action: "updated" as const,
          htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
          id: 10,
        };
      },
    );
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment,
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.updateRow(
      buildRow({
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );
    writer.updateRow(
      buildRow({
        previewUrl: "https://web.vercel.app",
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
        updatedAtUtc: "2026-05-22T00:00:02.000Z",
      }),
    );

    const flushPromise = writer.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromise;

    expect(callTimes).toEqual([
      Date.parse("2026-05-22T00:00:00.000Z"),
      Date.parse("2026-05-22T00:00:01.000Z"),
      Date.parse("2026-05-22T00:00:02.000Z"),
    ]);
  });

  it("recovers a failed update when the refreshed comment already contains the intended body", async () => {
    const updatePullRequestComment = vi
      .fn<
        (
          commentId: number,
          body: string,
        ) => Promise<{
          action: "updated";
          htmlUrl: string;
          id: number;
        }>
      >()
      .mockResolvedValueOnce({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      })
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      );
    const getPullRequestComment = vi.fn(async () => ({
      body: updatePullRequestComment.mock.calls[1]?.[1] ?? "",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    }));
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment,
        updatePullRequestComment,
      } as never,
      comment: {
        body: "existing body",
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      },
      existingRows: [
        buildRow({
          projectId: "prj_web",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.updateRow(
      buildRow({
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );

    await expect(writer.flush()).resolves.toMatchObject({
      action: "updated",
      id: 10,
    });

    expect(updatePullRequestComment).toHaveBeenCalledTimes(2);
    expect(getPullRequestComment).toHaveBeenCalledWith(10);
  });

  it("retries an update when the refreshed comment body does not match", async () => {
    const updatePullRequestComment = vi
      .fn<
        (
          commentId: number,
          body: string,
        ) => Promise<{
          action: "updated";
          htmlUrl: string;
          id: number;
        }>
      >()
      .mockResolvedValueOnce({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      })
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      )
      .mockResolvedValueOnce({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      });
    const getPullRequestComment = vi.fn(async () => ({
      body: "different body",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    }));
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment,
        updatePullRequestComment,
      } as never,
      comment: {
        body: "existing body",
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      },
      existingRows: [
        buildRow({
          projectId: "prj_web",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.updateRow(
      buildRow({
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );

    await expect(writer.flush()).resolves.toMatchObject({
      action: "updated",
      id: 10,
    });

    expect(updatePullRequestComment).toHaveBeenCalledTimes(3);
    expect(getPullRequestComment).toHaveBeenCalledWith(10);
  });

  it("retries an update when the refreshed comment omits the body", async () => {
    const updatePullRequestComment = vi
      .fn<
        (
          commentId: number,
          body: string,
        ) => Promise<{
          action: "updated";
          htmlUrl: string;
          id: number;
        }>
      >()
      .mockResolvedValueOnce({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      })
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      )
      .mockResolvedValueOnce({
        action: "updated" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      });
    const getPullRequestComment = vi.fn(async () => ({
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    }));
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment,
        updatePullRequestComment,
      } as never,
      comment: {
        body: "existing body",
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      },
      existingRows: [
        buildRow({
          projectId: "prj_web",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);
    writer.updateRow(
      buildRow({
        projectId: "prj_web",
        statusEmoji: "✅",
        statusKey: "ready",
        statusLabel: "Ready",
      }),
    );

    await expect(writer.flush()).resolves.toMatchObject({
      action: "updated",
      id: 10,
    });

    expect(updatePullRequestComment).toHaveBeenCalledTimes(3);
    expect(getPullRequestComment).toHaveBeenCalledWith(10);
  });

  it("recovers a failed create when the managed comment already exists remotely", async () => {
    const createPullRequestComment = vi
      .fn<(body: string) => Promise<UpsertLike>>()
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      );
    const findExistingActionComment = vi.fn(async () => ({
      body: createPullRequestComment.mock.calls[0]?.[0] ?? "",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    }));
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment,
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);

    await expect(writer.flush()).resolves.toMatchObject({
      action: "created",
      id: 10,
    });

    expect(createPullRequestComment).toHaveBeenCalledTimes(1);
    expect(findExistingActionComment).toHaveBeenCalledTimes(1);
  });

  it("retries a failed create when the recovered managed comment omits the body", async () => {
    const createPullRequestComment = vi
      .fn<(body: string) => Promise<UpsertLike>>()
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      )
      .mockResolvedValueOnce({
        action: "created" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-11",
        id: 11,
      });
    const findExistingActionComment = vi.fn().mockResolvedValueOnce({
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-12",
      id: 12,
    });
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment,
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      maxWriteAttempts: 2,
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);

    await expect(writer.flush()).resolves.toMatchObject({
      action: "created",
      id: 11,
    });

    expect(createPullRequestComment).toHaveBeenCalledTimes(2);
    expect(findExistingActionComment).toHaveBeenCalledTimes(1);
  });

  it("retries a failed create when recovery cannot find a matching comment", async () => {
    const createPullRequestComment = vi
      .fn<(body: string) => Promise<UpsertLike>>()
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      )
      .mockResolvedValueOnce({
        action: "created" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-11",
        id: 11,
      });
    const findExistingActionComment = vi.fn().mockResolvedValueOnce({
      body: "different body",
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-12",
      id: 12,
    });
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment,
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      maxWriteAttempts: 2,
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);

    await expect(writer.flush()).resolves.toMatchObject({
      action: "created",
      id: 11,
    });

    expect(createPullRequestComment).toHaveBeenCalledTimes(2);
    expect(findExistingActionComment).toHaveBeenCalledTimes(1);
  });

  it("retries a failed create when recovery lookup throws", async () => {
    const createPullRequestComment = vi
      .fn<(body: string) => Promise<UpsertLike>>()
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 502 Bad Gateway.",
          502,
        ),
      )
      .mockResolvedValueOnce({
        action: "created" as const,
        htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-11",
        id: 11,
      });
    const findExistingActionComment = vi.fn(async () => {
      throw new Error("lookup failed");
    });
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment,
        findExistingActionComment,
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      maxWriteAttempts: 2,
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await writer.publishInitialRows([
      buildRow({
        projectId: "prj_web",
        statusEmoji: "⏳",
        statusKey: "in_progress",
        statusLabel: "In Progress",
      }),
    ]);

    await expect(writer.flush()).resolves.toMatchObject({
      action: "created",
      id: 11,
    });

    expect(createPullRequestComment).toHaveBeenCalledTimes(2);
    expect(findExistingActionComment).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-retryable GitHub API errors", async () => {
    const updatePullRequestComment = vi
      .fn<(commentId: number, body: string) => Promise<UpsertLike>>()
      .mockRejectedValueOnce(
        new GitHubApiError(
          "GitHub API request failed with status 400 Bad Request.",
          400,
        ),
      );
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment,
      } as never,
      comment: {
        body: "existing body",
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      },
      existingRows: [
        buildRow({
          projectId: "prj_web",
          statusEmoji: "✅",
          statusKey: "ready",
          statusLabel: "Ready",
        }),
      ],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      minWriteIntervalMs: 0,
      sleep: async () => {},
    });

    await expect(
      writer.publishInitialRows([
        buildRow({
          projectId: "prj_web",
          statusEmoji: "⏳",
          statusKey: "in_progress",
          statusLabel: "In Progress",
        }),
      ]),
    ).rejects.toThrow("400 Bad Request");
    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);
  });

  it("fails immediately when configured with zero write attempts", async () => {
    const writer = new ManagedCommentWriter({
      client: {
        createPullRequestComment: vi.fn(),
        findExistingActionComment: vi.fn(),
        getPullRequestComment: vi.fn(),
        updatePullRequestComment: vi.fn(),
      } as never,
      existingRows: [],
      header: "Preview",
      inputOrder: [
        buildDeploymentRowKey("prj_web", "preview"),
      ],
      marker: "default",
      maxWriteAttempts: 0,
    });

    await expect(
      writer.publishInitialRows([
        buildRow({
          projectId: "prj_web",
          statusEmoji: "⏳",
          statusKey: "in_progress",
          statusLabel: "In Progress",
        }),
      ]),
    ).rejects.toThrow("Managed comment writer exhausted all write attempts.");
  });
});

type UpsertLike = {
  action: "created" | "updated";
  htmlUrl: string;
  id: number;
};
