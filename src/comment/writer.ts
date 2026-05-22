import {
  GitHubApiError,
  type GitHubClient,
  type IssueComment,
  type UpsertCommentResult,
} from "../github/client";
import { buildDeploymentRowKey } from "../shared/deployment-key";
import type { DeploymentCommentRow } from "../shared/types";
import {
  buildCommentMarker,
  renderDeploymentComment,
  upsertDeploymentCommentRows,
} from "./markdown";

const DEFAULT_MIN_WRITE_INTERVAL_MS = 1_000;
const DEFAULT_MAX_WRITE_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_GITHUB_STATUS_CODES = new Set([
  408,
  409,
  429,
  500,
  502,
  503,
  504,
]);

export interface ManagedCommentWriterOptions {
  client: GitHubClient;
  comment?: IssueComment;
  existingRows: DeploymentCommentRow[];
  footer?: string;
  header: string;
  inputOrder: string[];
  marker: string;
  maxWriteAttempts?: number;
  minWriteIntervalMs?: number;
  now?: () => number;
  retryBaseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class ManagedCommentWriter {
  readonly #client: GitHubClient;
  readonly #existingRows: DeploymentCommentRow[];
  readonly #footer?: string;
  readonly #header: string;
  readonly #inputOrder: string[];
  readonly #marker: string;
  readonly #maxWriteAttempts: number;
  readonly #minWriteIntervalMs: number;
  readonly #now: () => number;
  readonly #retryBaseDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #initialRowsByKey = new Map<string, DeploymentCommentRow>();
  readonly #currentInputRowsByKey = new Map<string, DeploymentCommentRow>();
  #comment?: IssueComment;
  #currentRows: DeploymentCommentRow[];
  #lastMutativeWriteAt?: number;
  #lastUpsertResult?: UpsertCommentResult;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: ManagedCommentWriterOptions) {
    this.#client = options.client;
    this.#comment = options.comment;
    this.#existingRows = options.existingRows;
    this.#footer = options.footer;
    this.#header = options.header;
    this.#inputOrder = uniqueStrings(options.inputOrder);
    this.#marker = options.marker;
    this.#maxWriteAttempts =
      options.maxWriteAttempts ?? DEFAULT_MAX_WRITE_ATTEMPTS;
    this.#minWriteIntervalMs =
      options.minWriteIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
    this.#retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.#sleep = options.sleep ?? sleep;
    this.#currentRows = options.existingRows;

    for (const row of options.existingRows) {
      this.#initialRowsByKey.set(
        buildDeploymentRowKey(row.projectId, row.environment),
        row,
      );
    }
  }

  async publishInitialRows(
    rows: DeploymentCommentRow[],
  ): Promise<UpsertCommentResult> {
    this.#replaceCurrentInputRows(rows);
    this.#queueCurrentStateWrite();
    return this.flush();
  }

  updateRow(row: DeploymentCommentRow): void {
    this.#currentInputRowsByKey.set(
      buildDeploymentRowKey(row.projectId, row.environment),
      row,
    );
    this.#queueCurrentStateWrite();
  }

  restoreRow(projectId: string, environment: string): void {
    const key = buildDeploymentRowKey(projectId, environment);
    const initialRow = this.#initialRowsByKey.get(key);

    if (initialRow) {
      this.#currentInputRowsByKey.set(key, initialRow);
    } else {
      this.#currentInputRowsByKey.delete(key);
    }

    this.#queueCurrentStateWrite();
  }

  async flush(): Promise<UpsertCommentResult> {
    await this.#writeQueue;

    if (!this.#lastUpsertResult) {
      throw new Error(
        "Managed comment writer has not published a comment yet.",
      );
    }

    return this.#lastUpsertResult;
  }

  #replaceCurrentInputRows(rows: DeploymentCommentRow[]): void {
    this.#currentInputRowsByKey.clear();

    for (const row of rows) {
      this.#currentInputRowsByKey.set(
        buildDeploymentRowKey(row.projectId, row.environment),
        row,
      );
    }
  }

  #queueCurrentStateWrite(): void {
    this.#currentRows = this.#renderCurrentRows();
    const body = renderDeploymentComment({
      footer: this.#footer,
      header: this.#header,
      marker: this.#marker,
      rows: this.#currentRows,
    });
    this.#writeQueue = this.#writeQueue.then(() => this.#writeBody(body));
    void this.#writeQueue.catch(() => {});
  }

  #renderCurrentRows(): DeploymentCommentRow[] {
    return upsertDeploymentCommentRows(
      this.#existingRows,
      this.#getCurrentInputRows(),
      this.#inputOrder,
    );
  }

  #getCurrentInputRows(): DeploymentCommentRow[] {
    const rows: DeploymentCommentRow[] = [];

    for (const key of this.#inputOrder) {
      const row = this.#currentInputRowsByKey.get(key);

      if (row) {
        rows.push(row);
      }
    }

    return rows;
  }

  async #writeBody(body: string): Promise<void> {
    const result = await this.#writeBodyWithRetry(body);

    this.#comment = {
      ...(this.#comment ?? {}),
      body,
      html_url: result.htmlUrl,
      id: result.id,
    };
    this.#lastUpsertResult = result;
  }

  async #writeBodyWithRetry(body: string): Promise<UpsertCommentResult> {
    for (let attempt = 1; attempt <= this.#maxWriteAttempts; attempt += 1) {
      await this.#waitForMutativeWriteSlot();

      try {
        return this.#comment
          ? await this.#client.updatePullRequestComment(this.#comment.id, body)
          : await this.#client.createPullRequestComment(body);
      } catch (error) {
        const recoveredResult = await this.#recoverWrite(body);

        if (recoveredResult) {
          return recoveredResult;
        }

        if (
          attempt >= this.#maxWriteAttempts ||
          !isRetryableGitHubWriteError(error)
        ) {
          throw error;
        }

        await this.#sleep(this.#retryDelayForAttempt(attempt));
      }
    }

    throw new Error("Managed comment writer exhausted all write attempts.");
  }

  async #recoverWrite(body: string): Promise<UpsertCommentResult | undefined> {
    if (this.#comment) {
      return this.#recoverUpdatedComment(body, this.#comment.id);
    }

    return this.#recoverCreatedComment(body);
  }

  async #recoverUpdatedComment(
    body: string,
    commentId: number,
  ): Promise<UpsertCommentResult | undefined> {
    try {
      const refreshedComment =
        await this.#client.getPullRequestComment(commentId);

      if ((refreshedComment.body ?? "") !== body) {
        return undefined;
      }

      this.#comment = {
        ...refreshedComment,
        body,
      };
      return {
        action: "updated",
        htmlUrl: refreshedComment.html_url,
        id: refreshedComment.id,
      };
    } catch {
      return undefined;
    }
  }

  async #recoverCreatedComment(
    body: string,
  ): Promise<UpsertCommentResult | undefined> {
    try {
      const existingComment = await this.#client.findExistingActionComment(
        buildCommentMarker(this.#marker),
      );

      if (!existingComment || (existingComment.body ?? "") !== body) {
        return undefined;
      }

      this.#comment = {
        ...existingComment,
        body,
      };
      return {
        action: "created",
        htmlUrl: existingComment.html_url,
        id: existingComment.id,
      };
    } catch {
      return undefined;
    }
  }

  async #waitForMutativeWriteSlot(): Promise<void> {
    if (this.#lastMutativeWriteAt === undefined) {
      this.#lastMutativeWriteAt = this.#now();
      return;
    }

    const elapsed = this.#now() - this.#lastMutativeWriteAt;

    if (elapsed < this.#minWriteIntervalMs) {
      await this.#sleep(this.#minWriteIntervalMs - elapsed);
    }

    this.#lastMutativeWriteAt = this.#now();
  }

  #retryDelayForAttempt(attempt: number): number {
    return this.#retryBaseDelayMs * 2 ** (attempt - 1);
  }
}

function isRetryableGitHubWriteError(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) {
    return true;
  }

  return Boolean(
    error.status && RETRYABLE_GITHUB_STATUS_CODES.has(error.status),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
