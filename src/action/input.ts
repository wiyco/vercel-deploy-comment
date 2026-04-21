import * as core from "@actions/core";
import { buildDeploymentRowKey } from "../shared/deployment-key";
import {
  ACTION_STATUSES,
  type ActionInputs,
  type BaseDeploymentInput,
  type CommentOnlyDeploymentInput,
  type DeployAndCommentDeploymentInput,
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
  const vercelToken = optionalString(raw.vercelToken, "vercel-token");
  const mode = parseEnum(raw.mode, MODES, "mode");
  const status = parseEnum(raw.status, ACTION_STATUSES, "status");
  const commentMarker = parseCommentMarker(raw.commentMarker);
  const header = requireNonEmpty(raw.header, "header").replace(/\r?\n/g, " ");
  const footer = optionalString(raw.footer, "footer");
  const commentOnFailure = parseBoolean(
    raw.commentOnFailure,
    "comment-on-failure",
  );

  const commonInputs = {
    githubToken,
    header,
    footer,
    commentMarker,
    status,
    commentOnFailure,
  };

  if (mode === "deploy-and-comment") {
    if (!vercelToken) {
      throw new InputError(
        "vercel-token is required when mode is deploy-and-comment.",
      );
    }

    return {
      ...commonInputs,
      vercelToken,
      mode,
      deployments: parseDeployments(raw.deployments, mode),
    };
  }

  return {
    ...commonInputs,
    vercelToken,
    mode,
    deployments: parseDeployments(raw.deployments, mode),
  };
}

function parseDeployments(
  rawDeployments: string,
  mode: "deploy-and-comment",
): DeployAndCommentDeploymentInput[];
function parseDeployments(
  rawDeployments: string,
  mode: "comment-only",
): CommentOnlyDeploymentInput[];
function parseDeployments(
  rawDeployments: string,
  mode: ActionInputs["mode"],
): DeploymentInput[] {
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

  if (mode === "deploy-and-comment") {
    const deployments = parsed.map((item, index) =>
      parseDeployAndCommentDeploymentInput(item, index),
    );
    assertUniqueDeploymentKeys(deployments);
    return deployments;
  }

  const deployments = parsed.map((item, index) =>
    parseCommentOnlyDeploymentInput(item, index),
  );
  assertUniqueDeploymentKeys(deployments);
  return deployments;
}

function assertUniqueDeploymentKeys(deployments: DeploymentInput[]): void {
  const seen = new Map<string, number>();

  deployments.forEach((deployment, index) => {
    const key = buildDeploymentRowKey(
      deployment.projectId,
      deployment.environment,
    );
    const firstIndex = seen.get(key);

    if (firstIndex !== undefined) {
      throw new InputError(
        `deployments[${index}] duplicates deployments[${firstIndex}] for projectId "${deployment.projectId}" and environment "${deployment.environment}". Each (projectId, environment) pair must be unique.`,
      );
    }

    seen.set(key, index);
  });
}

function parseDeploymentBase(
  item: Record<string, unknown>,
  index: number,
): BaseDeploymentInput {
  rejectDeprecatedField(item, index, "command");
  rejectDeprecatedField(item, index, "projectName");

  const projectId = requireNonEmpty(
    item.projectId,
    `deployments[${index}].projectId`,
  );
  const environment = requireNonEmpty(
    item.environment,
    `deployments[${index}].environment`,
  );
  const projectUrl = requireHttpsUrl(
    item.projectUrl,
    `deployments[${index}].projectUrl`,
  );
  const displayName = optionalString(
    item.displayName,
    `deployments[${index}].displayName`,
  );
  const teamId = optionalString(item.teamId, `deployments[${index}].teamId`);
  const slug = optionalString(item.slug, `deployments[${index}].slug`);

  return {
    displayName,
    environment,
    projectId,
    projectUrl,
    teamId,
    slug,
  };
}

function parseDeployAndCommentDeploymentInput(
  item: unknown,
  index: number,
): DeployAndCommentDeploymentInput {
  const record = requireRecord(item, `deployments[${index}]`);
  const base = parseDeploymentBase(record, index);

  return {
    ...base,
    cwd: requireNonEmpty(record.cwd, `deployments[${index}].cwd`),
    deploymentUrl: optionalHttpsUrl(
      record.deploymentUrl,
      `deployments[${index}].deploymentUrl`,
    ),
    orgId: requireNonEmpty(record.orgId, `deployments[${index}].orgId`),
  };
}

function parseCommentOnlyDeploymentInput(
  item: unknown,
  index: number,
): CommentOnlyDeploymentInput {
  const record = requireRecord(item, `deployments[${index}]`);
  const base = parseDeploymentBase(record, index);

  return {
    ...base,
    deploymentUrl: requireHttpsUrl(
      record.deploymentUrl,
      `deployments[${index}].deploymentUrl`,
    ),
  };
}

function parseBoolean(value: unknown, field: string): boolean {
  const normalized = requireString(value, field).trim().toLowerCase();

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
  value: unknown,
  values: T,
  field: string,
): T[number] {
  const normalized = requireString(value, field).trim();
  const enumValue = values.find((candidate) => candidate === normalized);

  if (enumValue !== undefined) {
    return enumValue;
  }

  throw new InputError(`${field} must be one of: ${values.join(", ")}.`);
}

function requireNonEmpty(value: unknown, field: string): string {
  if (value === undefined || value === null) {
    throw new InputError(`${field} is required.`);
  }

  const trimmed = requireString(value, field).trim();
  if (trimmed.length === 0) {
    throw new InputError(`${field} is required.`);
  }

  return trimmed;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const trimmed = requireString(value, field).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalHttpsUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InputError(`${field} must be a URL string.`);
  }

  return requireHttpsUrl(value, field);
}

function requireHttpsUrl(value: unknown, field: string): string {
  if (value === undefined || value === null || value === "") {
    throw new InputError(`${field} is required.`);
  }

  if (typeof value !== "string") {
    throw new InputError(`${field} must be a URL string.`);
  }

  const raw = requireNonEmpty(value, field);

  try {
    const url = new URL(raw);

    if (url.protocol !== "https:") {
      throw new Error("URL must use https.");
    }

    return url.toString();
  } catch (error) {
    throw new InputError(
      `${field} must be a valid https URL: ${formatCause(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InputError(`${field} must be an object.`);
  }

  return value;
}

function rejectDeprecatedField(
  value: Record<string, unknown>,
  index: number,
  field: "command" | "projectName",
): void {
  if (Object.hasOwn(value, field)) {
    throw new InputError(
      `deployments[${index}].${field} is no longer supported.`,
    );
  }
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InputError(`${field} must be a string.`);
  }

  return value;
}
