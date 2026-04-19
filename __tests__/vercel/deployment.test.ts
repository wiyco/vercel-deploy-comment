import { describe, expect, it } from "vitest";
import type { ExecFunction } from "../../src/vercel/deployment";
import {
  extractDeploymentUrl,
  getVercelDeploymentDetails,
  parseCommand,
  runVercelDeploy,
  toHttpUrl,
  VercelDeployError,
} from "../../src/vercel/deployment";

describe("parseCommand", () => {
  it("splits command strings without using a shell", () => {
    expect(parseCommand("vercel deploy --prebuilt --scope 'my team'")).toEqual([
      "vercel",
      "deploy",
      "--prebuilt",
      "--scope",
      "my team",
    ]);
  });

  it("handles double quotes, escapes, and trailing backslashes", () => {
    expect(
      parseCommand(
        'vercel deploy "web app" escaped\\ space "quote\\"inside" trailing\\',
      ),
    ).toEqual([
      "vercel",
      "deploy",
      "web app",
      "escaped space",
      'quote"inside',
      "trailing\\",
    ]);
  });

  it("preserves Windows-style path separators in command strings", () => {
    expect(
      parseCommand(
        '"C:\\Program Files\\Vercel\\vercel.cmd" deploy C:\\apps\\web',
      ),
    ).toEqual([
      "C:\\Program Files\\Vercel\\vercel.cmd",
      "deploy",
      "C:\\apps\\web",
    ]);
  });

  it("preserves backslashes inside single-quoted command parts", () => {
    expect(parseCommand("vercel 'C:\\apps\\web'")).toEqual([
      "vercel",
      "C:\\apps\\web",
    ]);
  });

  it("returns valid command arrays", () => {
    expect(
      parseCommand([
        "vercel",
        "deploy",
      ]),
    ).toEqual([
      "vercel",
      "deploy",
    ]);
  });

  it.each([
    [
      "empty arrays",
      [] as string[],
    ],
    [
      "empty array parts",
      [
        "vercel",
        "",
      ],
    ],
    [
      "blank array parts",
      [
        "vercel",
        "   ",
      ],
    ],
    [
      "undefined array parts",
      [
        "vercel",
        undefined,
      ] as unknown as string[],
    ],
    [
      "sparse arrays",
      new Array(1) as string[],
    ],
  ])("rejects %s", (_name, command) => {
    expect(() => parseCommand(command)).toThrow(VercelDeployError);
    expect(() => parseCommand(command)).toThrow("non-empty strings");
  });

  it("rejects blank command strings", () => {
    expect(() => parseCommand("   ")).toThrow("Deploy command is empty");
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCommand("vercel deploy 'broken")).toThrow(
      "unterminated quote",
    );
  });
});

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
  it("appends a token for Vercel invocations and returns stdout URL", async () => {
    const calls: Array<{
      tool: string;
      args: string[];
    }> = [];
    const exec: ExecFunction = async (tool, args, options) => {
      calls.push({
        tool,
        args: args ?? [],
      });
      options?.listeners?.stdout?.(
        Buffer.from("https://web-git-feature-team.vercel.app\n"),
      );
      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).resolves.toBe("https://web-git-feature-team.vercel.app");
    expect(calls[0]).toEqual({
      tool: "vercel",
      args: [
        "deploy",
        "--prebuilt",
        "--token=vercel_token",
      ],
    });
  });

  it("throws with a captured deployment URL when Vercel fails after printing one", async () => {
    const exec: ExecFunction = async (_tool, _args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from("https://web-git-feature-team.vercel.app\n"),
      );
      return 1;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toMatchObject({
      exitCode: 1,
      deploymentUrl: "https://web-git-feature-team.vercel.app",
    });
  });

  it("throws when a successful deploy prints no deployment URL", async () => {
    const exec: ExecFunction = async () => 0;

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toThrow("did not print a deployment URL");
  });

  it("rejects a sparse command array before running it", async () => {
    const command = new Array<string>(1);
    const exec: ExecFunction = async () => {
      throw new Error("exec should not be called");
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
          command,
        },
        token: "vercel_token",
        exec,
      }),
    ).rejects.toThrow("Deploy command array must contain non-empty strings");
  });

  it("does not append a token to non-Vercel commands", async () => {
    const calls: Array<{
      tool: string;
      args: string[];
    }> = [];
    const exec: ExecFunction = async (tool, args, options) => {
      calls.push({
        tool,
        args: args ?? [],
      });
      options?.listeners?.stdout?.(Buffer.from("https://custom.example.com\n"));
      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
          command: "custom-deploy",
        },
        token: "vercel_token",
        exec,
      }),
    ).resolves.toBe("https://custom.example.com");
    expect(calls[0]).toEqual({
      tool: "custom-deploy",
      args: [],
    });
  });

  it.each([
    [
      [
        "vercel",
        "deploy",
        "--token",
        "existing_token",
      ],
      [
        "deploy",
        "--token",
        "existing_token",
      ],
    ],
    [
      [
        "vercel.cmd",
        "deploy",
        "--token=existing_token",
      ],
      [
        "deploy",
        "--token=existing_token",
      ],
    ],
  ])("does not append duplicate tokens to %s", async (command, expectedArgs) => {
    const calls: Array<{
      tool: string;
      args: string[];
    }> = [];
    const exec: ExecFunction = async (tool, args, options) => {
      calls.push({
        tool,
        args: args ?? [],
      });
      options?.listeners?.stdout?.(
        Buffer.from("https://web-git-feature-team.vercel.app\n"),
      );
      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
          command,
        },
        token: "vercel_token",
        exec,
      }),
    ).resolves.toBe("https://web-git-feature-team.vercel.app");
    expect(calls[0]?.args).toEqual(expectedArgs);
  });

  it("appends a token when Vercel is invoked through a package runner", async () => {
    const calls: Array<{
      tool: string;
      args: string[];
    }> = [];
    const exec: ExecFunction = async (tool, args, options) => {
      calls.push({
        tool,
        args: args ?? [],
      });
      options?.listeners?.stdout?.(
        Buffer.from("https://web-git-feature-team.vercel.app\n"),
      );
      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
          command: [
            "pnpm",
            "vercel",
            "deploy",
          ],
        },
        token: "vercel_token",
        exec,
      }),
    ).resolves.toBe("https://web-git-feature-team.vercel.app");
    expect(calls[0]).toEqual({
      tool: "pnpm",
      args: [
        "vercel",
        "deploy",
        "--token=vercel_token",
      ],
    });
  });

  it.each([
    [
      [
        "pnpm",
        "exec",
        "vercel",
        "deploy",
      ],
      [
        "exec",
        "vercel",
        "deploy",
        "--token=vercel_token",
      ],
    ],
    [
      [
        "pnpm",
        "dlx",
        "vercel",
        "deploy",
      ],
      [
        "dlx",
        "vercel",
        "deploy",
        "--token=vercel_token",
      ],
    ],
    [
      [
        "npm",
        "exec",
        "vercel",
        "deploy",
      ],
      [
        "exec",
        "vercel",
        "deploy",
        "--token=vercel_token",
      ],
    ],
  ])("appends a token when Vercel is invoked through %s", async (command, expectedArgs) => {
    const calls: Array<{
      tool: string;
      args: string[];
    }> = [];
    const exec: ExecFunction = async (tool, args, options) => {
      calls.push({
        tool,
        args: args ?? [],
      });
      options?.listeners?.stdout?.(
        Buffer.from("https://web-git-feature-team.vercel.app\n"),
      );
      return 0;
    };

    await expect(
      runVercelDeploy({
        deployment: {
          projectUrl: "https://vercel.com/team/web",
          command,
        },
        token: "vercel_token",
        exec,
      }),
    ).resolves.toBe("https://web-git-feature-team.vercel.app");
    expect(calls[0]?.args).toEqual(expectedArgs);
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
      fetch: async (input) => {
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
      fetch: async (input) => {
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
