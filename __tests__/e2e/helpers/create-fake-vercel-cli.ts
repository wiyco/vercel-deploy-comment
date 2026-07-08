import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type FakeVercelStep = "pull" | "build" | "deploy";

export interface FakeVercelCall {
  args: string[];
  cwd: string;
  envToken?: string;
  gitDirectoryExists: boolean;
  ignoredVercelFileExists: boolean;
  inputEnvKeys: string[];
  inputGitHubToken?: string;
  inputVercelToken?: string;
  projectFile?: string;
  sourceFileExists: boolean;
  step: string;
}

export interface FakeVercelCli {
  binDirectory: string;
  configPath: string;
  logPath: string;
}

export function createFakeVercelCli(options: {
  deployUrl?: string;
  directory: string;
  failStep?: FakeVercelStep;
}): FakeVercelCli {
  const binDirectory = join(options.directory, "bin");
  const configPath = join(options.directory, "vercel-config.json");
  const logPath = join(options.directory, "vercel-calls.jsonl");
  const executablePath = join(binDirectory, "vercel");

  mkdirSync(binDirectory, {
    recursive: true,
  });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        deployUrl: options.deployUrl,
        failStep: options.failStep,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(executablePath, FAKE_VERCEL_SCRIPT, "utf8");
  chmodSync(executablePath, 0o755);

  return {
    binDirectory,
    configPath,
    logPath,
  };
}

export function readFakeVercelCalls(logPath: string): FakeVercelCall[] {
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeVercelCall);
}

const FAKE_VERCEL_SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const config = JSON.parse(
  fs.readFileSync(requireEnv("E2E_VERCEL_CONFIG_PATH"), "utf8"),
);
const logPath = requireEnv("E2E_VERCEL_LOG_PATH");
const args = process.argv.slice(2);
const step = args[0] || "";
const projectFilePath = path.join(process.cwd(), ".vercel", "project.json");
const projectFile = fs.existsSync(projectFilePath)
  ? fs.readFileSync(projectFilePath, "utf8")
  : undefined;

fs.appendFileSync(
  logPath,
  \`\${JSON.stringify({
    args,
    cwd: process.cwd(),
    envToken: process.env.VERCEL_TOKEN,
    gitDirectoryExists: fs.existsSync(path.join(process.cwd(), ".git")),
    ignoredVercelFileExists: fs.existsSync(
      path.join(process.cwd(), ".vercel", "ignored.txt"),
    ),
    inputEnvKeys: Object.keys(process.env)
      .filter((key) => key.startsWith("INPUT_"))
      .sort(),
    inputGitHubToken: process.env["INPUT_GITHUB-TOKEN"],
    inputVercelToken: process.env["INPUT_VERCEL-TOKEN"],
    projectFile,
    sourceFileExists: fs.existsSync(path.join(process.cwd(), "package.json")),
    step,
  })}\\n\`,
  "utf8",
);

if (step === "deploy" && config.deployUrl) {
  process.stdout.write(\`\${config.deployUrl}\\n\`);
}

if (config.failStep === step) {
  process.exit(1);
}

process.exit(0);

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(\`\${name} is required.\`);
  }

  return value;
}
`;
