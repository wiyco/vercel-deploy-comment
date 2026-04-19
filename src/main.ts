import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import { readActionInputs } from "./action/input";
import {
  buildCommentMarker,
  renderDeploymentComment,
} from "./comment/markdown";
import { resolveDisplayStatus } from "./comment/status";
import {
  buildRunUrl,
  GitHubClient,
  readGitHubRuntimeContext,
} from "./github/client";
import type {
  DeploymentCommentRow,
  VercelDeploymentDetails,
} from "./shared/types";
import {
  getVercelDeploymentDetails,
  runVercelDeploy,
  toHttpUrl,
} from "./vercel/deployment";

export async function run(): Promise<void> {
  const inputs = readActionInputs();
  core.setSecret(inputs.githubToken);

  if (inputs.vercelToken) {
    core.setSecret(inputs.vercelToken);
  }

  const context = readGitHubRuntimeContext();
  const runUrl = buildRunUrl(context);
  const updatedAtUtc = new Date().toISOString();
  const rows: DeploymentCommentRow[] = [];
  const deploymentUrls: string[] = [];
  const statusKeys: string[] = [];
  let deployFailure: Error | undefined;

  for (const deployment of inputs.deployments) {
    let deploymentUrl = deployment.deploymentUrl;
    let details: VercelDeploymentDetails | undefined;
    let deploymentFailed = false;

    if (inputs.mode === "deploy-and-comment") {
      try {
        deploymentUrl = await runVercelDeploy({
          deployment,
          token: inputs.vercelToken ?? "",
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
    }

    if (deploymentUrl && inputs.vercelToken) {
      try {
        details = await getVercelDeploymentDetails({
          deploymentUrl,
          token: inputs.vercelToken,
          teamId: deployment.teamId,
          slug: deployment.slug,
          fetch,
        });
      } catch (error) {
        core.warning(sanitizeErrorMessage(error, inputs));
      }
    }

    const previewUrl = getPreviewUrl(deploymentUrl, details);
    const status = resolveDisplayStatus({
      vercelReadyState: details?.readyState,
      actionStatus: deploymentFailed ? "failure" : inputs.status,
    });

    rows.push({
      projectName: getProjectName(deployment, details, deploymentUrl),
      projectUrl: deployment.projectUrl,
      previewUrl,
      runUrl,
      status,
      updatedAtUtc,
    });

    if (previewUrl) {
      deploymentUrls.push(previewUrl);
    }

    statusKeys.push(status.key);
  }

  const body = renderDeploymentComment({
    header: inputs.header,
    footer: inputs.footer,
    marker: inputs.commentMarker,
    rows,
  });
  const client = new GitHubClient(inputs.githubToken, context);
  const comment = await client.upsertPullRequestComment(
    body,
    buildCommentMarker(inputs.commentMarker),
  );

  core.setOutput("comment-id", String(comment.id));
  core.setOutput("comment-url", comment.htmlUrl);
  core.setOutput("deployment-urls", JSON.stringify(deploymentUrls));
  core.setOutput("statuses", JSON.stringify(statusKeys));
  core.info(`Pull request comment ${comment.action}: ${comment.htmlUrl}`);

  if (deployFailure) {
    throw deployFailure;
  }
}

function getProjectName(
  deployment: {
    projectName?: string;
    cwd?: string;
  },
  details: VercelDeploymentDetails | undefined,
  deploymentUrl: string | undefined,
): string {
  if (deployment.projectName) {
    return deployment.projectName;
  }

  if (details?.project?.name) {
    return details.project.name;
  }

  if (details?.name) {
    return details.name;
  }

  if (deploymentUrl) {
    return new URL(deploymentUrl).hostname;
  }

  return deployment.cwd ?? "Vercel Project";
}

function getPreviewUrl(
  deploymentUrl: string | undefined,
  details: VercelDeploymentDetails | undefined,
): string | undefined {
  const rawUrl = details?.url ?? deploymentUrl;
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
