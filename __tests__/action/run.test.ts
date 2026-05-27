import { describe, expect, it } from "vitest";
import {
  getDeploymentUrlFromError,
  getProjectName,
} from "../../src/action/run";

describe("getDeploymentUrlFromError", () => {
  it("returns an attached deployment URL string", () => {
    expect(
      getDeploymentUrlFromError(
        Object.assign(new Error("deploy failed"), {
          deploymentUrl: "https://captured-git-feature-team.vercel.app",
        }),
      ),
    ).toBe("https://captured-git-feature-team.vercel.app");
  });

  it("ignores attached deployment URLs that are not strings", () => {
    expect(
      getDeploymentUrlFromError(
        Object.assign(new Error("deploy failed"), {
          deploymentUrl: 42,
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the error has no deployment URL", () => {
    expect(
      getDeploymentUrlFromError(new Error("deploy failed")),
    ).toBeUndefined();
  });
});

describe("getProjectName", () => {
  it("prefers an explicit display name", () => {
    expect(
      getProjectName(
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
          displayName: "Web App",
        },
        {
          name: "api-name",
        },
        {
          name: "deployment-name",
          project: {
            name: "project-name",
          },
        },
      ),
    ).toBe("Web App");
  });

  it("falls back to the project API name", () => {
    expect(
      getProjectName(
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
        {
          name: "api-name",
        },
        {
          name: "deployment-name",
          project: {
            name: "project-name",
          },
        },
      ),
    ).toBe("api-name");
  });

  it("falls back to the deployment project name", () => {
    expect(
      getProjectName(
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
        undefined,
        {
          project: {
            name: "project-name",
          },
        },
      ),
    ).toBe("project-name");
  });

  it("falls back to the deployment name before the project id", () => {
    expect(
      getProjectName(
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
        undefined,
        {
          name: "deployment-name",
        },
      ),
    ).toBe("deployment-name");
  });

  it("falls back to the project id when no metadata provides a name", () => {
    expect(
      getProjectName(
        {
          environment: "preview",
          projectId: "prj_web",
          projectUrl: "https://vercel.com/team/web",
        },
        undefined,
        undefined,
      ),
    ).toBe("prj_web");
  });
});
