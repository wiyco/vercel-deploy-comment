import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import { runActionMain } from "./action/run";
import { toError } from "./action/runtime";

export async function run(): Promise<void> {
  await runActionMain();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error: unknown) => {
    core.setFailed(toError(error).message);
  });
}
