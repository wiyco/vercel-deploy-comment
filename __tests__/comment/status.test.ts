import { describe, expect, it } from "vitest";
import { resolveDisplayStatus } from "../../src/comment/status";

describe("resolveDisplayStatus", () => {
  it.each([
    [
      "READY",
      "ready",
      "✅",
      "Ready",
    ],
    [
      "ERROR",
      "failed",
      "❌",
      "Failed",
    ],
    [
      "CANCELED",
      "cancelled",
      "🚫",
      "Cancelled",
    ],
    [
      "BUILDING",
      "in_progress",
      "⏳",
      "In Progress",
    ],
    [
      "QUEUED",
      "in_progress",
      "⏳",
      "In Progress",
    ],
  ])("maps Vercel readyState %s", (readyState, key, emoji, label) => {
    expect(
      resolveDisplayStatus({
        vercelReadyState: readyState,
        actionStatus: "success",
      }),
    ).toEqual({
      key,
      emoji,
      label,
    });
  });

  it.each([
    [
      "success",
      "ready",
      "✅",
      "Ready",
    ],
    [
      "failure",
      "failed",
      "❌",
      "Failed",
    ],
    [
      "cancelled",
      "cancelled",
      "🚫",
      "Cancelled",
    ],
    [
      "skipped",
      "skipped",
      "⏭️",
      "Skipped",
    ],
  ] as const)("falls back to action status %s", (actionStatus, key, emoji, label) => {
    expect(
      resolveDisplayStatus({
        actionStatus,
      }),
    ).toEqual({
      key,
      emoji,
      label,
    });
  });

  it("returns unknown for unrecognized Vercel states", () => {
    expect(
      resolveDisplayStatus({
        vercelReadyState: "ALIEN",
        actionStatus: "success",
      }),
    ).toEqual({
      key: "unknown",
      emoji: "❔",
      label: "Unknown",
    });
  });
});
