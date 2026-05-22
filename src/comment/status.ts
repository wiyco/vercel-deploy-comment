import type {
  ActionStatus,
  CommentOnlyDeploymentStatus,
  DisplayStatus,
} from "../shared/types";

const READY: DisplayStatus = {
  key: "ready",
  emoji: "✅",
  label: "Ready",
};
const FAILED: DisplayStatus = {
  key: "failed",
  emoji: "❌",
  label: "Failed",
};
const CANCELLED: DisplayStatus = {
  key: "cancelled",
  emoji: "🚫",
  label: "Cancelled",
};
const SKIPPED: DisplayStatus = {
  key: "skipped",
  emoji: "⏭️",
  label: "Skipped",
};
const IN_PROGRESS: DisplayStatus = {
  key: "in_progress",
  emoji: "⏳",
  label: "In Progress",
};
const UNKNOWN: DisplayStatus = {
  key: "unknown",
  emoji: "❔",
  label: "Unknown",
};

const IN_PROGRESS_READY_STATES = new Set([
  "BUILDING",
  "QUEUED",
  "INITIALIZING",
  "ANALYZING",
]);

export interface ResolveStatusOptions {
  deploymentStatus?: CommentOnlyDeploymentStatus;
  vercelReadyState?: string;
  actionStatus: ActionStatus;
}

export function getInProgressDisplayStatus(): DisplayStatus {
  return IN_PROGRESS;
}

export function getCancelledDisplayStatus(): DisplayStatus {
  return CANCELLED;
}

export function resolveDisplayStatus(
  options: ResolveStatusOptions,
): DisplayStatus {
  if (options.deploymentStatus) {
    return resolveExplicitDisplayStatus(options.deploymentStatus);
  }

  const readyState = options.vercelReadyState?.trim().toUpperCase();

  if (readyState) {
    if (readyState === "READY") {
      return READY;
    }

    if (readyState === "ERROR") {
      return FAILED;
    }

    if (readyState === "CANCELED" || readyState === "CANCELLED") {
      return CANCELLED;
    }

    if (IN_PROGRESS_READY_STATES.has(readyState)) {
      return IN_PROGRESS;
    }

    return UNKNOWN;
  }

  switch (options.actionStatus) {
    case "success":
      return READY;
    case "failure":
      return FAILED;
    case "cancelled":
      return CANCELLED;
    case "skipped":
      return SKIPPED;
    default:
      return UNKNOWN;
  }
}

function resolveExplicitDisplayStatus(
  status: CommentOnlyDeploymentStatus,
): DisplayStatus {
  switch (status) {
    case "ready":
      return READY;
    case "failed":
      return FAILED;
    case "cancelled":
      return CANCELLED;
    case "skipped":
      return SKIPPED;
    case "in_progress":
      return IN_PROGRESS;
    default:
      return UNKNOWN;
  }
}
