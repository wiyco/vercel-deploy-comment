import * as core from "@actions/core";

const CANCEL_HANDLING_TARGET_STATE = "cancel-handling-target";
const INITIAL_ROWS_PUBLISHED_STATE = "initial-rows-published";
const MAIN_COMPLETED_STATE = "main-completed";

type StateReader = (name: string) => string;

export interface CancelHandlingState {
  cancelHandlingTarget: boolean;
  initialRowsPublished: boolean;
  mainCompleted: boolean;
}

export function saveCancelHandlingTarget(isTarget: boolean): void {
  core.saveState(CANCEL_HANDLING_TARGET_STATE, String(isTarget));
}

export function saveInitialRowsPublished(): void {
  core.saveState(INITIAL_ROWS_PUBLISHED_STATE, "true");
}

export function saveMainCompleted(): void {
  core.saveState(MAIN_COMPLETED_STATE, "true");
}

export function readCancelHandlingState(
  readState: StateReader = core.getState,
): CancelHandlingState {
  return {
    cancelHandlingTarget: readBooleanState(
      readState,
      CANCEL_HANDLING_TARGET_STATE,
    ),
    initialRowsPublished: readBooleanState(
      readState,
      INITIAL_ROWS_PUBLISHED_STATE,
    ),
    mainCompleted: readBooleanState(readState, MAIN_COMPLETED_STATE),
  };
}

function readBooleanState(readState: StateReader, name: string): boolean {
  return readState(name) === "true";
}
