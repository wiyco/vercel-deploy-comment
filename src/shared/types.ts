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

export type DeploymentCommand = string | string[];

export interface DeploymentInput {
  cwd?: string;
  command?: DeploymentCommand;
  deploymentUrl?: string;
  projectName?: string;
  projectUrl: string;
  teamId?: string;
  slug?: string;
}

export interface ActionInputs {
  githubToken: string;
  vercelToken?: string;
  mode: ActionMode;
  deployments: DeploymentInput[];
  header: string;
  footer?: string;
  commentMarker: string;
  status: ActionStatus;
  commentOnFailure: boolean;
}

export interface DisplayStatus {
  key: string;
  emoji: string;
  label: string;
}

export interface DeploymentCommentRow {
  projectName: string;
  projectUrl: string;
  previewUrl?: string;
  status: DisplayStatus;
  runUrl: string;
  updatedAtUtc: string;
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
