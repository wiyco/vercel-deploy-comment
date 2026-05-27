import * as core from "@actions/core";
import {
  buildRunUrl,
  GitHubClient,
  readGitHubRuntimeContext,
} from "../github/client";
import type { ActionInputs } from "../shared/types";
import { readActionInputs } from "./input";

export interface ActionRuntime {
  client: GitHubClient;
  inputs: ActionInputs;
  runUrl: string;
}

export function initializeActionRuntime(
  inputs: ActionInputs = readActionInputs(),
): ActionRuntime {
  maskActionSecrets(inputs);

  const context = readGitHubRuntimeContext();

  return {
    client: new GitHubClient(inputs.githubToken, context),
    inputs,
    runUrl: buildRunUrl(context),
  };
}

export function maskActionSecrets(inputs: {
  githubToken: string;
  vercelToken?: string;
}): void {
  core.setSecret(inputs.githubToken);

  if (inputs.vercelToken) {
    core.setSecret(inputs.vercelToken);
  }
}

export function sanitizeErrorMessage(
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

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
