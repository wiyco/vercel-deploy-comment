import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import { runActionMain, runActionPost } from "./action/run";
import { toError } from "./action/runtime";

const POST_CLEANUP_REGISTERED_STATE =
  "vercelDeployCommentPostCleanupRegistered";
const MAIN_OUTCOME_STATE = "vercelDeployCommentMainOutcome";
const JOB_STATUS_INPUT = "job-status";

export async function run(): Promise<void> {
  if (core.getState(POST_CLEANUP_REGISTERED_STATE) === "true") {
    await runActionPost({
      jobStatus: core.getInput(JOB_STATUS_INPUT),
      mainOutcome: core.getState(MAIN_OUTCOME_STATE),
    });
    return;
  }

  core.saveState(POST_CLEANUP_REGISTERED_STATE, "true");
  core.saveState(MAIN_OUTCOME_STATE, "started");

  try {
    await runActionMain();
    core.saveState(MAIN_OUTCOME_STATE, "success");
  } catch (error) {
    core.saveState(MAIN_OUTCOME_STATE, "failure");
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error: unknown) => {
    core.setFailed(toError(error).message);
  });
}
