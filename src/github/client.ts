import { readFileSync } from "node:fs";
import type { FetchLike } from "../shared/types";

type EventFileReader = (path: string, encoding: BufferEncoding) => string;

export interface GitHubRuntimeContext {
  apiUrl: string;
  graphqlUrl: string;
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

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message?: string;
  }>;
}

interface ViewerQueryResult {
  viewer?: {
    login?: string;
  };
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
    graphqlUrl:
      env.GITHUB_GRAPHQL_URL ||
      deriveGraphqlUrl(env.GITHUB_API_URL || "https://api.github.com"),
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

    const response = await this.graphqlRequest<ViewerQueryResult>(
      `query ViewerLogin {
        viewer {
          login
        }
      }`,
    );
    const login = response.viewer?.login;

    if (!login) {
      throw new Error("GitHub GraphQL response did not include viewer.login.");
    }

    this.#authenticatedLogin = login;
    return login;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(
      stripLeadingSlash(path),
      ensureTrailingSlash(this.#context.apiUrl),
    );
    return this.#requestJson<T>(url, init);
  }

  async #listPullRequestCommentPage(page: number): Promise<IssueComment[]> {
    return this.request<IssueComment[]>(
      `/repos/${this.#context.owner}/${this.#context.repo}/issues/${this.#context.issueNumber}/comments?per_page=100&page=${page}`,
    );
  }

  async graphqlRequest<T>(query: string): Promise<T> {
    const response = await this.#requestJson<GraphQLResponse<T>>(
      new URL(this.#context.graphqlUrl),
      {
        method: "POST",
        body: JSON.stringify({
          query,
        }),
      },
    );

    if (response.errors?.length) {
      throw new Error(
        response.errors
          .map((error) => error.message || "GitHub GraphQL request failed.")
          .join("; "),
      );
    }

    if (!response.data) {
      throw new Error("GitHub GraphQL response did not include data.");
    }

    return response.data;
  }

  async #requestJson<T>(url: URL, init: RequestInit = {}): Promise<T> {
    const response = await this.#fetch(url, {
      ...init,
      headers: buildHeaders(this.#token, init.headers),
    });

    if (!response.ok) {
      throw new GitHubApiError(
        `GitHub API request failed with status ${response.status} ${response.statusText}.`,
        response.status,
      );
    }

    return (await response.json()) as T;
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

function buildHeaders(
  token: string,
  initHeaders?: RequestInit["headers"],
): Headers {
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  headers.set("User-Agent", "vercel-deploy-comment");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  return headers;
}

function deriveGraphqlUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (!pathname) {
    url.pathname = "/graphql";
  } else if (pathname.endsWith("/api/v3")) {
    url.pathname = `${pathname.slice(0, -"/v3".length)}/graphql`;
  } else {
    url.pathname = `${pathname}/graphql`;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}
