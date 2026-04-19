import * as core from "@actions/core";
import {
  ACTION_STATUSES,
  type ActionInputs,
  type DeploymentInput,
  MODES,
} from "../shared/types";

interface RawInputReader {
  getInput(name: string, options?: core.InputOptions): string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function readActionInputs(reader: RawInputReader = core): ActionInputs {
  return parseActionInputs({
    githubToken: reader.getInput("github-token"),
    vercelToken: reader.getInput("vercel-token"),
    mode: reader.getInput("mode") || "deploy-and-comment",
    deployments: reader.getInput("deployments", {
      required: true,
    }),
    header: reader.getInput("header") || "Vercel Preview Deployment",
    footer: reader.getInput("footer", {
      trimWhitespace: false,
    }),
    commentMarker: reader.getInput("comment-marker") || "default",
    status: reader.getInput("status") || "success",
    commentOnFailure: reader.getInput("comment-on-failure") || "true",
  });
}

export interface RawActionInputs {
  githubToken: string;
  vercelToken?: string;
  mode: string;
  deployments: string;
  header: string;
  footer?: string;
  commentMarker: string;
  status: string;
  commentOnFailure: string;
}

export function parseActionInputs(raw: RawActionInputs): ActionInputs {
  const githubToken = requireNonEmpty(raw.githubToken, "github-token");
  const vercelToken = optionalNonEmpty(raw.vercelToken);
  const mode = parseEnum(raw.mode, MODES, "mode");
  const status = parseEnum(raw.status, ACTION_STATUSES, "status");
  const deployments = parseDeployments(raw.deployments);
  const commentMarker = parseCommentMarker(raw.commentMarker);
  const header = requireNonEmpty(raw.header, "header").replace(/\r?\n/g, " ");
  const footer = optionalNonEmpty(raw.footer);
  const commentOnFailure = parseBoolean(
    raw.commentOnFailure,
    "comment-on-failure",
  );

  if (mode === "deploy-and-comment" && !vercelToken) {
    throw new InputError(
      "vercel-token is required when mode is deploy-and-comment.",
    );
  }

  if (mode === "comment-only") {
    for (const [index, deployment] of deployments.entries()) {
      if (!deployment.deploymentUrl) {
        throw new InputError(
          `deployments[${index}].deploymentUrl is required when mode is comment-only.`,
        );
      }
    }
  }

  return {
    githubToken,
    vercelToken,
    mode,
    deployments,
    header,
    footer,
    commentMarker,
    status,
    commentOnFailure,
  };
}

function parseDeployments(rawDeployments: string): DeploymentInput[] {
  const raw = requireNonEmpty(rawDeployments, "deployments");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new InputError(
      `deployments must be valid JSON: ${formatCause(error)}`,
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new InputError("deployments must be a non-empty JSON array.");
  }

  return parsed.map((item, index) => parseDeploymentInput(item, index));
}

function parseDeploymentInput(item: unknown, index: number): DeploymentInput {
  if (!isRecord(item)) {
    throw new InputError(`deployments[${index}] must be an object.`);
  }

  const projectUrl = requireHttpUrl(
    item.projectUrl,
    `deployments[${index}].projectUrl`,
  );
  const cwd = optionalString(item.cwd, `deployments[${index}].cwd`);
  const projectName = optionalString(
    item.projectName,
    `deployments[${index}].projectName`,
  );
  const teamId = optionalString(item.teamId, `deployments[${index}].teamId`);
  const slug = optionalString(item.slug, `deployments[${index}].slug`);
  const deploymentUrl = optionalHttpUrl(
    item.deploymentUrl,
    `deployments[${index}].deploymentUrl`,
  );
  const command = parseOptionalCommand(
    item.command,
    `deployments[${index}].command`,
  );

  return {
    cwd,
    command,
    deploymentUrl,
    projectName,
    projectUrl,
    teamId,
    slug,
  };
}

function parseOptionalCommand(
  value: unknown,
  field: string,
): string | string[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return requireNonEmpty(value, field);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new InputError(`${field} must not be an empty array.`);
    }

    return value.map((entry, index) => {
      const trimmed = typeof entry === "string" ? entry.trim() : undefined;

      if (!trimmed) {
        throw new InputError(`${field}[${index}] must be a non-empty string.`);
      }

      return trimmed;
    });
  }

  throw new InputError(`${field} must be a string or string array.`);
}

function parseBoolean(value: string, field: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new InputError(`${field} must be true or false.`);
}

function parseCommentMarker(value: string): string {
  const marker = requireNonEmpty(value, "comment-marker");

  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(marker)) {
    throw new InputError(
      "comment-marker may contain only letters, numbers, underscore, period, colon, and hyphen.",
    );
  }

  return marker;
}

function parseEnum<const T extends readonly string[]>(
  value: string,
  values: T,
  field: string,
): T[number] {
  const normalized = value.trim();

  if (values.includes(normalized)) {
    return normalized as T[number];
  }

  throw new InputError(`${field} must be one of: ${values.join(", ")}.`);
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputError(`${field} is required.`);
  }

  return value.trim();
}

function optionalNonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalHttpUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InputError(`${field} must be a URL string.`);
  }

  return requireHttpUrl(value, field);
}

function requireHttpUrl(value: unknown, field: string): string {
  const raw = requireNonEmpty(value, field);

  try {
    const url = new URL(raw);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("URL must use http or https.");
    }

    return url.toString();
  } catch (error) {
    throw new InputError(
      `${field} must be a valid http or https URL: ${formatCause(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
