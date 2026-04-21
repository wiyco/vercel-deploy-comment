export const ACTION_STATUSES = [
  "success",
  "failure",
  "cancelled",
  "skipped",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const MODES = [
  "deploy-and-comment",
  "comment-only",
] as const;
export type ActionMode = (typeof MODES)[number];

export interface BaseDeploymentInput {
  displayName?: string;
  environment: string;
  projectId: string;
  projectUrl: string;
  teamId?: string;
  slug?: string;
}

export interface DeployAndCommentDeploymentInput extends BaseDeploymentInput {
  cwd: string;
  deploymentUrl?: string;
  orgId: string;
}

export interface CommentOnlyDeploymentInput extends BaseDeploymentInput {
  deploymentUrl: string;
}

export type DeploymentInput =
  | DeployAndCommentDeploymentInput
  | CommentOnlyDeploymentInput;

export interface BaseActionInputs {
  githubToken: string;
  header: string;
  footer?: string;
  commentMarker: string;
  status: ActionStatus;
  commentOnFailure: boolean;
}

export interface DeployAndCommentActionInputs extends BaseActionInputs {
  vercelToken: string;
  mode: "deploy-and-comment";
  deployments: DeployAndCommentDeploymentInput[];
}

export interface CommentOnlyActionInputs extends BaseActionInputs {
  vercelToken?: string;
  mode: "comment-only";
  deployments: CommentOnlyDeploymentInput[];
}

export type ActionInputs =
  | DeployAndCommentActionInputs
  | CommentOnlyActionInputs;

export interface DisplayStatus {
  key: string;
  emoji: string;
  label: string;
}

export interface DeploymentCommentRow {
  environment: string;
  projectId: string;
  projectName: string;
  projectUrl: string;
  previewUrl?: string;
  status: DisplayStatus;
  runUrl: string;
  updatedAtUtc: string;
}

export interface VercelProjectDetails {
  id?: string;
  name?: string;
}

export interface VercelDeploymentDetails {
  id?: string;
  name?: string;
  url?: string;
  readyState?: string;
  createdAt?: number;
  project?: {
    id?: string;
    name?: string;
    framework?: string | null;
  };
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
