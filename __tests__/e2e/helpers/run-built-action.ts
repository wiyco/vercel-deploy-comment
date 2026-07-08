import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFakeVercelCli,
  type FakeVercelCall,
  type FakeVercelStep,
  readFakeVercelCalls,
} from "./create-fake-vercel-cli";

const BUILT_ACTION_TIMEOUT_MS = 30_000;

export interface FetchCall {
  body?: string;
  method: string;
  pathname: string;
  search: string;
  url: string;
}

export interface RecordedComment {
  body?: string;
  html_url: string;
  id: number;
  user?: {
    login?: string;
  };
}

export interface BuiltActionResult {
  comments: RecordedComment[];
  error?: string;
  exitCode: number;
  fetchCalls: FetchCall[];
  failureDetails: string;
  outputs: Record<string, string>;
  stderr: string;
  stdout: string;
  vercelCalls: FakeVercelCall[];
}

interface FetchState {
  calls: FetchCall[];
  comments: RecordedComment[];
}

export function runBuiltAction(options: {
  fakeVercel?: {
    deployUrl?: string;
    failStep?: FakeVercelStep;
  };
  fetchScenario?: unknown;
  inputs: Record<string, string>;
}): BuiltActionResult {
  const projectRoot = resolve(process.cwd());
  const distPath = join(projectRoot, "dist", "index.js");

  if (!existsSync(distPath)) {
    throw new Error("dist/index.js is required. Run pnpm run build first.");
  }

  const tempDirectory = mkdtempSync(
    join(tmpdir(), "vercel-deploy-comment-e2e-"),
  );

  try {
    const outputPath = join(tempDirectory, "github-output");
    const envPath = join(tempDirectory, "github-env");
    const statePath = join(tempDirectory, "github-state");
    const summaryPath = join(tempDirectory, "github-step-summary");
    const fetchScenarioPath = join(tempDirectory, "fetch-scenario.json");
    const fetchStatePath = join(tempDirectory, "fetch-state.json");
    const fakeVercel = options.fakeVercel
      ? createFakeVercelCli({
          ...options.fakeVercel,
          directory: tempDirectory,
        })
      : undefined;

    for (const filePath of [
      outputPath,
      envPath,
      statePath,
      summaryPath,
    ]) {
      writeFileSync(filePath, "", "utf8");
    }

    writeFileSync(
      fetchScenarioPath,
      `${JSON.stringify(options.fetchScenario ?? {}, null, 2)}\n`,
      "utf8",
    );

    const env = {
      ...process.env,
      ...toInputEnvironment(options.inputs),
      CI: "true",
      E2E_FETCH_SCENARIO_PATH: fetchScenarioPath,
      E2E_FETCH_STATE_PATH: fetchStatePath,
      E2E_VERCEL_CONFIG_PATH: fakeVercel?.configPath,
      E2E_VERCEL_LOG_PATH: fakeVercel?.logPath,
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_ENV: envPath,
      GITHUB_EVENT_PATH: join(
        projectRoot,
        "__tests__",
        "e2e",
        "fixtures",
        "pr-event.json",
      ),
      GITHUB_GRAPHQL_URL: "https://api.github.test/graphql",
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: "octocat/repo",
      GITHUB_RUN_ID: "987654321",
      GITHUB_SERVER_URL: "https://github.test",
      GITHUB_STATE: statePath,
      GITHUB_STEP_SUMMARY: summaryPath,
      NO_COLOR: "1",
      NODE_OPTIONS: [
        `--import=${
          pathToFileURL(
            join(
              projectRoot,
              "__tests__",
              "e2e",
              "helpers",
              "fetch-preload.mjs",
            ),
          ).href
        }`,
        process.env.NODE_OPTIONS,
      ]
        .filter(Boolean)
        .join(" "),
      PATH: fakeVercel
        ? `${fakeVercel.binDirectory}${delimiter}${process.env.PATH ?? ""}`
        : process.env.PATH,
    };

    const child = spawnSync(
      process.execPath,
      [
        distPath,
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env,
        maxBuffer: 10_000_000,
        timeout: BUILT_ACTION_TIMEOUT_MS,
      },
    );
    const spawnError = child.error ? formatSpawnError(child.error) : undefined;
    const stdout = child.stdout ?? "";
    const stderr = child.stderr ?? "";
    const fetchState = readJsonIfExists<FetchState>(fetchStatePath, {
      calls: [],
      comments: [],
    });

    return {
      comments: fetchState.comments,
      error: spawnError,
      exitCode: child.status ?? 1,
      fetchCalls: fetchState.calls,
      failureDetails: [
        spawnError ? `spawn error: ${spawnError}` : undefined,
        stdout,
        stderr,
      ]
        .filter(Boolean)
        .join("\n"),
      outputs: parseActionOutputFile(outputPath),
      stderr,
      stdout,
      vercelCalls: fakeVercel ? readFakeVercelCalls(fakeVercel.logPath) : [],
    };
  } finally {
    rmSync(tempDirectory, {
      force: true,
      recursive: true,
    });
  }
}

export function createSmokeWorkspace(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "vercel-deploy-comment-src-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(directory, relativePath);

    mkdirSync(dirname(absolutePath), {
      recursive: true,
    });
    writeFileSync(absolutePath, content, "utf8");
  }

  return directory;
}

function toInputEnvironment(
  inputs: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [
      `INPUT_${name.replace(/ /g, "_").toUpperCase()}`,
      value,
    ]),
  );
}

function formatSpawnError(
  error: Error & {
    code?: unknown;
  },
): string {
  const code = typeof error.code === "string" ? ` ${error.code}` : "";

  return `${error.name}${code}: ${error.message}`;
}

function parseActionOutputFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const outputs: Record<string, string> = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heredocMatch = line.match(/^([^<>=]+)<<(.+)$/);

    if (heredocMatch) {
      const name = heredocMatch[1];
      const delimiter = heredocMatch[2];

      if (!name || !delimiter) {
        continue;
      }

      const valueLines: string[] = [];
      index += 1;

      while (index < lines.length && lines[index] !== delimiter) {
        const valueLine = lines[index];

        if (valueLine === undefined) {
          break;
        }

        valueLines.push(valueLine);
        index += 1;
      }

      outputs[name] = valueLines.join("\n");
      continue;
    }

    const assignmentMatch = line.match(/^([^=]+)=(.*)$/);

    if (assignmentMatch) {
      const name = assignmentMatch[1];

      if (name) {
        outputs[name] = assignmentMatch[2] ?? "";
      }
    }
  }

  return outputs;
}

function readJsonIfExists<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }

  return JSON.parse(readFileSync(path, "utf8")) as T;
}
