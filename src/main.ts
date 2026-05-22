import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { readActionInputs } from "./action/input";
import {
  buildCommentMarker,
  parseDeploymentCommentRows,
  renderDeploymentComment,
  upsertDeploymentCommentRows,
} from "./comment/markdown";
import {
  getInProgressDisplayStatus,
  resolveDisplayStatus,
} from "./comment/status";
import {
  buildRunUrl,
  GitHubClient,
  type IssueComment,
  readGitHubRuntimeContext,
  type UpsertCommentResult,
} from "./github/client";
import { mapWithConcurrencyLimit } from "./shared/concurrency";
import { buildDeploymentRowKey } from "./shared/deployment-key";
import type {
  ActionInputs,
  ActionStatus,
  BaseDeploymentInput,
  CommentOnlyActionInputs,
  DeployAndCommentActionInputs,
  DeploymentCommentRow,
  VercelDeploymentDetails,
  VercelProjectDetails,
} from "./shared/types";
import {
  getVercelDeploymentDetails,
  getVercelProjectDetails,
  runVercelDeploy,
  toHttpUrl,
} from "./vercel/deployment";

export async function run(): Promise<void> {
  const inputs = readActionInputs();
  try {
    core.setSecret(inputs.githubToken);

    if (inputs.vercelToken) {
      core.setSecret(inputs.vercelToken);
    }

    const context = readGitHubRuntimeContext();
    const runUrl = buildRunUrl(context);
    const client = new GitHubClient(inputs.githubToken, context);
    let pendingCommentRollbackState: PendingCommentRollbackState | undefined;

    if (inputs.mode === "deploy-and-comment") {
      const existingCommentSnapshot = await readManagedCommentSnapshot(
        client,
        inputs.commentMarker,
      );
      const pendingComment = await writeManagedCommentRows(
        client,
        inputs,
        buildInProgressRows(
          inputs.deployments,
          runUrl,
          new Date().toISOString(),
        ),
        existingCommentSnapshot,
      );

      pendingCommentRollbackState = {
        pendingCommentId: pendingComment.id,
        previousComment: existingCommentSnapshot.comment,
      };
    }

    let buildRowsResult: BuildRowsResult;

    try {
      buildRowsResult =
        inputs.mode === "deploy-and-comment"
          ? await buildDeployAndCommentRows(inputs, runUrl)
          : await buildCommentOnlyRows(inputs, runUrl);
    } catch (error) {
      await rollbackPendingCommentUpdate(
        client,
        pendingCommentRollbackState,
        inputs,
      );
      throw error;
    }

    let comment: UpsertCommentResult;

    try {
      comment = await writeManagedCommentRows(
        client,
        inputs,
        buildRowsResult.nextRows,
      );
    } catch (error) {
      await rollbackPendingCommentUpdate(
        client,
        pendingCommentRollbackState,
        inputs,
      );
      throw error;
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

function sanitizeErrorMessage(
  error: unknown,
  inputs: {
    githubToken: string;
    vercelToken?: string;
  },
): string {
  let message = toError(error).message;

  for (const secret of [
    inputs.githubToken,
    inputs.vercelToken,
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "***");
    }
  }

  return message;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

interface PendingCommentRollbackState {
  pendingCommentId: number;
  previousComment?: IssueComment;
}

interface BuiltDeploymentRowResult {
  row: DeploymentCommentRow;
  previewUrl?: string;
  statusKey: string;
}

interface ResolvedDeploymentResult {
  deployment: BaseDeploymentInput;
  deploymentUrl: string | undefined;
  deploymentDetails?: VercelDeploymentDetails;
  projectDetails?: VercelProjectDetails;
  deploymentFailed: boolean;
  deployFailure?: Error;
}

async function buildDeployAndCommentRows(
  inputs: DeployAndCommentActionInputs,
  runUrl: string,
): Promise<BuildRowsResult> {
  const deploymentResults = await mapWithConcurrencyLimit<
    DeployAndCommentActionInputs["deployments"][number],
    ResolvedDeploymentResult
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
          throw error;
        }
      }

      const { projectDetails, deploymentDetails } =
        await resolveDeploymentMetadata(inputs, deployment, deploymentUrl);

      return {
        deployment,
        deploymentUrl,
        deploymentDetails,
        projectDetails,
        deploymentFailed,
        deployFailure,
      };
    },
  );

  const updatedAtUtc = new Date().toISOString();
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
      buildDeploymentRowResult({
        deployment: result.deployment,
        deploymentUrl: result.deploymentUrl,
        deploymentDetails: result.deploymentDetails,
        projectDetails: result.projectDetails,
        deploymentFailed: result.deploymentFailed,
        actionStatus: inputs.status,
        runUrl,
        updatedAtUtc,
      }),
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

  return renderDeploymentComment({
    header: inputs.header,
    footer: inputs.footer,
    marker: inputs.commentMarker,
    rows,
  });
}

async function rollbackPendingCommentUpdate(
  client: GitHubClient,
  rollbackState: PendingCommentRollbackState | undefined,
  inputs: {
    githubToken: string;
    vercelToken?: string;
  },
): Promise<void> {
  if (!rollbackState) {
    return;
  }

  try {
    if (rollbackState.previousComment) {
      await client.updatePullRequestComment(
        rollbackState.previousComment.id,
        rollbackState.previousComment.body ?? "",
      );
      return;
    }

    await client.deletePullRequestComment(rollbackState.pendingCommentId);
  } catch (error) {
    core.warning(
      `Failed to rollback pending pull request comment update: ${sanitizeErrorMessage(error, inputs)}`,
    );
  }
}

function isDirectRun(): boolean {
  return Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
  );
}

if (isDirectRun()) {
  run().catch((error: unknown) => {
    core.setFailed(toError(error).message);
  });
}
