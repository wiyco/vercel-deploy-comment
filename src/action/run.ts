import * as core from "@actions/core";
import { exec } from "@actions/exec";
import {
  buildCommentMarker,
  parseDeploymentCommentRows,
  renderDeploymentComment,
  upsertDeploymentCommentRows,
} from "../comment/markdown";
import {
  getCancelledDisplayStatus,
  getInProgressDisplayStatus,
  resolveDisplayStatus,
} from "../comment/status";
import { ManagedCommentWriter } from "../comment/writer";
import type {
  GitHubClient,
  IssueComment,
  UpsertCommentResult,
} from "../github/client";
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
import {
  initializeActionRuntime,
  sanitizeErrorMessage,
  toError,
} from "./runtime";
import {
  readCancelHandlingState,
  saveCancelHandlingTarget,
  saveInitialRowsPublished,
  saveMainCompleted,
} from "./state";

export async function runActionMain(): Promise<void> {
  const runtime = initializeActionRuntime();
  const { client, inputs, runUrl } = runtime;

  saveCancelHandlingTarget(inputs.mode === "deploy-and-comment");

  try {
    const { buildRowsResult, comment } =
      inputs.mode === "deploy-and-comment"
        ? await runDeployAndComment(client, inputs, runUrl)
        : await runCommentOnly(client, inputs, runUrl);

    if (
      inputs.mode === "deploy-and-comment" &&
      !buildRowsResult.deployFailure
    ) {
      saveMainCompleted();
    }

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

export async function runActionPost(): Promise<void> {
  const runtime = initializeActionRuntime();
  const { client, inputs, runUrl } = runtime;
  const cancelHandlingState = readCancelHandlingState();

  try {
    if (
      inputs.mode !== "deploy-and-comment" ||
      !cancelHandlingState.cancelHandlingTarget ||
      !cancelHandlingState.initialRowsPublished ||
      cancelHandlingState.mainCompleted
    ) {
      return;
    }

    await publishCancelledRowsForCurrentInvocation(client, inputs, runUrl);
  } catch (error) {
    throw new Error(sanitizeErrorMessage(error, inputs), {
      cause: toError(error),
    });
  }
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

function getProjectName(
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

function getPreviewUrl(
  deploymentUrl: string | undefined,
  deploymentDetails: VercelDeploymentDetails | undefined,
): string | undefined {
  const rawUrl = deploymentDetails?.url ?? deploymentUrl;
  return rawUrl ? toHttpUrl(rawUrl) : undefined;
}

function getDeploymentUrlFromError(error: unknown): string | undefined {
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
  client: GitHubClient,
  inputs: DeployAndCommentActionInputs,
  runUrl: string,
): Promise<{
  buildRowsResult: BuildRowsResult;
  comment: UpsertCommentResult;
}> {
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
    inputOrder: inputs.deployments.map((deployment) => buildRowKey(deployment)),
    marker: inputs.commentMarker,
  });

  await writer.publishInitialRows(
    buildInProgressRows(inputs.deployments, runUrl, new Date().toISOString()),
  );
  saveInitialRowsPublished();

  let buildRowsResult: BuildRowsResult | undefined;
  let buildFailure: unknown;

  try {
    buildRowsResult = await buildDeployAndCommentRows(inputs, runUrl, writer);
  } catch (error) {
    buildFailure = error;
  }

  let comment: UpsertCommentResult;

  try {
    comment = await writer.flush();
  } catch (error) {
    if (buildFailure) {
      throw combineErrors(
        buildFailure,
        error,
        "failed to flush managed pull request comment updates",
      );
    }

    throw error;
  }

  if (buildFailure) {
    throw buildFailure;
  }

  if (!buildRowsResult) {
    throw new Error("Managed deploy run did not produce comment rows.");
  }

  return {
    buildRowsResult,
    comment,
  };
}

async function runCommentOnly(
  client: GitHubClient,
  inputs: CommentOnlyActionInputs,
  runUrl: string,
): Promise<{
  buildRowsResult: BuildRowsResult;
  comment: UpsertCommentResult;
}> {
  const buildRowsResult = await buildCommentOnlyRows(inputs, runUrl);
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
  runUrl: string,
  writer: ManagedCommentWriter,
): Promise<BuildRowsResult> {
  const deploymentResults = await mapWithConcurrencyLimit<
    DeployAndCommentActionInputs["deployments"][number],
    ResolvedDeploymentRowResult
  >(
    inputs.deployments,
    inputs.deploymentConcurrency,
    async (deployment, index) => {
      if (deployment === undefined) {
        throw new Error(`deployments[${index}] is missing.`);
      }

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
    },
  );

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
  runUrl: string,
): Promise<BuildRowsResult> {
  const updatedAtUtc = new Date().toISOString();
  const nextRows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];

  for (const deployment of inputs.deployments) {
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
  client: GitHubClient,
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
  client: GitHubClient,
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

  return renderManagedCommentWithRows(inputs, rows);
}

function renderManagedCommentWithRows(
  inputs: Pick<ActionInputs, "commentMarker" | "footer" | "header">,
  rows: DeploymentCommentRow[],
): string {
  return renderDeploymentComment({
    footer: inputs.footer,
    header: inputs.header,
    marker: inputs.commentMarker,
    rows,
  });
}

async function publishCancelledRowsForCurrentInvocation(
  client: GitHubClient,
  inputs: DeployAndCommentActionInputs,
  runUrl: string,
): Promise<void> {
  const snapshot = await readManagedCommentSnapshot(
    client,
    inputs.commentMarker,
  );

  if (!snapshot.comment) {
    return;
  }

  const targetRowKeys = new Set(
    inputs.deployments.map((deployment) => buildRowKey(deployment)),
  );
  const cancelledStatus = getCancelledDisplayStatus();
  const updatedAtUtc = new Date().toISOString();
  let changed = false;
  const rows = snapshot.rows.map((row) => {
    if (
      !targetRowKeys.has(
        buildDeploymentRowKey(row.projectId, row.environment),
      ) ||
      row.status.key !== "in_progress"
    ) {
      return row;
    }

    changed = true;

    return {
      ...row,
      runUrl,
      status: cancelledStatus,
      updatedAtUtc,
    };
  });

  if (!changed) {
    return;
  }

  await client.updatePullRequestComment(
    snapshot.comment.id,
    renderManagedCommentWithRows(inputs, rows),
  );
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
