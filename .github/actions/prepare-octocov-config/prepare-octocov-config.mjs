import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const artifactUrl = process.env.COVERAGE_ARTIFACT_URL ?? "";
const workspace = process.env.GITHUB_WORKSPACE;
const outputPath = process.env.GITHUB_OUTPUT;
const repository = process.env.GITHUB_REPOSITORY;
const serverUrlValue = process.env.GITHUB_SERVER_URL;

if (!workspace) {
  throw new Error("Missing GITHUB_WORKSPACE");
}
if (!outputPath) {
  throw new Error("Missing GITHUB_OUTPUT");
}
if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY");
}
if (!serverUrlValue) {
  throw new Error("Missing GITHUB_SERVER_URL");
}

const configPath = join(workspace, `.octocov.${randomUUID()}.yml`);
copyFileSync(join(workspace, ".octocov.yml"), configPath);
appendFileSync(outputPath, `config-path=${configPath}\n`);

if (!artifactUrl) {
  process.exit(0);
}

const serverUrl = new URL(serverUrlValue);
const url = new URL(artifactUrl);

if (
  url.origin !== serverUrl.origin ||
  !url.pathname.startsWith(`/${repository}/actions/runs/`) ||
  !url.pathname.includes("/artifacts/")
) {
  throw new Error(`Unexpected coverage artifact URL: ${artifactUrl}`);
}

const message = `Download coverage report: [lcov-report](${url.href})`;
const lines = readFileSync(configPath, "utf8").split("\n");
const commentIndex = lines.indexOf("comment:");

if (commentIndex === -1) {
  throw new Error("Missing comment section in octocov config");
}

let insertIndex = commentIndex + 1;
while (insertIndex < lines.length && lines[insertIndex].startsWith("  ")) {
  if (lines[insertIndex].startsWith("  message:")) {
    lines[insertIndex] = `  message: ${JSON.stringify(message)}`;
    break;
  }
  insertIndex += 1;
}

if (!lines[insertIndex]?.startsWith("  message:")) {
  lines.splice(insertIndex, 0, `  message: ${JSON.stringify(message)}`);
}

writeFileSync(configPath, lines.join("\n"));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
