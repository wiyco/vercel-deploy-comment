import { describe, expect, it } from "vitest";
import { buildDeploymentRowKey } from "../../src/shared/deployment-key";

describe("buildDeploymentRowKey", () => {
  it("joins the project id and environment with a NUL separator", () => {
    expect(buildDeploymentRowKey("prj_web", "preview")).toBe(
      "prj_web\u0000preview",
    );
  });

  it("avoids collisions between adjacent project and environment values", () => {
    expect(buildDeploymentRowKey("ab", "c")).not.toBe(
      buildDeploymentRowKey("a", "bc"),
    );
  });
});
