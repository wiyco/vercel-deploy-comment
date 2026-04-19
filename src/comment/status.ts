import type { ActionStatus, DisplayStatus } from "../shared/types";

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
  vercelReadyState?: string;
  actionStatus: ActionStatus;
}

export function resolveDisplayStatus(
  options: ResolveStatusOptions,
): DisplayStatus {
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
  }
}
