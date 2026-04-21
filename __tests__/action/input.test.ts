import { describe, expect, it } from "vitest";
import {
  InputError,
  parseActionInputs,
  type RawActionInputs,
  readActionInputs,
} from "../../src/action/input";

const validDeployAndCommentDeployment = {
  cwd: "apps/web",
  orgId: "team_123",
  projectId: "prj_web",
  environment: "preview",
  projectUrl: "https://vercel.com/team/web",
};

const validCommentOnlyDeployment = {
  projectId: "prj_web",
  environment: "preview",
  projectUrl: "https://vercel.com/team/web",
  deploymentUrl: "https://web-git-feature-team.vercel.app",
};

function validRawInputs(
  overrides: Partial<RawActionInputs> = {},
): RawActionInputs {
  return {
    githubToken: "ghs_token",
    vercelToken: "vercel_token",
    mode: "deploy-and-comment",
    deployments: JSON.stringify([
      validDeployAndCommentDeployment,
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
    expect(inputs.deployments[0]).toMatchObject({
      cwd: "apps/web",
      orgId: "team_123",
      projectId: "prj_web",
      environment: "preview",
      projectUrl: "https://vercel.com/team/web",
    });
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
          deployments: JSON.stringify([
            {
              ...validCommentOnlyDeployment,
              deploymentUrl: undefined,
            },
          ]),
        }),
      ),
    ).toThrow("deploymentUrl is required");
  });

  it("requires cwd and orgId in deploy-and-comment mode", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              cwd: undefined,
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].cwd is required");
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              orgId: undefined,
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].orgId is required");
  });

  it.each([
    [
      "cwd",
      {
        cwd: 123,
      },
      "deployments[0].cwd must be a string",
    ],
    [
      "orgId",
      {
        orgId: 123,
      },
      "deployments[0].orgId must be a string",
    ],
    [
      "projectId",
      {
        projectId: 123,
      },
      "deployments[0].projectId must be a string",
    ],
    [
      "environment",
      {
        environment: 123,
      },
      "deployments[0].environment must be a string",
    ],
  ])("rejects non-string %s values in deploy-and-comment deployments", (_field, overrides, message) => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              ...overrides,
            },
          ]),
        }),
      ),
    ).toThrow(message);
  });

  it("accepts an optional deploymentUrl in deploy-and-comment mode", () => {
    const inputs = parseActionInputs(
      validRawInputs({
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            deploymentUrl: "https://web-git-feature-team.vercel.app",
          },
        ]),
      }),
    );

    expect(inputs.mode).toBe("deploy-and-comment");
    expect(inputs.deployments[0]).toMatchObject({
      deploymentUrl: "https://web-git-feature-team.vercel.app/",
    });
  });

  it("rejects non-string optional deploymentUrl values in deploy-and-comment mode", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              deploymentUrl: 123,
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].deploymentUrl must be a URL string");
  });

  it("rejects non-https optional deploymentUrl values in deploy-and-comment mode", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              deploymentUrl: "http://web-git-feature-team.vercel.app",
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].deploymentUrl must be a valid https URL");
  });

  it("rejects deprecated command and projectName fields", () => {
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              command: "vercel deploy",
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].command is no longer supported");
    expect(() =>
      parseActionInputs(
        validRawInputs({
          deployments: JSON.stringify([
            {
              ...validDeployAndCommentDeployment,
              projectName: "web",
            },
          ]),
        }),
      ),
    ).toThrow("deployments[0].projectName is no longer supported");
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

  it.each([
    [
      "github-token",
      {
        githubToken: 123 as unknown as string,
      },
      "github-token must be a string",
    ],
    [
      "vercel-token",
      {
        vercelToken: 123 as unknown as string,
      },
      "vercel-token must be a string",
    ],
    [
      "deployments",
      {
        deployments: 123 as unknown as string,
      },
      "deployments must be a string",
    ],
    [
      "header",
      {
        header: 123 as unknown as string,
      },
      "header must be a string",
    ],
    [
      "footer",
      {
        footer: 123 as unknown as string,
      },
      "footer must be a string",
    ],
    [
      "comment-marker",
      {
        commentMarker: 123 as unknown as string,
      },
      "comment-marker must be a string",
    ],
    [
      "mode",
      {
        mode: 123 as unknown as string,
      },
      "mode must be a string",
    ],
    [
      "status",
      {
        status: 123 as unknown as string,
      },
      "status must be a string",
    ],
    [
      "comment-on-failure",
      {
        commentOnFailure: 123 as unknown as string,
      },
      "comment-on-failure must be a string",
    ],
  ])("rejects non-string %s values", (_field, overrides, message) => {
    expect(() => parseActionInputs(validRawInputs(overrides))).toThrow(message);
  });

  it("normalizes optional fields for comment-only inputs", () => {
    const inputs = parseActionInputs(
      validRawInputs({
        vercelToken: " ",
        mode: "comment-only",
        deployments: JSON.stringify([
          {
            projectId: " prj_web ",
            environment: " staging ",
            projectUrl: "https://vercel.com/team/web",
            deploymentUrl: "https://web-git-feature-team.vercel.app",
            cwd: " apps/web ",
            orgId: " org_123 ",
            displayName: " web ",
            teamId: " team_123 ",
            slug: " my-team ",
          },
          {
            ...validCommentOnlyDeployment,
            displayName: " ",
            cwd: " ",
            orgId: "",
            teamId: null,
            slug: "",
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
      deploymentUrl: "https://web-git-feature-team.vercel.app/",
      displayName: "web",
      environment: "staging",
      projectId: "prj_web",
      projectUrl: "https://vercel.com/team/web",
      teamId: "team_123",
      slug: "my-team",
    });
    expect(inputs.deployments[1]).toMatchObject({
      deploymentUrl: "https://web-git-feature-team.vercel.app/",
      displayName: undefined,
      teamId: undefined,
      slug: undefined,
    });
  });

  it.each([
    [
      "deploy-and-comment",
      validRawInputs({
        deployments: JSON.stringify([
          validDeployAndCommentDeployment,
          {
            ...validDeployAndCommentDeployment,
            cwd: "apps/admin",
            deploymentUrl: "https://web-duplicate.vercel.app",
            orgId: "team_456",
          },
        ]),
      }),
    ],
    [
      "comment-only",
      validRawInputs({
        mode: "comment-only",
        deployments: JSON.stringify([
          validCommentOnlyDeployment,
          {
            ...validCommentOnlyDeployment,
            deploymentUrl: "https://web-duplicate.vercel.app",
          },
        ]),
      }),
    ],
  ])("rejects duplicate deployment keys in %s mode", (_name, rawInputs) => {
    expect(() => parseActionInputs(rawInputs)).toThrow(
      'deployments[1] duplicates deployments[0] for projectId "prj_web" and environment "preview". Each (projectId, environment) pair must be unique.',
    );
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
          ...validDeployAndCommentDeployment,
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
            ...validDeployAndCommentDeployment,
            cwd: 123,
          },
        ]),
      },
      "deployments[0].cwd must be a string",
    ],
    [
      "non-string deployment URLs",
      {
        mode: "comment-only",
        deployments: JSON.stringify([
          {
            ...validCommentOnlyDeployment,
            deploymentUrl: 123,
          },
        ]),
      },
      "deployments[0].deploymentUrl must be a URL string",
    ],
    [
      "non-https deployment URL protocols",
      {
        mode: "comment-only",
        deployments: JSON.stringify([
          {
            ...validCommentOnlyDeployment,
            deploymentUrl: "http://example.com/preview",
          },
        ]),
      },
      "deployments[0].deploymentUrl must be a valid https URL",
    ],
    [
      "invalid deployment URL protocols",
      {
        mode: "comment-only",
        deployments: JSON.stringify([
          {
            ...validCommentOnlyDeployment,
            deploymentUrl: "ftp://example.com/preview",
          },
        ]),
      },
      "deployments[0].deploymentUrl must be a valid https URL",
    ],
    [
      "non-https project URL protocols",
      {
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            projectUrl: "http://example.com/project",
          },
        ]),
      },
      "deployments[0].projectUrl must be a valid https URL",
    ],
    [
      "invalid project URL protocols",
      {
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            projectUrl: "ftp://example.com/project",
          },
        ]),
      },
      "deployments[0].projectUrl must be a valid https URL",
    ],
    [
      "missing projectId",
      {
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            projectId: "",
          },
        ]),
      },
      "deployments[0].projectId is required",
    ],
    [
      "missing environment",
      {
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            environment: "",
          },
        ]),
      },
      "deployments[0].environment is required",
    ],
    [
      "invalid displayName",
      {
        deployments: JSON.stringify([
          {
            ...validDeployAndCommentDeployment,
            displayName: 123,
          },
        ]),
      },
      "deployments[0].displayName must be a string",
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
        validDeployAndCommentDeployment,
      ]),
    };

    const inputs = readActionInputs({
      getInput: (name: string, options?: unknown) => {
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
          validCommentOnlyDeployment,
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
