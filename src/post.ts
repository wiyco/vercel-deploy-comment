import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import { runActionPost } from "./action/run";
import { toError } from "./action/runtime";

export async function run(): Promise<void> {
  await runActionPost();
}

function isDirectRun(): boolean {
  return Boolean(
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
  );
}

if (isDirectRun()) {
  run().catch((error: unknown) => {
    core.setFailed(toError(error).message);
  });
}
