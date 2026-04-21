import { readFileSync } from "node:fs";
import type { FetchLike } from "../shared/types";

type EventFileReader = (path: string, encoding: BufferEncoding) => string;

export interface GitHubRuntimeContext {
  apiUrl: string;
  serverUrl: string;
  owner: string;
  repo: string;
  runId: string;
  issueNumber: number;
}

interface PullRequestEventPayload {
  pull_request?: {
    number?: number;
  };
}

interface GitHubUser {
  login: string;
}

export interface IssueComment {
  id: number;
  html_url: string;
  body?: string;
  user?: {
    login?: string;
  };
}

export interface UpsertCommentResult {
  id: number;
  htmlUrl: string;
  action: "created" | "updated";
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function readGitHubRuntimeContext(
  env: NodeJS.ProcessEnv = process.env,
  readFile: EventFileReader = (path, encoding) => readFileSync(path, encoding),
): GitHubRuntimeContext {
  const repository = requireEnv(env, "GITHUB_REPOSITORY");
  const [owner, repo, ...extraSegments] = repository.split("/");

  if (!owner || !repo || extraSegments.length > 0) {
    throw new Error("GITHUB_REPOSITORY must be in owner/repo format.");
  }

  const eventPath = requireEnv(env, "GITHUB_EVENT_PATH");
  const payload = JSON.parse(
    readFile(eventPath, "utf8"),
  ) as PullRequestEventPayload;
  const issueNumber = payload.pull_request?.number;

  if (typeof issueNumber !== "number" || !Number.isInteger(issueNumber)) {
    throw new Error("This action must run on a pull request event.");
  }

  return {
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    serverUrl: env.GITHUB_SERVER_URL || "https://github.com",
    owner,
    repo,
    runId: requireEnv(env, "GITHUB_RUN_ID"),
    issueNumber,
  };
}

export function buildRunUrl(context: GitHubRuntimeContext): string {
  return `${context.serverUrl}/${context.owner}/${context.repo}/actions/runs/${context.runId}`;
}

export class GitHubClient {
  readonly #token: string;
  readonly #context: GitHubRuntimeContext;
  readonly #fetch: FetchLike;
  #authenticatedLogin?: string;

  constructor(
    token: string,
    context: GitHubRuntimeContext,
    fetchImplementation: FetchLike = fetch,
  ) {
    this.#token = token;
    this.#context = context;
    this.#fetch = fetchImplementation;
  }

  async upsertPullRequestComment(
    body: string,
    hiddenMarker: string,
  ): Promise<UpsertCommentResult> {
    const existingComment = await this.findExistingActionComment(hiddenMarker);

    if (existingComment) {
      return this.updatePullRequestComment(existingComment.id, body);
    }

    return this.createPullRequestComment(body);
  }

  async createPullRequestComment(body: string): Promise<UpsertCommentResult> {
    const created = await this.request<IssueComment>(
      `/repos/${this.#context.owner}/${this.#context.repo}/issues/${this.#context.issueNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body,
        }),
      },
    );

    return {
      id: created.id,
      htmlUrl: created.html_url,
      action: "created",
    };
  }

  async updatePullRequestComment(
    commentId: number,
    body: string,
  ): Promise<UpsertCommentResult> {
    const updated = await this.request<IssueComment>(
      `/repos/${this.#context.owner}/${this.#context.repo}/issues/comments/${commentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          body,
        }),
      },
    );

    return {
      id: updated.id,
      htmlUrl: updated.html_url,
      action: "updated",
    };
  }

  async findExistingActionComment(
    hiddenMarker: string,
  ): Promise<IssueComment | undefined> {
    const authenticatedLogin = await this.getAuthenticatedLogin();

    for (let page = 1; ; page += 1) {
      const pageComments = await this.#listPullRequestCommentPage(page);
      const matchingComment = pageComments.find((comment) =>
        isActionComment(comment, hiddenMarker, authenticatedLogin),
      );

      if (matchingComment) {
        return matchingComment;
      }

      if (pageComments.length < 100) {
        return undefined;
      }
    }
  }

  async listPullRequestComments(): Promise<IssueComment[]> {
    const comments: IssueComment[] = [];

    for (let page = 1; ; page += 1) {
      const pageComments = await this.#listPullRequestCommentPage(page);

      comments.push(...pageComments);

      if (pageComments.length < 100) {
        return comments;
      }
    }
  }

  async getAuthenticatedLogin(): Promise<string> {
    if (this.#authenticatedLogin) {
      return this.#authenticatedLogin;
    }

    const user = await this.request<GitHubUser>("/user");
    this.#authenticatedLogin = user.login;
    return user.login;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(
      stripLeadingSlash(path),
      ensureTrailingSlash(this.#context.apiUrl),
    );
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${this.#token}`);
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", "vercel-deploy-comment");
    headers.set("X-GitHub-Api-Version", "2022-11-28");

    const response = await this.#fetch(url, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub API request failed with status ${response.status} ${response.statusText}.`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  async #listPullRequestCommentPage(page: number): Promise<IssueComment[]> {
    return this.request<IssueComment[]>(
      `/repos/${this.#context.owner}/${this.#context.repo}/issues/${this.#context.issueNumber}/comments?per_page=100&page=${page}`,
    );
  }
}

function isActionComment(
  comment: IssueComment,
  hiddenMarker: string,
  authenticatedLogin: string,
): boolean {
  return (
    comment.user?.login === authenticatedLogin &&
    comment.body?.includes(hiddenMarker) === true
  );
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}
