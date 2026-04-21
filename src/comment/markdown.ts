import { buildDeploymentRowKey } from "../shared/deployment-key";
import type { DeploymentCommentRow, DisplayStatus } from "../shared/types";

const STANDARD_ENVIRONMENTS = new Set([
  "preview",
  "production",
  "development",
]);
const HTTPS_PROTOCOL = "https:";
const HTTP_PROTOCOL = "http:";
const HTTPS_ONLY_PROTOCOLS = [
  HTTPS_PROTOCOL,
] as const;
const HTTP_AND_HTTPS_PROTOCOLS = [
  HTTPS_PROTOCOL,
  HTTP_PROTOCOL,
] as const;

const ROW_MARKER_PATTERN = /<!--\s*vercel-deploy-comment:row:[^\r\n]*?-->/;

export function buildCommentMarker(marker: string): string {
  return `<!-- vercel-deploy-comment:${marker} -->`;
}

export function buildRowMarker(projectId: string, environment: string): string {
  return `<!-- vercel-deploy-comment:row:${encodeURIComponent(projectId)}:${encodeURIComponent(environment)} -->`;
}

export interface RenderCommentOptions {
  header: string;
  footer?: string;
  marker: string;
  rows: DeploymentCommentRow[];
}

export function renderDeploymentComment(options: RenderCommentOptions): string {
  const includeEnvironment = hasCustomEnvironment(options.rows);
  const lines = [
    `## ${escapeHeading(options.header)}`,
    "",
    renderTableHeader(includeEnvironment),
    renderTableSeparator(includeEnvironment),
    ...options.rows.map((row) => renderRow(row, includeEnvironment)),
  ];

  const footer = options.footer?.trim();

  if (footer) {
    lines.push("", footer);
  }

  lines.push("", buildCommentMarker(options.marker));

  return `${lines.join("\n")}\n`;
}

export function parseDeploymentCommentRows(
  body: string,
): DeploymentCommentRow[] {
  const rows: DeploymentCommentRow[] = [];

  for (const line of body.split(/\r?\n/)) {
    const parsed = parseDeploymentCommentRow(line);

    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

export function upsertDeploymentCommentRows(
  existingRows: DeploymentCommentRow[],
  nextRows: DeploymentCommentRow[],
  inputOrder: string[],
): DeploymentCommentRow[] {
  const orderedInputKeys = uniqueStrings(inputOrder);
  const inputKeySet = new Set(orderedInputKeys);
  const nextByKey = new Map(
    nextRows.map((row) => [
      buildDeploymentRowKey(row.projectId, row.environment),
      row,
    ]),
  );
  const mergedRows: DeploymentCommentRow[] = [];

  for (const key of orderedInputKeys) {
    const row = nextByKey.get(key);

    if (row) {
      mergedRows.push(row);
    }
  }

  for (const row of existingRows) {
    const key = buildDeploymentRowKey(row.projectId, row.environment);

    if (!inputKeySet.has(key)) {
      mergedRows.push(row);
    }
  }

  return mergedRows;
}

function renderTableHeader(includeEnvironment: boolean): string {
  if (includeEnvironment) {
    return "| Project | Environment | Status | Preview | Updated (UTC) |";
  }

  return "| Project | Status | Preview | Updated (UTC) |";
}

function renderTableSeparator(includeEnvironment: boolean): string {
  if (includeEnvironment) {
    return "| :--- | :--- | :--- | :--- | :--- |";
  }

  return "| :--- | :--- | :--- | :--- |";
}

function renderRow(
  row: DeploymentCommentRow,
  includeEnvironment: boolean,
): string {
  const project = `${buildRowMarker(row.projectId, row.environment)} ${markdownHttpsLink(
    row.projectName,
    row.projectUrl,
  )}`;
  const status = `${row.status.emoji} ${markdownLink(row.status.label, row.runUrl)}`;
  const preview = row.previewUrl
    ? markdownHttpsLink("Preview", row.previewUrl)
    : "Unavailable";
  const updatedAt = formatUtcTimestamp(row.updatedAtUtc);

  if (includeEnvironment) {
    return `| ${project} | ${escapeTableCell(row.environment)} | ${status} | ${preview} | ${escapeTableCell(updatedAt)} |`;
  }

  return `| ${project} | ${status} | ${preview} | ${escapeTableCell(updatedAt)} |`;
}

function parseDeploymentCommentRow(
  line: string,
): DeploymentCommentRow | undefined {
  const rowMarker = line.match(ROW_MARKER_PATTERN)?.[0];

  if (!rowMarker) {
    return undefined;
  }

  const rowIdentity = parseRowMarker(rowMarker);

  if (!rowIdentity) {
    return undefined;
  }

  const cells = splitTableCells(line);

  if (cells.length !== 4 && cells.length !== 5) {
    return undefined;
  }

  const projectCell = cells[0];
  const statusCell = cells.length === 4 ? cells[1] : cells[2];
  const previewCell = cells.length === 4 ? cells[2] : cells[3];
  const updatedAtUtc = cells.length === 4 ? cells[3] : cells[4];

  if (!projectCell || !statusCell || !previewCell || !updatedAtUtc) {
    return undefined;
  }

  const projectLink = parseMarkdownLink(
    projectCell.replace(rowMarker, "").trim(),
    HTTPS_ONLY_PROTOCOLS,
  );
  const statusDetails = parseStatusCell(statusCell);

  if (!projectLink || !statusDetails) {
    return undefined;
  }

  const previewLink =
    previewCell === "Unavailable"
      ? undefined
      : parseMarkdownLink(previewCell, HTTPS_ONLY_PROTOCOLS);

  return {
    environment: rowIdentity.environment,
    projectId: rowIdentity.projectId,
    projectName: projectLink.label,
    projectUrl: projectLink.url,
    previewUrl: previewLink?.url,
    runUrl: statusDetails.runUrl,
    status: statusDetails.status,
    updatedAtUtc: unescapeTableCell(updatedAtUtc),
  };
}

function parseRowMarker(marker: string):
  | {
      projectId: string;
      environment: string;
    }
  | undefined {
  const trimmed = marker.trim();
  const payload = trimmed
    .replace(/^<!--\s*vercel-deploy-comment:row:/, "")
    .replace(/\s*-->$/, "");
  const separatorIndex = payload.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= payload.length - 1) {
    return undefined;
  }

  try {
    return {
      projectId: decodeURIComponent(payload.slice(0, separatorIndex)),
      environment: decodeURIComponent(payload.slice(separatorIndex + 1)),
    };
  } catch {
    return undefined;
  }
}

function parseStatusCell(cell: string):
  | {
      runUrl: string;
      status: DisplayStatus;
    }
  | undefined {
  const linkStart = cell.indexOf("[");

  if (linkStart <= 0) {
    return undefined;
  }

  const emoji = cell.slice(0, linkStart).trim();
  const link = parseMarkdownLink(
    cell.slice(linkStart).trim(),
    HTTP_AND_HTTPS_PROTOCOLS,
  );

  if (!emoji || !link) {
    return undefined;
  }

  return {
    runUrl: link.url,
    status: {
      key: labelToStatusKey(link.label),
      emoji,
      label: link.label,
    },
  };
}

function parseMarkdownLink(
  cell: string,
  allowedProtocols: readonly string[] = HTTP_AND_HTTPS_PROTOCOLS,
):
  | {
      label: string;
      url: string;
    }
  | undefined {
  const match = cell.match(/^\[(.*)\]\((https?:\/\/.+)\)$/);

  if (!match) {
    return undefined;
  }

  const label = match[1];
  const url = match[2];

  if (!label || !url) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(url);

    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      return undefined;
    }

    return {
      label: unescapeLinkLabel(label),
      url: parsedUrl.toString(),
    };
  } catch {
    return undefined;
  }
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();

  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }

  const cells: string[] = [];
  let current = "";

  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];
    const previous = trimmed[index - 1];

    if (char === "|" && previous !== "\\") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function hasCustomEnvironment(rows: DeploymentCommentRow[]): boolean {
  return rows.some((row) => isCustomEnvironment(row.environment));
}

function isCustomEnvironment(environment: string): boolean {
  return !STANDARD_ENVIRONMENTS.has(environment.trim().toLowerCase());
}

function markdownLink(label: string, url: string): string {
  return markdownLinkWithProtocols(label, url, HTTP_AND_HTTPS_PROTOCOLS);
}

function markdownHttpsLink(label: string, url: string): string {
  return markdownLinkWithProtocols(label, url, HTTPS_ONLY_PROTOCOLS);
}

function markdownLinkWithProtocols(
  label: string,
  url: string,
  allowedProtocols: readonly string[],
): string {
  return `[${escapeLinkLabel(label)}](${escapeMarkdownUrl(url, allowedProtocols)})`;
}

function escapeHeading(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function escapeTableCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replaceAll("|", "\\|").trim();
}

function unescapeTableCell(value: string): string {
  return value.replaceAll("\\|", "|").trim();
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

function unescapeLinkLabel(value: string): string {
  return value.replace(/\\([\\[\]|])/g, "$1").trim();
}

function escapeMarkdownUrl(
  value: string,
  allowedProtocols: readonly string[] = HTTP_AND_HTTPS_PROTOCOLS,
): string {
  const url = new URL(value);

  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(markdownUrlProtocolError(allowedProtocols));
  }

  return url.toString().replaceAll("(", "%28").replaceAll(")", "%29");
}

function markdownUrlProtocolError(allowedProtocols: readonly string[]): string {
  if (allowedProtocols.length === 1 && allowedProtocols[0] === HTTPS_PROTOCOL) {
    return "Markdown links only support https URLs.";
  }

  return "Markdown links only support http and https URLs.";
}

function labelToStatusKey(label: string): string {
  switch (label.trim().toLowerCase()) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "in progress":
      return "in_progress";
    case "unknown":
      return "unknown";
    default:
      return label.trim().toLowerCase().replace(/\s+/g, "_");
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }

  return unique;
}
