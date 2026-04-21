import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecOptions } from "@actions/exec";
import type {
  DeployAndCommentDeploymentInput,
  FetchLike,
  VercelDeploymentDetails,
  VercelProjectDetails,
} from "../shared/types";

const VERCEL_BINARY = "vercel";
const EXCLUDED_WORKSPACE_ENTRY_NAMES = new Set([
  ".git",
  ".vercel",
]);
const ACTION_INPUT_ENV_PREFIX = "INPUT_";

type VercelDeployStep = "pull" | "build" | "deploy";

export type ExecFunction = (
  commandLine: string,
  args?: string[],
  options?: ExecOptions,
) => Promise<number>;

export class VercelDeployError extends Error {
  constructor(
    message: string,
    readonly step?: VercelDeployStep,
    readonly exitCode?: number,
    readonly deploymentUrl?: string,
  ) {
    super(message);
    this.name = "VercelDeployError";
  }
}

export interface RunDeployOptions {
  deployment: DeployAndCommentDeploymentInput;
  token: string;
  exec: ExecFunction;
}

export async function runVercelDeploy(
  options: RunDeployOptions,
): Promise<string> {
  const sourceDirectory = resolve(options.deployment.cwd);
  const tempWorkspace = await mkdtemp(join(tmpdir(), "vercel-deploy-comment-"));

  try {
    await copyWorkspace(sourceDirectory, tempWorkspace);
    await writeProjectSettings(
      tempWorkspace,
      options.deployment.projectId,
      options.deployment.orgId,
    );

    await runVercelStep({
      exec: options.exec,
      cwd: tempWorkspace,
      step: "pull",
      passToken: true,
      token: options.token,
      args: [
        "pull",
        "--yes",
        "--environment",
        options.deployment.environment,
      ],
    });
    await runVercelStep({
      exec: options.exec,
      cwd: tempWorkspace,
      step: "build",
      token: options.token,
      args: [
        "build",
        "--yes",
      ],
    });

    const deployStdout = await runVercelStep({
      exec: options.exec,
      cwd: tempWorkspace,
      step: "deploy",
      passToken: true,
      token: options.token,
      args: [
        "deploy",
        "--prebuilt",
      ],
      captureStdout: true,
    });
    const deploymentUrl = extractDeploymentUrl(deployStdout);

    if (!deploymentUrl) {
      throw new VercelDeployError(
        "Vercel deploy did not print a deployment URL to stdout.",
        "deploy",
      );
    }

    return deploymentUrl;
  } finally {
    await rm(tempWorkspace, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * `vercel pull`, `vercel build`, and `vercel deploy --prebuilt` run inside an
 * isolated temp workspace rather than the repository checkout.
 *
 * The exclude list intentionally stays narrow. Heavy top-level directories
 * such as `node_modules` may be copied when `cwd` points at the repo root,
 * which can increase temp workspace size and deployment latency. We do not
 * exclude those entries by default because `vercel build` runs inside the
 * copied workspace, and changing the default copy set can change build
 * behavior for projects that expect the full workspace contents under `cwd`.
 *
 * See:
 * * `README.md` Usage / deploy-and-comment steps
 * * `docs/spec.md` Runtime Design > Deploy Execution
 * * https://vercel.com/docs/cli/build
 * * https://vercel.com/docs/deployments/configure-a-build
 */
async function copyWorkspace(
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  const entries = await readdir(sourceDirectory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (EXCLUDED_WORKSPACE_ENTRY_NAMES.has(entry.name)) {
      continue;
    }

    await cp(
      join(sourceDirectory, entry.name),
      join(destinationDirectory, entry.name),
      {
        recursive: true,
      },
    );
  }
}

async function writeProjectSettings(
  workspaceDirectory: string,
  projectId: string,
  orgId: string,
): Promise<void> {
  const vercelDirectory = join(workspaceDirectory, ".vercel");
  const projectFile = join(vercelDirectory, "project.json");

  await mkdir(vercelDirectory, {
    recursive: true,
  });
  await writeFile(
    projectFile,
    `${JSON.stringify(
      {
        projectId,
        orgId,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function runVercelStep(options: {
  exec: ExecFunction;
  cwd: string;
  step: VercelDeployStep;
  token: string;
  passToken?: boolean;
  args: string[];
  captureStdout?: boolean;
}): Promise<string> {
  let stdout = "";

  const exitCode = await options.exec(VERCEL_BINARY, options.args, {
    cwd: options.cwd,
    env: buildVercelEnvironment(options.passToken ? options.token : undefined),
    ignoreReturnCode: true,
    listeners: options.captureStdout
      ? {
          stdout: (data: Buffer) => {
            stdout += data.toString("utf8");
          },
        }
      : undefined,
  });

  if (exitCode !== 0) {
    throw new VercelDeployError(
      `Vercel ${options.step} failed with exit code ${exitCode}.`,
      options.step,
      exitCode,
      options.step === "deploy" ? extractDeploymentUrl(stdout) : undefined,
    );
  }

  return stdout;
}

function buildVercelEnvironment(token?: string): Record<string, string> {
  const env = Object.assign({} as Record<string, string>, process.env);

  // GitHub Action inputs are exposed through INPUT_* env vars. Strip them from
  // all child processes so repo-controlled build code does not inherit action
  // inputs such as github-token or vercel-token.
  for (const key of Object.keys(env)) {
    if (key.startsWith(ACTION_INPUT_ENV_PREFIX)) {
      delete env[key];
    }
  }

  delete env.VERCEL_TOKEN;

  if (token) {
    env.VERCEL_TOKEN = token;
  }

  return env;
}

export function extractDeploymentUrl(stdout: string): string | undefined {
  const matches = stdout.match(/https?:\/\/[^\s<>"']+/g);
  const lastMatch = matches?.at(-1);

  if (!lastMatch) {
    return undefined;
  }

  return lastMatch.replace(/[),.;]+$/g, "");
}

interface VercelApiSearchParams {
  teamId?: string;
  slug?: string;
}

export interface GetProjectDetailsOptions extends VercelApiSearchParams {
  projectId: string;
  token: string;
  fetch: FetchLike;
}

export async function getVercelProjectDetails(
  options: GetProjectDetailsOptions,
): Promise<VercelProjectDetails> {
  const apiUrl = buildVercelApiUrl(
    `/v9/projects/${encodeURIComponent(options.projectId)}`,
    options,
  );

  return requestVercelApi<VercelProjectDetails>(
    apiUrl,
    options.token,
    options.fetch,
  );
}

export interface GetDeploymentDetailsOptions extends VercelApiSearchParams {
  deploymentUrl: string;
  token: string;
  fetch: FetchLike;
}

export async function getVercelDeploymentDetails(
  options: GetDeploymentDetailsOptions,
): Promise<VercelDeploymentDetails> {
  const idOrUrl = deploymentUrlToIdOrHost(options.deploymentUrl);
  const apiUrl = buildVercelApiUrl(
    `/v13/deployments/${encodeURIComponent(idOrUrl)}`,
    options,
  );

  apiUrl.searchParams.set("withGitRepoInfo", "true");

  return requestVercelApi<VercelDeploymentDetails>(
    apiUrl,
    options.token,
    options.fetch,
  );
}

export function toHttpUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return new URL(value).toString();
  }

  return new URL(`https://${value}`).toString();
}

function buildVercelApiUrl(
  pathname: string,
  searchParams: VercelApiSearchParams = {},
): URL {
  const apiUrl = new URL(pathname, "https://api.vercel.com");

  if (searchParams.teamId) {
    apiUrl.searchParams.set("teamId", searchParams.teamId);
  }

  if (searchParams.slug) {
    apiUrl.searchParams.set("slug", searchParams.slug);
  }

  return apiUrl;
}

async function requestVercelApi<T>(
  url: URL,
  token: string,
  fetchImplementation: FetchLike,
): Promise<T> {
  const response = await fetchImplementation(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "vercel-deploy-comment",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Vercel API request failed with status ${response.status} ${response.statusText}.`,
    );
  }

  return (await response.json()) as T;
}

function deploymentUrlToIdOrHost(value: string): string {
  const url = new URL(value);
  return url.hostname;
}
