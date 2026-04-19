import type { DeploymentCommentRow } from "../shared/types";

export function buildCommentMarker(marker: string): string {
  return `<!-- vercel-deploy-comment:${marker} -->`;
}

export interface RenderCommentOptions {
  header: string;
  footer?: string;
  marker: string;
  rows: DeploymentCommentRow[];
}

export function renderDeploymentComment(options: RenderCommentOptions): string {
  const lines = [
    `## ${escapeHeading(options.header)}`,
    "",
    "| Project | Deployment | Preview | Updated (UTC) |",
    "| :--- | :----- | :------ | :------ |",
    ...options.rows.map(renderRow),
  ];

  const footer = options.footer?.trim();

  if (footer) {
    lines.push("", footer);
  }

  lines.push("", buildCommentMarker(options.marker));

  return `${lines.join("\n")}\n`;
}

function renderRow(row: DeploymentCommentRow): string {
  const project = markdownLink(row.projectName, row.projectUrl);
  const deployment = `${row.status.emoji} ${markdownLink(row.status.label, row.runUrl)}`;
  const preview = row.previewUrl
    ? markdownLink("Preview", row.previewUrl)
    : "Unavailable";
  const updatedAt = formatUtcTimestamp(row.updatedAtUtc);

  return `| ${project} | ${deployment} | ${preview} | ${escapeTableCell(updatedAt)} |`;
}

function markdownLink(label: string, url: string): string {
  return `[${escapeLinkLabel(label)}](${escapeMarkdownUrl(url)})`;
}

function escapeHeading(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replaceAll("|", "\\|").trim();
}

function formatUtcTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = padUtcPart(date.getUTCMonth() + 1);
  const day = padUtcPart(date.getUTCDate());
  const hours = padUtcPart(date.getUTCHours());
  const minutes = padUtcPart(date.getUTCMinutes());
  const seconds = padUtcPart(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

function padUtcPart(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeLinkLabel(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("|", "\\|")
    .trim();
}

function escapeMarkdownUrl(value: string): string {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Markdown links only support http and https URLs.");
  }

  return url.toString().replaceAll("(", "%28").replaceAll(")", "%29");
}
