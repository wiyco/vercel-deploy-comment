import { describe, expect, it } from "vitest";
import {
  InputError,
  parseActionInputs,
  type RawActionInputs,
  readActionInputs,
} from "../../src/action/input";

const validDeployment = {
  projectName: "web",
  projectUrl: "https://vercel.com/team/web",
};

function validRawInputs(
  overrides: Partial<RawActionInputs> = {},
): RawActionInputs {
  return {
    githubToken: "ghs_token",
    vercelToken: "vercel_token",
    mode: "deploy-and-comment",
    deployments: JSON.stringify([
      validDeployment,
    ]),
    header: "Preview",
    footer: "footer",
    commentMarker: "default",
    status: "success",
    commentOnFailure: "true",
    ...overrides,
  };
}

function withInputEnv<T>(env: Record<string, string>, callback: () => T): T {
  const previous = new Map(
    Object.keys(env).map((key) => [
      key,
      process.env[key],
    ]),
  );

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("parseActionInputs", () => {
  it("parses deploy-and-comment inputs", () => {
    const inputs = parseActionInputs(
      validRawInputs({
        commentMarker: "preview:web",
      }),
    );

    expect(inputs.mode).toBe("deploy-and-comment");
    expect(inputs.deployments).toHaveLength(1);
    expect(inputs.deployments[0]?.projectUrl).toBe(
      "https://vercel.com/team/web",
    );
    expect(inputs.commentMarker).toBe("preview:web");
    expect(inputs.commentOnFailure).toBe(true);
  });

  it("requires vercel-token in deploy-and-comment mode", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          vercelToken: undefined,
        }),
      ),
    ).toThrow(InputError);
  });

  it("requires deploymentUrl in comment-only mode", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          mode: "comment-only",
        }),
      ),
    ).toThrow("deploymentUrl is required");
  });

  it("rejects unsafe comment markers", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          commentMarker: "bad marker",
        }),
      ),
    ).toThrow("comment-marker");
  });

  it("rejects deployments without projectUrl", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              projectName: "web",
            },
          ]),
        }),
      ),
    ).toThrow("projectUrl");
  });

  it("normalizes optional fields for comment-only inputs", () => {
    const inputs = parseActionInputs(
      validRawInputs({
        vercelToken: " ",
        mode: "comment-only",
        deployments: JSON.stringify([
          {
            projectUrl: "http://vercel.com/team/web",
            deploymentUrl: "https://web-git-feature-team.vercel.app",
            cwd: " apps/web ",
            projectName: " web ",
            teamId: " team_123 ",
            slug: " my-team ",
            command: [
              " pnpm ",
              " deploy ",
            ],
          },
          {
            projectUrl: "https://vercel.com/team/admin",
            deploymentUrl: "https://admin-git-feature-team.vercel.app",
            cwd: " ",
            projectName: "",
            teamId: null,
            slug: "",
            command: " vercel deploy --prebuilt ",
          },
        ]),
        header: "Preview\nDeployments",
        footer: " ",
        status: "failure",
        commentOnFailure: " false ",
      }),
    );

    expect(inputs.vercelToken).toBeUndefined();
    expect(inputs.header).toBe("Preview Deployments");
    expect(inputs.footer).toBeUndefined();
    expect(inputs.status).toBe("failure");
    expect(inputs.commentOnFailure).toBe(false);
    expect(inputs.deployments[0]).toEqual({
      command: [
        "pnpm",
        "deploy",
      ],
      cwd: "apps/web",
      deploymentUrl: "https://web-git-feature-team.vercel.app/",
      projectName: "web",
      projectUrl: "http://vercel.com/team/web",
      teamId: "team_123",
      slug: "my-team",
    });
    expect(inputs.deployments[1]).toMatchObject({
      command: "vercel deploy --prebuilt",
      deploymentUrl: "https://admin-git-feature-team.vercel.app/",
      projectName: undefined,
      cwd: undefined,
      teamId: undefined,
      slug: undefined,
    });
  });

  it.each([
    [
      "invalid JSON",
      {
        deployments: "{",
      },
      "deployments must be valid JSON",
    ],
    [
      "non-array deployments",
      {
        deployments: JSON.stringify({
          projectUrl: "https://vercel.com/team/web",
        }),
      },
      "deployments must be a non-empty JSON array",
    ],
    [
      "empty deployments",
      {
        deployments: JSON.stringify([]),
      },
      "deployments must be a non-empty JSON array",
    ],
    [
      "non-object deployment entries",
      {
        deployments: JSON.stringify([
          null,
        ]),
      },
      "deployments[0] must be an object",
    ],
    [
      "non-string cwd",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            cwd: 123,
          },
        ]),
      },
      "deployments[0].cwd must be a string",
    ],
    [
      "non-string deployment URLs",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            deploymentUrl: 123,
          },
        ]),
      },
      "deployments[0].deploymentUrl must be a URL string",
    ],
    [
      "invalid deployment URL protocols",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            deploymentUrl: "ftp://example.com/preview",
          },
        ]),
      },
      "deployments[0].deploymentUrl must be a valid http or https URL",
    ],
    [
      "invalid project URL protocols",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            projectUrl: "ftp://example.com/project",
          },
        ]),
      },
      "deployments[0].projectUrl must be a valid http or https URL",
    ],
    [
      "invalid command types",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            command: 123,
          },
        ]),
      },
      "deployments[0].command must be a string or string array",
    ],
    [
      "empty command arrays",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            command: [],
          },
        ]),
      },
      "deployments[0].command must not be an empty array",
    ],
    [
      "empty command array entries",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            command: [
              "pnpm",
              "",
            ],
          },
        ]),
      },
      "deployments[0].command[1] must be a non-empty string",
    ],
    [
      "blank command array entries",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            command: [
              "pnpm",
              "   ",
            ],
          },
        ]),
      },
      "deployments[0].command[1] must be a non-empty string",
    ],
    [
      "non-string command array entries",
      {
        deployments: JSON.stringify([
          {
            ...validDeployment,
            command: [
              "pnpm",
              123,
            ],
          },
        ]),
      },
      "deployments[0].command[1] must be a non-empty string",
    ],
    [
      "invalid modes",
      {
        mode: "preview",
      },
      "mode must be one of",
    ],
    [
      "invalid statuses",
      {
        status: "pending",
      },
      "status must be one of",
    ],
    [
      "invalid booleans",
      {
        commentOnFailure: "yes",
      },
      "comment-on-failure must be true or false",
    ],
    [
      "blank github tokens",
      {
        githubToken: " ",
      },
      "github-token is required",
    ],
    [
      "non-string github tokens",
      {
        githubToken: undefined as unknown as string,
      },
      "github-token is required",
    ],
  ])("rejects %s", (_name, overrides, message) => {
    expect(() => parseActionInputs(validRawInputs(overrides))).toThrow(message);
  });

  it("formats unknown URL parser failures defensively", () => {
    const OriginalUrl = globalThis.URL;
    const throwNonError = (): never => {
      throw Object.assign(Object.create(null), {
        reason: "not-an-error",
      });
    };

    function ThrowingUrl() {
      throwNonError();
    }

    globalThis.URL = ThrowingUrl as unknown as typeof URL;

    try {
      expect(() => parseActionInputs(validRawInputs())).toThrow(
        "unknown error",
      );
    } finally {
      globalThis.URL = OriginalUrl;
    }
  });
});

describe("readActionInputs", () => {
  it("applies default values when optional action inputs are blank", () => {
    const requests: Array<{
      name: string;
      options?: unknown;
    }> = [];
    const values: Record<string, string> = {
      "github-token": "ghs_token",
      "vercel-token": "vercel_token",
      deployments: JSON.stringify([
        validDeployment,
      ]),
    };

    const inputs = readActionInputs({
      getInput: (name, options) => {
        requests.push({
          name,
          options,
        });
        return values[name] ?? "";
      },
    });

    expect(inputs).toMatchObject({
      mode: "deploy-and-comment",
      header: "Vercel Preview Deployment",
      commentMarker: "default",
      status: "success",
      commentOnFailure: true,
    });
    expect(requests).toContainEqual({
      name: "github-token",
      options: undefined,
    });
    expect(requests).toContainEqual({
      name: "deployments",
      options: {
        required: true,
      },
    });
    expect(requests).toContainEqual({
      name: "footer",
      options: {
        trimWhitespace: false,
      },
    });
  });

  it("reads explicit values through the default actions core reader", () => {
    const inputs = withInputEnv(
      {
        "INPUT_GITHUB-TOKEN": "ghs_token",
        INPUT_MODE: "comment-only",
        INPUT_DEPLOYMENTS: JSON.stringify([
          {
            ...validDeployment,
            deploymentUrl: "https://web-git-feature-team.vercel.app",
          },
        ]),
        INPUT_HEADER: "Core Preview",
        INPUT_FOOTER: "Core Footer",
        "INPUT_COMMENT-MARKER": "core:preview",
        INPUT_STATUS: "skipped",
        "INPUT_COMMENT-ON-FAILURE": "FALSE",
      },
      () => readActionInputs(),
    );

    expect(inputs).toMatchObject({
      githubToken: "ghs_token",
      vercelToken: undefined,
      mode: "comment-only",
      header: "Core Preview",
      footer: "Core Footer",
      commentMarker: "core:preview",
      status: "skipped",
      commentOnFailure: false,
    });
  });
});
