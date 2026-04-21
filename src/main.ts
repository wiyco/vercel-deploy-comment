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
import { resolveDisplayStatus } from "./comment/status";
import {
  buildRunUrl,
  GitHubClient,
  readGitHubRuntimeContext,
} from "./github/client";
import { buildDeploymentRowKey } from "./shared/deployment-key";
import type {
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
    const updatedAtUtc = new Date().toISOString();
    const { nextRows, deploymentUrls, statusKeys, deployFailure } =
      inputs.mode === "deploy-and-comment"
        ? await buildDeployAndCommentRows(inputs, runUrl, updatedAtUtc)
        : await buildCommentOnlyRows(inputs, runUrl, updatedAtUtc);

    const client = new GitHubClient(inputs.githubToken, context);
    const commentMarker = buildCommentMarker(inputs.commentMarker);
    const existingComment =
      await client.findExistingActionComment(commentMarker);
    const existingRows = parseDeploymentCommentRows(
      existingComment?.body ?? "",
    );
    const rows = upsertDeploymentCommentRows(
      existingRows,
      nextRows,
      inputs.deployments.map((deployment) => buildRowKey(deployment)),
    );
    const body = renderDeploymentComment({
      header: inputs.header,
      footer: inputs.footer,
      marker: inputs.commentMarker,
      rows,
    });
    const comment = existingComment
      ? await client.updatePullRequestComment(existingComment.id, body)
      : await client.createPullRequestComment(body);

    core.setOutput("comment-id", String(comment.id));
    core.setOutput("comment-url", comment.htmlUrl);
    core.setOutput("deployment-urls", JSON.stringify(deploymentUrls));
    core.setOutput("statuses", JSON.stringify(statusKeys));
    core.info(`Pull request comment ${comment.action}: ${comment.htmlUrl}`);

    if (deployFailure) {
      throw deployFailure;
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

async function buildDeployAndCommentRows(
  inputs: DeployAndCommentActionInputs,
  runUrl: string,
  updatedAtUtc: string,
): Promise<BuildRowsResult> {
  const nextRows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];
  let deployFailure: Error | undefined;

  for (const deployment of inputs.deployments) {
    let deploymentUrl = deployment.deploymentUrl;
    let deploymentFailed = false;

    try {
      deploymentUrl = await runVercelDeploy({
        deployment,
        token: inputs.vercelToken,
        exec,
      });
    } catch (error) {
      deploymentFailed = true;
      deployFailure ??= toError(error);
      deploymentUrl = getDeploymentUrlFromError(error) ?? deploymentUrl;
      core.warning(sanitizeErrorMessage(error, inputs));

      if (!inputs.commentOnFailure) {
        throw error;
      }
    }

    const { projectDetails, deploymentDetails } =
      await resolveDeploymentMetadata(inputs, deployment, deploymentUrl);
    appendDeploymentRow({
      nextRows,
      deploymentUrls,
      statusKeys,
      deployment,
      deploymentUrl,
      deploymentDetails,
      projectDetails,
      deploymentFailed,
      actionStatus: inputs.status,
      runUrl,
      updatedAtUtc,
    });
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
  updatedAtUtc: string,
): Promise<BuildRowsResult> {
  const nextRows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];

  for (const deployment of inputs.deployments) {
    const deploymentUrl = deployment.deploymentUrl;
    const { projectDetails, deploymentDetails } =
      await resolveDeploymentMetadata(inputs, deployment, deploymentUrl);
    appendDeploymentRow({
      nextRows,
      deploymentUrls,
      statusKeys,
      deployment,
      deploymentUrl,
      deploymentDetails,
      projectDetails,
      deploymentFailed: false,
      actionStatus: inputs.status,
      runUrl,
      updatedAtUtc,
    });
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

function appendDeploymentRow(options: {
  nextRows: DeploymentCommentRow[];
  deploymentUrls: string[];
  statusKeys: string[];
  deployment: BaseDeploymentInput;
  deploymentUrl: string | undefined;
  deploymentDetails?: VercelDeploymentDetails;
  projectDetails?: VercelProjectDetails;
  deploymentFailed: boolean;
  actionStatus: ActionStatus;
  runUrl: string;
  updatedAtUtc: string;
}): void {
  const previewUrl = getPreviewUrl(
    options.deploymentUrl,
    options.deploymentDetails,
  );
  const status = resolveDisplayStatus({
    vercelReadyState: options.deploymentDetails?.readyState,
    actionStatus: options.deploymentFailed ? "failure" : options.actionStatus,
  });

  options.nextRows.push({
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
  });

  if (previewUrl) {
    options.deploymentUrls.push(previewUrl);
  }

  options.statusKeys.push(status.key);
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
