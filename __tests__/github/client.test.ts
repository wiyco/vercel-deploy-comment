import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommentMarker } from "../../src/comment/markdown";
import {
  buildRunUrl,
  GitHubApiError,
  GitHubClient,
  type GitHubRuntimeContext,
  readGitHubRuntimeContext,
} from "../../src/github/client";
import type { FetchLike } from "../../src/shared/types";

const context: GitHubRuntimeContext = {
  apiUrl: "https://api.github.test",
  serverUrl: "https://github.test",
  owner: "acme",
  repo: "repo",
  runId: "123",
  issueNumber: 42,
};

describe("readGitHubRuntimeContext", () => {
  it("reads pull request event details from the environment", () => {
    const runtimeContext = readGitHubRuntimeContext(
      {
        GITHUB_REPOSITORY: "acme/repo",
        GITHUB_EVENT_PATH: "/tmp/event.json",
        GITHUB_RUN_ID: "123",
        GITHUB_API_URL: "https://api.github.test",
        GITHUB_SERVER_URL: "https://github.test",
      },
      () =>
        JSON.stringify({
          pull_request: {
            number: 42,
          },
        }),
    );

    expect(runtimeContext).toEqual(context);
    expect(buildRunUrl(runtimeContext)).toBe(
      "https://github.test/acme/repo/actions/runs/123",
    );
  });

  it("reads pull request events through the default event file reader", () => {
    const eventDirectory = mkdtempSync(
      join(tmpdir(), "vercel-deploy-comment-"),
    );
    const eventPath = join(eventDirectory, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 7,
        },
      }),
      "utf8",
    );

    const runtimeContext = readGitHubRuntimeContext({
      GITHUB_REPOSITORY: "acme/repo",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_RUN_ID: "456",
    });

    expect(runtimeContext).toEqual({
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      owner: "acme",
      repo: "repo",
      runId: "456",
      issueNumber: 7,
    });
  });

  it.each([
    "acme",
    "acme/",
    "/repo",
    "acme/repo/extra",
    "acme/repo/",
  ])("requires owner/repo repository names: %s", (repository) => {
    expect(() =>
      readGitHubRuntimeContext(
        {
          GITHUB_REPOSITORY: repository,
          GITHUB_EVENT_PATH: "/tmp/event.json",
          GITHUB_RUN_ID: "123",
        },
        () =>
          JSON.stringify({
            number: 42,
          }),
      ),
    ).toThrow("owner/repo");
  });

  it("rejects non pull request events", () => {
    expect(() =>
      readGitHubRuntimeContext(
        {
          GITHUB_REPOSITORY: "acme/repo",
          GITHUB_EVENT_PATH: "/tmp/event.json",
          GITHUB_RUN_ID: "123",
        },
        () => JSON.stringify({}),
      ),
    ).toThrow("pull request");
  });

  it("rejects events with only a top-level number", () => {
    expect(() =>
      readGitHubRuntimeContext(
        {
          GITHUB_REPOSITORY: "acme/repo",
          GITHUB_EVENT_PATH: "/tmp/event.json",
          GITHUB_RUN_ID: "123",
        },
        () =>
          JSON.stringify({
            number: 42,
          }),
      ),
    ).toThrow("pull request");
  });

  it("rejects fractional pull request numbers", () => {
    expect(() =>
      readGitHubRuntimeContext(
        {
          GITHUB_REPOSITORY: "acme/repo",
          GITHUB_EVENT_PATH: "/tmp/event.json",
          GITHUB_RUN_ID: "123",
        },
        () =>
          JSON.stringify({
            pull_request: {
              number: 42.5,
            },
          }),
      ),
    ).toThrow("pull request");
  });

  it("requires environment variables", () => {
    expect(() =>
      readGitHubRuntimeContext({}, () => JSON.stringify({})),
    ).toThrow("GITHUB_REPOSITORY is required");
  });
});

describe("GitHubClient", () => {
  it("updates an existing authenticated-user comment with the marker", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
      [
        {
          id: 10,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
          body: "old\n<!-- vercel-deploy-comment:default -->",
          user: {
            login: "github-actions[bot]",
          },
        },
      ],
      {
        id: 10,
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
      },
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    const result = await client.upsertPullRequestComment(
      "new\n<!-- vercel-deploy-comment:default -->",
      buildCommentMarker("default"),
    );

    expect(result.action).toBe("updated");
    expect(calls[2]?.init?.method).toBe("PATCH");
    expect(calls[2]?.url.pathname).toBe("/repos/acme/repo/issues/comments/10");
  });

  it("creates a new comment when a marker belongs to a different author", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
      [
        {
          id: 10,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
          body: "old\n<!-- vercel-deploy-comment:default -->",
          user: {
            login: "octocat",
          },
        },
      ],
      {
        id: 11,
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-11",
      },
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    const result = await client.upsertPullRequestComment(
      "new\n<!-- vercel-deploy-comment:default -->",
      buildCommentMarker("default"),
    );

    expect(result.action).toBe("created");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.url.pathname).toBe("/repos/acme/repo/issues/42/comments");
  });

  it("does not match comments whose marker only shares a prefix", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
      [
        {
          id: 10,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-10",
          body: "old\n<!-- vercel-deploy-comment:default2 -->",
          user: {
            login: "github-actions[bot]",
          },
        },
      ],
      {
        id: 11,
        html_url: "https://github.test/acme/repo/pull/42#issuecomment-11",
      },
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    const result = await client.upsertPullRequestComment(
      "new\n<!-- vercel-deploy-comment:default -->",
      buildCommentMarker("default"),
    );

    expect(result.action).toBe("created");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[2]?.url.pathname).toBe("/repos/acme/repo/issues/42/comments");
  });

  it("stops paginating after finding the matching authenticated-user comment", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const firstPage = Array.from({
      length: 100,
    }).map((_, index) => ({
      id: index,
      html_url: `https://github.test/acme/repo/pull/42#issuecomment-${index}`,
      body:
        index === 50
          ? "<!-- vercel-deploy-comment:default -->"
          : "no marker here",
      user: {
        login: "github-actions[bot]",
      },
    }));
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
      firstPage,
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    await expect(
      client.findExistingActionComment(buildCommentMarker("default")),
    ).resolves.toMatchObject({
      id: 50,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.get("page")).toBe("1");
  });

  it("paginates comments and caches the authenticated login", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const firstPage = Array.from({
      length: 100,
    }).map((_, index) => ({
      id: index,
      html_url: `https://github.test/acme/repo/pull/42#issuecomment-${index}`,
      body: "no marker here",
      user: {
        login: "github-actions[bot]",
      },
    }));
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
      firstPage,
      [
        {
          id: 101,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-101",
          body: "<!-- vercel-deploy-comment:default -->",
          user: {
            login: "github-actions[bot]",
          },
        },
      ],
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    await expect(
      client.findExistingActionComment(buildCommentMarker("default")),
    ).resolves.toMatchObject({
      id: 101,
    });
    await expect(client.getAuthenticatedLogin()).resolves.toBe(
      "github-actions[bot]",
    );

    expect(calls).toHaveLength(3);
    expect(calls[1]?.url.searchParams.get("page")).toBe("1");
    expect(calls[2]?.url.searchParams.get("page")).toBe("2");
  });

  it("lists pull request comments across all pages", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const firstPage = Array.from({
      length: 100,
    }).map((_, index) => ({
      id: index,
      html_url: `https://github.test/acme/repo/pull/42#issuecomment-${index}`,
    }));
    const fetchImplementation = responseQueue(calls, [
      firstPage,
      [
        {
          id: 101,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-101",
        },
        {
          id: 102,
          html_url: "https://github.test/acme/repo/pull/42#issuecomment-102",
        },
      ],
    ]);
    const client = new GitHubClient("ghs_token", context, fetchImplementation);

    await expect(client.listPullRequestComments()).resolves.toHaveLength(102);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get("page")).toBe("1");
    expect(calls[1]?.url.searchParams.get("page")).toBe("2");
  });

  it("preserves GitHub API base path prefixes", async () => {
    const calls: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const fetchImplementation = responseQueue(calls, [
      {
        login: "github-actions[bot]",
      },
    ]);
    const client = new GitHubClient(
      "ghs_token",
      {
        ...context,
        apiUrl: "https://github.example/api/v3",
      },
      fetchImplementation,
    );

    await expect(client.getAuthenticatedLogin()).resolves.toBe(
      "github-actions[bot]",
    );

    expect(calls[0]?.url.href).toBe("https://github.example/api/v3/user");
  });

  it("throws GitHubApiError on failed API responses", async () => {
    const calls: URL[] = [];
    const client = new GitHubClient(
      "ghs_token",
      {
        ...context,
        apiUrl: "https://api.github.test/",
      },
      async (input) => {
        const url = input instanceof URL ? input : new URL(input);
        calls.push(url);

        return new Response(
          JSON.stringify({
            message: "server error",
          }),
          {
            status: 500,
            statusText: "Internal Server Error",
          },
        );
      },
    );

    await expect(client.request("/user")).rejects.toMatchObject({
      name: "GitHubApiError",
      status: 500,
    });
    await expect(client.request("/user")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
    expect(calls[0]?.href).toBe("https://api.github.test/user");
  });
});

function responseQueue(
  calls: Array<{
    url: URL;
    init?: RequestInit;
  }>,
  payloads: unknown[],
): FetchLike {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(input);
    calls.push({
      url,
      init,
    });
    const payload = payloads.shift();

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };
}
