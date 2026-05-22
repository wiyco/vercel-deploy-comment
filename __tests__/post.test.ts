import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseDeploymentCommentRows,
  renderDeploymentComment,
} from "../src/comment/markdown";
import type { DeploymentCommentRow } from "../src/shared/types";

const getState = vi.fn();
const setFailed = vi.fn();
const setSecret = vi.fn();

const readActionInputs = vi.fn();
const buildRunUrl = vi.fn(
  () => "https://github.test/acme/repo/actions/runs/999",
);
const readGitHubRuntimeContext = vi.fn(() => ({
  apiUrl: "https://api.github.test",
  graphqlUrl: "https://api.github.test/graphql",
  serverUrl: "https://github.test",
  owner: "acme",
  repo: "repo",
  runId: "999",
  issueNumber: 42,
}));
const createPullRequestComment = vi.fn();
const findExistingActionComment = vi.fn();
const getPullRequestComment = vi.fn();
const updatePullRequestComment = vi.fn();
const GitHubClient = vi.fn().mockImplementation(function MockGitHubClient() {
  return {
    createPullRequestComment,
    findExistingActionComment,
    getPullRequestComment,
    updatePullRequestComment,
  };
});

vi.mock("@actions/core", () => ({
  getState,
  saveState: vi.fn(),
  setFailed,
  setSecret,
}));

vi.mock("../src/action/input", () => ({
  readActionInputs,
}));

vi.mock("../src/github/client", () => ({
  GitHubClient,
  buildRunUrl,
  readGitHubRuntimeContext,
}));

function buildRow(options: {
  environment?: string;
  previewUrl?: string;
  projectId: string;
  projectName?: string;
  runUrl?: string;
  statusEmoji: string;
  statusKey: string;
  statusLabel: string;
  updatedAtUtc?: string;
}): DeploymentCommentRow {
  return {
    environment: options.environment ?? "preview",
    previewUrl: options.previewUrl,
    projectId: options.projectId,
    projectName: options.projectName ?? options.projectId,
    projectUrl: `https://vercel.com/acme/${options.projectId}`,
    runUrl: options.runUrl ?? "https://github.test/acme/repo/actions/runs/123",
    status: {
      emoji: options.statusEmoji,
      key: options.statusKey,
      label: options.statusLabel,
    },
    updatedAtUtc: options.updatedAtUtc ?? "2026-05-22T00:00:00.000Z",
  };
}

describe("post run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T01:23:45.000Z"));
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
      ],
      header: "Preview",
      footer: "Managed by action",
      commentMarker: "default",
      status: "success",
      commentOnFailure: true,
    });
    getState.mockImplementation((name: string) => {
      if (name === "cancel-handling-target") {
        return "true";
      }

      if (name === "initial-rows-published") {
        return "true";
      }

      return "";
    });
    updatePullRequestComment.mockResolvedValue({
      action: "updated",
      htmlUrl: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });
  });

  it("marks only current invocation in-progress rows as cancelled", async () => {
    findExistingActionComment.mockResolvedValue({
      body: renderDeploymentComment({
        footer: "Managed by action",
        header: "Preview",
        marker: "default",
        rows: [
          buildRow({
            previewUrl: "https://web.vercel.app",
            projectId: "prj_web",
            statusEmoji: "⏳",
            statusKey: "in_progress",
            statusLabel: "In Progress",
          }),
          buildRow({
            previewUrl: "https://admin.vercel.app",
            projectId: "prj_admin",
            statusEmoji: "✅",
            statusKey: "ready",
            statusLabel: "Ready",
          }),
          buildRow({
            previewUrl: "https://docs.vercel.app",
            projectId: "prj_docs",
            statusEmoji: "⏳",
            statusKey: "in_progress",
            statusLabel: "In Progress",
          }),
        ],
      }),
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });

    const { run } = await import("../src/post");

    await expect(run()).resolves.toBeUndefined();

    expect(setSecret).toHaveBeenNthCalledWith(1, "ghs_token");
    expect(setSecret).toHaveBeenNthCalledWith(2, "vercel_token");
    expect(updatePullRequestComment).toHaveBeenCalledTimes(1);

    const updatedBody = updatePullRequestComment.mock.calls[0]?.[1] ?? "";
    const rows = parseDeploymentCommentRows(updatedBody);
    const webRow = rows.find((row) => row.projectId === "prj_web");
    const adminRow = rows.find((row) => row.projectId === "prj_admin");
    const docsRow = rows.find((row) => row.projectId === "prj_docs");

    expect(webRow).toMatchObject({
      previewUrl: undefined,
      projectName: "prj_web",
      projectUrl: "https://vercel.com/acme/prj_web",
      runUrl: "https://github.test/acme/repo/actions/runs/999",
      updatedAtUtc: "2026-05-22 01:23:45 UTC",
      status: {
        key: "cancelled",
        label: "Cancelled",
      },
    });
    expect(adminRow?.status.key).toBe("ready");
    expect(adminRow?.runUrl).toBe(
      "https://github.test/acme/repo/actions/runs/123",
    );
    expect(docsRow?.status.key).toBe("in_progress");
    expect(docsRow?.runUrl).toBe(
      "https://github.test/acme/repo/actions/runs/123",
    );
    expect(updatedBody).toContain("🚫 [Cancelled]");
    expect(updatedBody).toContain("⏳ [In Progress]");
  });

  it("does not overwrite rows after main completed", async () => {
    getState.mockImplementation((name: string) => {
      if (name === "cancel-handling-target") {
        return "true";
      }

      if (name === "initial-rows-published") {
        return "true";
      }

      if (name === "main-completed") {
        return "true";
      }

      return "";
    });
    findExistingActionComment.mockResolvedValue({
      body: renderDeploymentComment({
        header: "Preview",
        marker: "default",
        rows: [
          buildRow({
            previewUrl: "https://web.vercel.app",
            projectId: "prj_web",
            statusEmoji: "⏳",
            statusKey: "in_progress",
            statusLabel: "In Progress",
          }),
        ],
      }),
      html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      id: 10,
    });

    const { run } = await import("../src/post");

    await expect(run()).resolves.toBeUndefined();

    expect(findExistingActionComment).not.toHaveBeenCalled();
    expect(updatePullRequestComment).not.toHaveBeenCalled();
  });

  it("does nothing when initial rows were never published", async () => {
    getState.mockImplementation((name: string) => {
      if (name === "cancel-handling-target") {
        return "true";
      }

      return "";
    });

    const { run } = await import("../src/post");

    await expect(run()).resolves.toBeUndefined();

    expect(findExistingActionComment).not.toHaveBeenCalled();
    expect(createPullRequestComment).not.toHaveBeenCalled();
    expect(updatePullRequestComment).not.toHaveBeenCalled();
  });

  it("does nothing in comment-only mode", async () => {
    readActionInputs.mockReturnValue({
      githubToken: "ghs_token",
      mode: "comment-only",
      deployments: [
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
          deploymentUrl: "https://web.vercel.app",
          status: "in_progress",
        },
      ],
      header: "Preview",
      footer: undefined,
      commentMarker: "default",
      status: "success",
      commentOnFailure: false,
    });

    const { run } = await import("../src/post");

    await expect(run()).resolves.toBeUndefined();

    expect(findExistingActionComment).not.toHaveBeenCalled();
    expect(updatePullRequestComment).not.toHaveBeenCalled();
  });

  it("does nothing when the managed comment is missing or no current row is in progress", async () => {
    findExistingActionComment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        body: renderDeploymentComment({
          header: "Preview",
          marker: "default",
          rows: [
            buildRow({
              previewUrl: "https://web.vercel.app",
              projectId: "prj_web",
              statusEmoji: "✅",
              statusKey: "ready",
              statusLabel: "Ready",
            }),
            buildRow({
              previewUrl: "https://admin.vercel.app",
              projectId: "prj_admin",
              statusEmoji: "❌",
              statusKey: "failed",
              statusLabel: "Failed",
            }),
          ],
        }),
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
        id: 10,
      });

    const { run } = await import("../src/post");

    await expect(run()).resolves.toBeUndefined();
    await expect(run()).resolves.toBeUndefined();

    expect(updatePullRequestComment).not.toHaveBeenCalled();
  });
});
