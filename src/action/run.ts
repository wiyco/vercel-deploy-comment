import * as core from "@actions/core";
import { exec } from "@actions/exec";
import {
  buildCommentMarker,
  parseDeploymentCommentRows,
  renderDeploymentComment,
  upsertDeploymentCommentRows,
} from "../comment/markdown";
import {
  getInProgressDisplayStatus,
  resolveDisplayStatus,
} from "../comment/status";
import { ManagedCommentWriter } from "../comment/writer";
import type { IssueComment, UpsertCommentResult } from "../github/client";
import { mapWithConcurrencyLimit } from "../shared/concurrency";
import { buildDeploymentRowKey } from "../shared/deployment-key";
import type {
  ActionInputs,
  ActionStatus,
  BaseDeploymentInput,
  CommentOnlyActionInputs,
  DeployAndCommentActionInputs,
  DeploymentCommentRow,
  VercelDeploymentDetails,
  VercelProjectDetails,
} from "../shared/types";
import {
  getVercelDeploymentDetails,
  getVercelProjectDetails,
  runVercelDeploy,
  toHttpUrl,
} from "../vercel/deployment";
import { readActionInputs } from "./input";
import {
  type ActionRuntime,
  initializeActionRuntime,
  sanitizeErrorMessage,
  toError,
} from "./runtime";

type PostCleanupStatus = Extract<ActionStatus, "failure" | "cancelled">;

export interface PostCleanupOptions {
  jobStatus?: string;
  mainOutcome?: string;
}

export async function runActionMain(): Promise<void> {
  const inputs = readActionInputs();

  try {
    const { client, runUrl } = initializeActionRuntime(inputs);
    const { buildRowsResult, comment } =
      inputs.mode === "deploy-and-comment"
        ? await runDeployAndComment(client, inputs, runUrl)
        : await runCommentOnly(client, inputs, runUrl);

    core.setOutput("comment-id", String(comment.id));
    core.setOutput("comment-url", comment.htmlUrl);
    core.setOutput(
      "deployment-urls",
      JSON.stringify(buildRowsResult.deploymentUrls),
    );
    core.setOutput("statuses", JSON.stringify(buildRowsResult.statusKeys));
    core.info(`Pull request comment ${comment.action}: ${comment.htmlUrl}`);

    if (buildRowsResult.deployFailure) {
      throw buildRowsResult.deployFailure;
    }
  } catch (error) {
    throw new Error(sanitizeErrorMessage(error, inputs), {
      cause: toError(error),
    });
  }
}

export async function runActionPost(
  options: PostCleanupOptions = {},
): Promise<void> {
  let inputs: ActionInputs | undefined;

  try {
    inputs = readActionInputs();
    const cleanupStatus = resolvePostCleanupStatus(options);

    if (!cleanupStatus) {
      core.info("Post cleanup skipped because no terminal job status was set.");
      return;
    }

    const { client, runUrl } = initializeActionRuntime(inputs);
    const comment = await finalizeInProgressRows(
      client,
      inputs,
      runUrl,
      cleanupStatus,
    );

    if (!comment) {
      core.info("Post cleanup found no in-progress rows to finalize.");
      return;
    }

    core.info(`Post cleanup updated pull request comment: ${comment.htmlUrl}`);
  } catch (error) {
    core.warning(
      inputs ? sanitizeErrorMessage(error, inputs) : toError(error).message,
    );
  }
}

export function getProjectName(
  deployment: BaseDeploymentInput,
  projectDetails: VercelProjectDetails | undefined,
  deploymentDetails: VercelDeploymentDetails | undefined,
): string {
  if (deployment.displayName) {
    return deployment.displayName;
  }

  if (projectDetails?.name) {
    return projectDetails.name;
  }

  if (deploymentDetails?.project?.name) {
    return deploymentDetails.project.name;
  }

  if (deploymentDetails?.name) {
    return deploymentDetails.name;
  }

  return deployment.projectId;
}

export function getDeploymentUrlFromError(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "deploymentUrl" in error) {
    const deploymentUrl = (
      error as {
        deploymentUrl?: unknown;
      }
    ).deploymentUrl;
    return typeof deploymentUrl === "string" ? deploymentUrl : undefined;
  }

  return undefined;
}

async function resolveOptionalMetadata<T>(
  resolveValue: () => Promise<T>,
  inputs: {
    githubToken: string;
    vercelToken?: string;
  },
): Promise<T | undefined> {
  try {
    return await resolveValue();
  } catch (error) {
    core.warning(sanitizeErrorMessage(error, inputs));
    return undefined;
  }
}

function buildRowKey(deployment: BaseDeploymentInput): string {
  return buildDeploymentRowKey(deployment.projectId, deployment.environment);
}

function requireDefinedItems<T>(
  items: readonly (T | undefined)[],
  label: string,
): T[] {
  return items.map((item, index) => {
    if (item === undefined) {
      throw new Error(`${label} at index ${index} is undefined.`);
    }

    return item;
  });
}

function getPreviewUrl(
  deploymentUrl: string | undefined,
  deploymentDetails: VercelDeploymentDetails | undefined,
): string | undefined {
  const rawUrl = deploymentDetails?.url ?? deploymentUrl;
  return rawUrl ? toHttpUrl(rawUrl) : undefined;
}

interface BuildRowsResult {
  nextRows: DeploymentCommentRow[];
  deploymentUrls: string[];
  statusKeys: string[];
  deployFailure?: Error;
}

interface ManagedCommentSnapshot {
  comment?: IssueComment;
  rows: DeploymentCommentRow[];
}

interface BuiltDeploymentRowResult {
  row: DeploymentCommentRow;
  previewUrl?: string;
  statusKey: string;
}

interface ResolvedDeploymentRowResult {
  builtRowResult: BuiltDeploymentRowResult;
  deployFailure?: Error;
}

async function runDeployAndComment(
  client: ActionRuntime["client"],
  inputs: DeployAndCommentActionInputs,
  runUrl: string,
): Promise<{
  buildRowsResult: BuildRowsResult;
  comment: UpsertCommentResult;
}> {
  const deployments = requireDefinedItems(inputs.deployments, "Deployment");
  const snapshot = await readManagedCommentSnapshot(
    client,
    inputs.commentMarker,
  );
  const writer = new ManagedCommentWriter({
    client,
    comment: snapshot.comment,
    existingRows: snapshot.rows,
    footer: inputs.footer,
    header: inputs.header,
    inputOrder: deployments.map((deployment) => buildRowKey(deployment)),
    marker: inputs.commentMarker,
  });

  await writer.publishInitialRows(
    buildInProgressRows(deployments, runUrl, new Date().toISOString()),
  );

  const buildRowsOutcome:
    | {
        ok: true;
        value: BuildRowsResult;
      }
    | {
        ok: false;
        error: unknown;
      } = await buildDeployAndCommentRows(inputs, deployments, runUrl, writer)
    .then((value) => ({
      ok: true as const,
      value,
    }))
    .catch((error: unknown) => ({
      ok: false as const,
      error,
    }));

  let comment: UpsertCommentResult;

  try {
    comment = await writer.flush();
  } catch (error) {
    if (!buildRowsOutcome.ok) {
      throw combineErrors(
        buildRowsOutcome.error,
        error,
        "failed to flush managed pull request comment updates",
      );
    }

    throw error;
  }

  if (!buildRowsOutcome.ok) {
    throw buildRowsOutcome.error;
  }

  return {
    buildRowsResult: buildRowsOutcome.value,
    comment,
  };
}

async function runCommentOnly(
  client: ActionRuntime["client"],
  inputs: CommentOnlyActionInputs,
  runUrl: string,
): Promise<{
  buildRowsResult: BuildRowsResult;
  comment: UpsertCommentResult;
}> {
  const deployments = requireDefinedItems(inputs.deployments, "Deployment");
  const buildRowsResult = await buildCommentOnlyRows(
    inputs,
    deployments,
    runUrl,
  );
  const comment = await writeManagedCommentRows(
    client,
    inputs,
    buildRowsResult.nextRows,
  );

  return {
    buildRowsResult,
    comment,
  };
}

async function buildDeployAndCommentRows(
  inputs: DeployAndCommentActionInputs,
  deployments: readonly DeployAndCommentActionInputs["deployments"][number][],
  runUrl: string,
  writer: ManagedCommentWriter,
): Promise<BuildRowsResult> {
  const deploymentResults = await mapWithConcurrencyLimit<
    DeployAndCommentActionInputs["deployments"][number],
    ResolvedDeploymentRowResult
  >(deployments, inputs.deploymentConcurrency, async (deployment) => {
    let deploymentUrl = deployment.deploymentUrl;
    let deploymentFailed = false;
    let deployFailure: Error | undefined;

    try {
      deploymentUrl = await runVercelDeploy({
        deployment,
        token: inputs.vercelToken,
        exec,
      });
    } catch (error) {
      deploymentFailed = true;
      deployFailure = toError(error);
      deploymentUrl = getDeploymentUrlFromError(error) ?? deploymentUrl;
      core.warning(sanitizeErrorMessage(error, inputs));

      if (!inputs.commentOnFailure) {
        writer.restoreRow(deployment.projectId, deployment.environment);
        throw error;
      }
    }

    const { projectDetails, deploymentDetails } =
      await resolveDeploymentMetadata(inputs, deployment, deploymentUrl);

    const builtRowResult = buildDeploymentRowResult({
      deployment,
      deploymentDetails,
      deploymentFailed,
      deploymentUrl,
      actionStatus: inputs.status,
      projectDetails,
      runUrl,
      updatedAtUtc: new Date().toISOString(),
    });

    writer.updateRow(builtRowResult.row);

    return {
      builtRowResult,
      deployFailure,
    };
  });

  const nextRows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];
  let deployFailure: Error | undefined;

  for (const result of deploymentResults) {
    appendBuiltDeploymentRowResult(
      {
        nextRows,
        deploymentUrls,
        statusKeys,
      },
      result.builtRowResult,
    );
    deployFailure ??= result.deployFailure;
  }

  return {
    nextRows,
    deploymentUrls,
    statusKeys,
    deployFailure,
  };
}

async function buildCommentOnlyRows(
  inputs: CommentOnlyActionInputs,
  deployments: readonly CommentOnlyActionInputs["deployments"][number][],
  runUrl: string,
): Promise<BuildRowsResult> {
  const updatedAtUtc = new Date().toISOString();
  const nextRows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];

  for (const deployment of deployments) {
    const deploymentUrl = deployment.deploymentUrl;
    const { projectDetails, deploymentDetails } =
      await resolveDeploymentMetadata(inputs, deployment, deploymentUrl);
    appendBuiltDeploymentRowResult(
      {
        nextRows,
        deploymentUrls,
        statusKeys,
      },
      buildDeploymentRowResult({
        deployment,
        deploymentUrl,
        deploymentStatus: deployment.status,
        deploymentDetails,
        projectDetails,
        deploymentFailed: false,
        actionStatus: inputs.status,
        runUrl,
        updatedAtUtc,
      }),
    );
  }

  return {
    nextRows,
    deploymentUrls,
    statusKeys,
  };
}

async function resolveDeploymentMetadata(
  inputs: {
    githubToken: string;
    vercelToken?: string;
  },
  deployment: BaseDeploymentInput,
  deploymentUrl: string | undefined,
): Promise<{
  projectDetails?: VercelProjectDetails;
  deploymentDetails?: VercelDeploymentDetails;
}> {
  if (!inputs.vercelToken) {
    return {};
  }

  const metadataToken = inputs.vercelToken;
  const projectDetails = await resolveOptionalMetadata(
    () =>
      getVercelProjectDetails({
        projectId: deployment.projectId,
        token: metadataToken,
        teamId: deployment.teamId,
        slug: deployment.slug,
        fetch,
      }),
    inputs,
  );
  const deploymentDetails = deploymentUrl
    ? await resolveOptionalMetadata(
        () =>
          getVercelDeploymentDetails({
            deploymentUrl,
            token: metadataToken,
            teamId: deployment.teamId,
            slug: deployment.slug,
            fetch,
          }),
        inputs,
      )
    : undefined;

  return {
    projectDetails,
    deploymentDetails,
  };
}

function buildDeploymentRowResult(options: {
  deployment: BaseDeploymentInput;
  deploymentUrl: string | undefined;
  deploymentStatus?: CommentOnlyActionInputs["deployments"][number]["status"];
  deploymentDetails?: VercelDeploymentDetails;
  projectDetails?: VercelProjectDetails;
  deploymentFailed: boolean;
  actionStatus: ActionStatus;
  runUrl: string;
  updatedAtUtc: string;
}): BuiltDeploymentRowResult {
  const previewUrl = getPreviewUrl(
    options.deploymentUrl,
    options.deploymentDetails,
  );
  const status = resolveDisplayStatus({
    deploymentStatus: options.deploymentStatus,
    vercelReadyState: options.deploymentDetails?.readyState,
    actionStatus: options.deploymentFailed ? "failure" : options.actionStatus,
  });

  return {
    row: {
      environment: options.deployment.environment,
      projectId: options.deployment.projectId,
      projectName: getProjectName(
        options.deployment,
        options.projectDetails,
        options.deploymentDetails,
      ),
      projectUrl: options.deployment.projectUrl,
      previewUrl,
      runUrl: options.runUrl,
      status,
      updatedAtUtc: options.updatedAtUtc,
    },
    previewUrl,
    statusKey: status.key,
  };
}

function buildInProgressRows(
  deployments: DeployAndCommentActionInputs["deployments"],
  runUrl: string,
  updatedAtUtc: string,
): DeploymentCommentRow[] {
  const status = getInProgressDisplayStatus();

  return deployments.map((deployment) => ({
    environment: deployment.environment,
    projectId: deployment.projectId,
    projectName: getProjectName(deployment, undefined, undefined),
    projectUrl: deployment.projectUrl,
    previewUrl: deployment.deploymentUrl,
    runUrl,
    status,
    updatedAtUtc,
  }));
}

function appendBuiltDeploymentRowResult(
  target: Pick<BuildRowsResult, "nextRows" | "deploymentUrls" | "statusKeys">,
  result: BuiltDeploymentRowResult,
): void {
  target.nextRows.push(result.row);

  if (result.previewUrl) {
    target.deploymentUrls.push(result.previewUrl);
  }

  target.statusKeys.push(result.statusKey);
}

async function readManagedCommentSnapshot(
  client: ActionRuntime["client"],
  commentMarker: string,
): Promise<ManagedCommentSnapshot> {
  const comment = await client.findExistingActionComment(
    buildCommentMarker(commentMarker),
  );

  return {
    comment,
    rows: parseDeploymentCommentRows(comment?.body ?? ""),
  };
}

async function writeManagedCommentRows(
  client: ActionRuntime["client"],
  inputs: ActionInputs,
  nextRows: DeploymentCommentRow[],
  snapshot?: ManagedCommentSnapshot,
): Promise<UpsertCommentResult> {
  const existingCommentSnapshot =
    snapshot ??
    (await readManagedCommentSnapshot(client, inputs.commentMarker));
  const body = renderManagedCommentBody(
    inputs,
    existingCommentSnapshot.rows,
    nextRows,
  );

  if (existingCommentSnapshot.comment) {
    return client.updatePullRequestComment(
      existingCommentSnapshot.comment.id,
      body,
    );
  }

  return client.createPullRequestComment(body);
}

async function finalizeInProgressRows(
  client: ActionRuntime["client"],
  inputs: ActionInputs,
  runUrl: string,
  actionStatus: PostCleanupStatus,
): Promise<UpsertCommentResult | undefined> {
  const snapshot = await readManagedCommentSnapshot(
    client,
    inputs.commentMarker,
  );

  if (!snapshot.comment) {
    return undefined;
  }

  const updatedRows = replaceInProgressRows(snapshot.rows, {
    actionStatus,
    runUrl,
    targetRowKeys: new Set(
      inputs.deployments.map((deployment) => buildRowKey(deployment)),
    ),
    updatedAtUtc: new Date().toISOString(),
  });

  if (updatedRows === snapshot.rows) {
    return undefined;
  }

  const body = renderDeploymentComment({
    header: inputs.header,
    footer: inputs.footer,
    marker: inputs.commentMarker,
    rows: updatedRows,
  });

  return client.updatePullRequestComment(snapshot.comment.id, body);
}

function replaceInProgressRows(
  rows: DeploymentCommentRow[],
  options: {
    actionStatus: PostCleanupStatus;
    runUrl: string;
    targetRowKeys: ReadonlySet<string>;
    updatedAtUtc: string;
  },
): DeploymentCommentRow[] {
  let changed = false;
  const status = resolveDisplayStatus({
    actionStatus: options.actionStatus,
  });
  const updatedRows = rows.map((row) => {
    const rowKey = buildDeploymentRowKey(row.projectId, row.environment);

    if (
      row.status.key !== "in_progress" ||
      !options.targetRowKeys.has(rowKey) ||
      row.runUrl !== options.runUrl
    ) {
      return row;
    }

    changed = true;
    return {
      ...row,
      runUrl: options.runUrl,
      status,
      updatedAtUtc: options.updatedAtUtc,
    };
  });

  return changed ? updatedRows : rows;
}

function renderManagedCommentBody(
  inputs: ActionInputs,
  existingRows: DeploymentCommentRow[],
  nextRows: DeploymentCommentRow[],
): string {
  const rows = upsertDeploymentCommentRows(
    existingRows,
    nextRows,
    inputs.deployments.map((deployment) => buildRowKey(deployment)),
  );

  return renderDeploymentComment({
    header: inputs.header,
    footer: inputs.footer,
    marker: inputs.commentMarker,
    rows,
  });
}

function resolvePostCleanupStatus(
  options: PostCleanupOptions,
): PostCleanupStatus | undefined {
  if (options.jobStatus === "failure" || options.jobStatus === "cancelled") {
    return options.jobStatus;
  }

  if (options.mainOutcome === "failure") {
    return "failure";
  }

  if (options.mainOutcome === "started") {
    return "cancelled";
  }

  return undefined;
}

function combineErrors(
  primaryError: unknown,
  secondaryError: unknown,
  secondaryContext: string,
): Error {
  const normalizedPrimaryError = toError(primaryError);
  const normalizedSecondaryError = toError(secondaryError);
  const contextualizedSecondaryError = new Error(
    `${secondaryContext}: ${normalizedSecondaryError.message}`,
    {
      cause: normalizedSecondaryError,
    },
  );

  return new AggregateError(
    [
      normalizedPrimaryError,
      contextualizedSecondaryError,
    ],
    `${normalizedPrimaryError.message}; ${secondaryContext}: ${normalizedSecondaryError.message}`,
    {
      cause: normalizedPrimaryError,
    },
  );
}
