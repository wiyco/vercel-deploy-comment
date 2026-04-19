import type { ExecOptions } from "@actions/exec";
import type {
  DeploymentInput,
  FetchLike,
  VercelDeploymentDetails,
} from "../shared/types";

const DEFAULT_COMMAND = [
  "vercel",
  "deploy",
  "--prebuilt",
] as const;

type ParsedCommand = [
  string,
  ...string[],
];

export type ExecFunction = (
  commandLine: string,
  args?: string[],
  options?: ExecOptions,
) => Promise<number>;

export class VercelDeployError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number,
    readonly deploymentUrl?: string,
  ) {
    super(message);
    this.name = "VercelDeployError";
  }
}

export interface RunDeployOptions {
  deployment: DeploymentInput;
  token: string;
  exec: ExecFunction;
}

export async function runVercelDeploy(
  options: RunDeployOptions,
): Promise<string> {
  const argv = parseCommand(
    options.deployment.command ?? [
      ...DEFAULT_COMMAND,
    ],
  );
  const [tool, ...args] = appendVercelToken(argv, options.token);
  let stdout = "";

  const exitCode = await options.exec(tool, args, {
    cwd: options.deployment.cwd,
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString("utf8");
      },
    },
  });

  const deploymentUrl = extractDeploymentUrl(stdout);

  if (exitCode !== 0) {
    throw new VercelDeployError(
      `Vercel deploy failed with exit code ${exitCode}.`,
      exitCode,
      deploymentUrl,
    );
  }

  if (!deploymentUrl) {
    throw new VercelDeployError(
      "Vercel deploy did not print a deployment URL to stdout.",
    );
  }

  return deploymentUrl;
}

export function parseCommand(command: string | string[]): ParsedCommand {
  if (Array.isArray(command)) {
    const parts = Array.from(command);

    if (
      parts.length === 0 ||
      parts.some((part) => typeof part !== "string" || part.trim().length === 0)
    ) {
      throw new VercelDeployError(
        "Deploy command array must contain non-empty strings.",
      );
    }

    return parts as ParsedCommand;
  }

  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  const chars = [
    ...command,
  ];

  let skipNext = false;

  for (const [index, char] of chars.entries()) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const next = chars[index + 1];

    if (
      char === "\\" &&
      next !== undefined &&
      isEscapableCommandChar(next, quote)
    ) {
      current += next;
      skipNext = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current.length > 0) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new VercelDeployError(
      "Deploy command contains an unterminated quote.",
    );
  }

  if (current.length > 0) {
    argv.push(current);
  }

  if (argv.length === 0) {
    throw new VercelDeployError("Deploy command is empty.");
  }

  return argv as ParsedCommand;
}

function isEscapableCommandChar(
  char: string,
  quote: "'" | '"' | undefined,
): boolean {
  if (quote === "'") {
    return false;
  }

  if (quote === '"') {
    return char === '"';
  }

  return char === "'" || char === '"' || /\s/.test(char);
}

export function extractDeploymentUrl(stdout: string): string | undefined {
  const matches = stdout.match(/https?:\/\/[^\s<>"']+/g);
  const lastMatch = matches?.at(-1);

  if (!lastMatch) {
    return undefined;
  }

  return lastMatch.replace(/[),.;]+$/g, "");
}

export interface GetDeploymentDetailsOptions {
  deploymentUrl: string;
  token: string;
  teamId?: string;
  slug?: string;
  fetch: FetchLike;
}

export async function getVercelDeploymentDetails(
  options: GetDeploymentDetailsOptions,
): Promise<VercelDeploymentDetails> {
  const idOrUrl = deploymentUrlToIdOrHost(options.deploymentUrl);
  const apiUrl = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(idOrUrl)}`,
  );
  apiUrl.searchParams.set("withGitRepoInfo", "true");

  if (options.teamId) {
    apiUrl.searchParams.set("teamId", options.teamId);
  }

  if (options.slug) {
    apiUrl.searchParams.set("slug", options.slug);
  }

  const response = await options.fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      "User-Agent": "vercel-deploy-comment",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Vercel API request failed with status ${response.status} ${response.statusText}.`,
    );
  }

  return (await response.json()) as VercelDeploymentDetails;
}

export function toHttpUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return new URL(value).toString();
  }

  return new URL(`https://${value}`).toString();
}

function appendVercelToken(argv: ParsedCommand, token: string): ParsedCommand {
  if (!isVercelInvocation(argv) || hasTokenArgument(argv)) {
    return argv;
  }

  return [
    ...argv,
    `--token=${token}`,
  ] as ParsedCommand;
}

function isVercelInvocation(argv: string[]): boolean {
  const [tool, firstArg, secondArg] = argv;
  return (
    isVercelBinary(tool) ||
    isVercelBinary(firstArg) ||
    isPackageRunnerVercelInvocation(tool, firstArg, secondArg)
  );
}

function isVercelBinary(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /(^|[/\\])vercel(\.cmd)?$/i.test(value);
}

function isPackageRunnerVercelInvocation(
  tool: string | undefined,
  firstArg: string | undefined,
  secondArg: string | undefined,
): boolean {
  if (!tool || !firstArg || !secondArg) {
    return false;
  }

  const runner = getBinaryName(tool);
  const subcommand = firstArg.toLowerCase();

  if (runner === "pnpm" && (subcommand === "exec" || subcommand === "dlx")) {
    return isVercelBinary(secondArg);
  }

  return runner === "npm" && subcommand === "exec" && isVercelBinary(secondArg);
}

function getBinaryName(value: string): string {
  return value
    .replace(/^.*[/\\]/, "")
    .replace(/\.cmd$/i, "")
    .toLowerCase();
}

function hasTokenArgument(argv: string[]): boolean {
  return argv.some((arg) => arg === "--token" || arg.startsWith("--token="));
}

function deploymentUrlToIdOrHost(value: string): string {
  const url = new URL(value);
  return url.hostname;
}
