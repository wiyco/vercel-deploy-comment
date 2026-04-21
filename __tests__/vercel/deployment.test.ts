import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecFunction } from "../../src/vercel/deployment";
import {
  extractDeploymentUrl,
  getVercelDeploymentDetails,
  getVercelProjectDetails,
  runVercelDeploy,
  toHttpUrl,
} from "../../src/vercel/deployment";

describe("extractDeploymentUrl", () => {
  it("extracts the last URL from stdout", () => {
    expect(
      extractDeploymentUrl(
        "queued https://old.vercel.app\nready https://new.vercel.app\n",
      ),
    ).toBe("https://new.vercel.app");
  });

  it("returns undefined when stdout has no URL", () => {
    expect(extractDeploymentUrl("queued\nready\n")).toBeUndefined();
  });

  it("strips trailing punctuation from the deployment URL", () => {
    expect(extractDeploymentUrl("ready (https://new.vercel.app).")).toBe(
      "https://new.vercel.app",
    );
  });
});

describe("runVercelDeploy", () => {
  it("copies the workspace into an isolated temp directory and runs pull/build/deploy in order", async () => {
    const sourceDirectory = createWorkspace({
      "package.json": '{"name":"web"}\n',
      "src/index.ts": "export const value = 1;\n",
      ".git/config": "[core]\nrepositoryformatversion = 0\n",
      ".vercel/ignored.txt": "do-not-copy\n",
    });
    const calls: Array<{
      cwd?: string;
      command: string;
      args: string[];
      hasExplicitEnv: boolean;
      envToken?: string;
      inheritedEnvValue?: string;
      inputVercelToken?: string;
      inputGitHubToken?: string;
      projectFile: string;
      sourceFileExists: boolean;
      gitFileExists: boolean;
      ignoredFileExists: boolean;
    }> = [];
    const previousVercelToken = process.env.VERCEL_TOKEN;
    const previousInheritedEnv = process.env.CODEX_TEST_INHERITED_ENV;
    const previousInputVercelToken = process.env["INPUT_VERCEL-TOKEN"];
    const previousInputGitHubToken = process.env["INPUT_GITHUB-TOKEN"];
    process.env.VERCEL_TOKEN = "ambient_parent_token";
    process.env.CODEX_TEST_INHERITED_ENV = "inherited";
    process.env["INPUT_VERCEL-TOKEN"] = "input_vercel_token";
    process.env["INPUT_GITHUB-TOKEN"] = "input_github_token";
    const exec: ExecFunction = async (
      command: string,
      args?: string[],
      options?: Parameters<ExecFunction>[2],
    ) => {
      const cwd = options?.cwd;

      calls.push({
        cwd,
        command,
        args: args ?? [],
        hasExplicitEnv: options?.env !== undefined,
        envToken:
          typeof options?.env?.VERCEL_TOKEN === "string"
            ? options.env.VERCEL_TOKEN
            : undefined,
        inheritedEnvValue:
          typeof options?.env?.CODEX_TEST_INHERITED_ENV === "string"
            ? options.env.CODEX_TEST_INHERITED_ENV
            : undefined,
        inputVercelToken:
          typeof options?.env?.["INPUT_VERCEL-TOKEN"] === "string"
            ? options.env["INPUT_VERCEL-TOKEN"]
            : undefined,
        inputGitHubToken:
          typeof options?.env?.["INPUT_GITHUB-TOKEN"] === "string"
            ? options.env["INPUT_GITHUB-TOKEN"]
            : undefined,
        projectFile: readFileSync(
          join(cwd ?? "", ".vercel", "project.json"),
          "utf8",
        ),
        sourceFileExists: existsSync(join(cwd ?? "", "src", "index.ts")),
        gitFileExists: existsSync(join(cwd ?? "", ".git", "config")),
        ignoredFileExists: existsSync(
          join(cwd ?? "", ".vercel", "ignored.txt"),
        ),
      });

      if (args?.[0] === "deploy") {
        options?.listeners?.stdout?.(
          Buffer.from("https://web-git-feature-team.vercel.app\n"),
        );
      }

      return 0;
    };

    try {
      await expect(
        runVercelDeploy({
          deployment: {
            cwd: sourceDirectory,
            orgId: "team_123",
            projectId: "prj_web",
            environment: "preview",
            projectUrl: "https://vercel.com/team/web",
          },
          token: "vercel_token",
          exec,
        }),
      ).resolves.toBe("https://web-git-feature-team.vercel.app");
    } finally {
      if (previousVercelToken === undefined) {
        delete process.env.VERCEL_TOKEN;
      } else {
        process.env.VERCEL_TOKEN = previousVercelToken;
      }

      if (previousInheritedEnv === undefined) {
        delete process.env.CODEX_TEST_INHERITED_ENV;
      } else {
        process.env.CODEX_TEST_INHERITED_ENV = previousInheritedEnv;
      }

      if (previousInputVercelToken === undefined) {
        delete process.env["INPUT_VERCEL-TOKEN"];
      } else {
        process.env["INPUT_VERCEL-TOKEN"] = previousInputVercelToken;
      }

      if (previousInputGitHubToken === undefined) {
        delete process.env["INPUT_GITHUB-TOKEN"];
      } else {
        process.env["INPUT_GITHUB-TOKEN"] = previousInputGitHubToken;
      }
    }

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.args)).toEqual([
      [
        "pull",
        "--yes",
        "--environment",
        "preview",
      ],
      [
        "build",
        "--yes",
      ],
      [
        "deploy",
        "--prebuilt",
      ],
    ]);
    expect(calls.every((call) => call.command === "vercel")).toBe(true);
    expect(calls.map((call) => call.hasExplicitEnv)).toEqual([
      true,
      true,
      true,
    ]);
    expect(calls.map((call) => call.envToken)).toEqual([
      "vercel_token",
      undefined,
      "vercel_token",
    ]);
    expect(calls.map((call) => call.inheritedEnvValue)).toEqual([
      "inherited",
      "inherited",
      "inherited",
    ]);
    expect(calls.map((call) => call.inputVercelToken)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(calls.map((call) => call.inputGitHubToken)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      calls.every((call) =>
        call.args.every((arg) => !arg.includes("vercel_token")),
      ),
    ).toBe(true);
    expect(process.env.VERCEL_TOKEN).toBe(previousVercelToken);
    expect(
      calls.every((call) => call.cwd && call.cwd !== sourceDirectory),
    ).toBe(true);
    expect(calls.every((call) => call.sourceFileExists)).toBe(true);
    expect(calls.every((call) => !call.gitFileExists)).toBe(true);
    expect(calls.every((call) => !call.ignoredFileExists)).toBe(true);
    expect(calls[0]?.projectFile).toContain('"projectId": "prj_web"');
    expect(calls[0]?.projectFile).toContain('"orgId": "team_123"');
  });

  it("uses a fresh temp workspace for each deployment even when cwd is shared", async () => {
    const sourceDirectory = createWorkspace({
      "package.json": '{"name":"shared"}\n',
    });
    const workspaces: string[] = [];
    const projectFiles: string[] = [];
    const exec: ExecFunction = async (
      _command: string,
      args?: string[],
      options?: Parameters<ExecFunction>[2],
    ) => {
      if (args?.[0] === "pull") {
        workspaces.push(options?.cwd ?? "");
        projectFiles.push(
          readFileSync(
            join(options?.cwd ?? "", ".vercel", "project.json"),
            "utf8",
          ),
        );
      }

      if (args?.[0] === "deploy") {
        options?.listeners?.stdout?.(
          Buffer.from(
            `https://${readProjectId(options?.cwd)}-git-feature-team.vercel.app\n`,
          ),
        );
      }

      return 0;
    };

    await runVercelDeploy({
      deployment: {
        cwd: sourceDirectory,
        orgId: "team_123",
        projectId: "prj_one",
        environment: "preview",
        projectUrl: "https://vercel.com/team/one",
      },
      token: "vercel_token",
      exec,
    });
    await runVercelDeploy({
      deployment: {
        cwd: sourceDirectory,
        orgId: "team_456",
        projectId: "prj_two",
        environment: "staging",
        projectUrl: "https://vercel.com/team/two",
      },
      token: "vercel_token",
      exec,
    });

    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]).not.toBe(workspaces[1]);
    expect(projectFiles[0]).toContain('"projectId": "prj_one"');
    expect(projectFiles[1]).toContain('"projectId": "prj_two"');
    expect(projectFiles[0]).toContain('"orgId": "team_123"');
    expect(projectFiles[1]).toContain('"orgId": "team_456"');
  });

  it("throws with a captured deployment URL when deploy fails after printing one", async () => {
    const sourceDirectory = createWorkspace({
      "package.json": '{"name":"web"}\n',
    });
    const exec: ExecFunction = async (
      _command: string,
      args?: string[],
      options?: Parameters<ExecFunction>[2],
    ) => {
      if (args?.[0] === "deploy") {
        options?.listeners?.stdout?.(
          Buffer.from("https://web-git-feature-team.vercel.app\n"),
        );
        return 1;
      }

      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          cwd: sourceDirectory,
          orgId: "team_123",
          projectId: "prj_web",
          environment: "preview",
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toMatchObject({
      name: "VercelDeployError",
      step: "deploy",
      exitCode: 1,
      deploymentUrl: "https://web-git-feature-team.vercel.app",
    });
  });

  it("throws when a successful deploy prints no deployment URL", async () => {
    const sourceDirectory = createWorkspace({
      "package.json": '{"name":"web"}\n',
    });
    const exec: ExecFunction = async () => 0;

    await expect(
      runVercelDeploy({
        deployment: {
          cwd: sourceDirectory,
          orgId: "team_123",
          projectId: "prj_web",
          environment: "preview",
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toThrow("did not print a deployment URL");
  });

  it("does not attach a deployment URL when a non-deploy step fails", async () => {
    const sourceDirectory = createWorkspace({
      "package.json": '{"name":"web"}\n',
    });
    const exec: ExecFunction = async (_command, args) => {
      if (args?.[0] === "build") {
        return 1;
      }

      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          cwd: sourceDirectory,
          orgId: "team_123",
          projectId: "prj_web",
          environment: "preview",
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toMatchObject({
      name: "VercelDeployError",
      step: "build",
      exitCode: 1,
      deploymentUrl: undefined,
    });
  });
});

describe("getVercelProjectDetails", () => {
  it("calls the project API with team query parameters", async () => {
    const calls: URL[] = [];

    const result = await getVercelProjectDetails({
      projectId: "prj_web",
      token: "vercel_token",
      teamId: "team_123",
      slug: "my-team",
      fetch: async (input: string | URL) => {
        const url = input instanceof URL ? input : new URL(input);
        calls.push(url);

        return new Response(
          JSON.stringify({
            id: "prj_web",
            name: "web",
          }),
          {
            status: 200,
          },
        );
      },
    });

    expect(result.name).toBe("web");
    expect(calls[0]?.pathname).toBe("/v9/projects/prj_web");
    expect(calls[0]?.searchParams.get("teamId")).toBe("team_123");
    expect(calls[0]?.searchParams.get("slug")).toBe("my-team");
  });
});

describe("getVercelDeploymentDetails", () => {
  it("calls the deployment API with team query parameters", async () => {
    const calls: URL[] = [];

    const result = await getVercelDeploymentDetails({
      deploymentUrl: "https://web-git-feature-team.vercel.app",
      token: "vercel_token",
      teamId: "team_123",
      slug: "my-team",
      fetch: async (input: string | URL) => {
        const url = input instanceof URL ? input : new URL(input);
        calls.push(url);

        return new Response(
          JSON.stringify({
            name: "web",
            readyState: "READY",
            url: "web-git-feature-team.vercel.app",
            createdAt: 1776556800000,
            project: {
              name: "web",
            },
          }),
          {
            status: 200,
          },
        );
      },
    });

    expect(result.project?.name).toBe("web");
    expect(calls[0]?.pathname).toBe(
      "/v13/deployments/web-git-feature-team.vercel.app",
    );
    expect(calls[0]?.searchParams.get("withGitRepoInfo")).toBe("true");
    expect(calls[0]?.searchParams.get("teamId")).toBe("team_123");
    expect(calls[0]?.searchParams.get("slug")).toBe("my-team");
  });

  it("omits optional team query parameters when they are not provided", async () => {
    const calls: URL[] = [];

    await getVercelDeploymentDetails({
      deploymentUrl: "https://web-git-feature-team.vercel.app",
      token: "vercel_token",
      fetch: async (input: string | URL) => {
        const url = input instanceof URL ? input : new URL(input);
        calls.push(url);

        return new Response(
          JSON.stringify({
            name: "web",
            readyState: "READY",
          }),
          {
            status: 200,
          },
        );
      },
    });

    expect(calls[0]?.searchParams.has("teamId")).toBe(false);
    expect(calls[0]?.searchParams.has("slug")).toBe(false);
  });

  it("throws on failed deployment API responses", async () => {
    await expect(
      getVercelDeploymentDetails({
        deploymentUrl: "https://web-git-feature-team.vercel.app",
        token: "vercel_token",
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "forbidden",
            }),
            {
              status: 403,
              statusText: "Forbidden",
            },
          ),
      }),
    ).rejects.toThrow("Vercel API request failed with status 403 Forbidden");
  });
});

describe("toHttpUrl", () => {
  it("adds https to hostnames", () => {
    expect(toHttpUrl("web.vercel.app")).toBe("https://web.vercel.app/");
  });

  it("preserves existing HTTP URLs", () => {
    expect(toHttpUrl("http://web.vercel.app/path")).toBe(
      "http://web.vercel.app/path",
    );
  });
});

function createWorkspace(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "vercel-deploy-comment-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(directory, relativePath);
    const parent = dirname(absolutePath);

    mkdirSync(parent, {
      recursive: true,
    });
    writeFileSync(absolutePath, content, "utf8");
  }

  return directory;
}

function readProjectId(cwd: string | undefined): string {
  const content = readFileSync(
    join(cwd ?? "", ".vercel", "project.json"),
    "utf8",
  );
  const parsed = JSON.parse(content) as {
    projectId: string;
  };
  return parsed.projectId;
}
