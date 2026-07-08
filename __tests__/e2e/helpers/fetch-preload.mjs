import { readFileSync, writeFileSync } from "node:fs";

const scenario = readJson(process.env.E2E_FETCH_SCENARIO_PATH, {});
const statePath = requireEnv("E2E_FETCH_STATE_PATH");
const viewerLogin = scenario.viewerLogin ?? "github-actions[bot]";
const calls = [];
const comments = (scenario.existingComments ?? []).map((comment) => ({
  ...comment,
  user: comment.user ?? {
    login: viewerLogin,
  },
}));
let nextCommentId = scenario.nextCommentId ?? 1000;

persistState();

globalThis.fetch = async (input, init = {}) => {
  const url = inputToUrl(input);
  const method = (init.method ?? "GET").toUpperCase();
  const body = bodyToString(init.body);

  calls.push({
    body,
    method,
    pathname: url.pathname,
    search: url.search,
    url: url.toString(),
  });
  persistState();

  if (url.hostname === "api.github.test") {
    return handleGitHubRequest(url, method, body);
  }

  if (url.hostname === "api.vercel.com") {
    return handleVercelRequest(url);
  }

  return jsonResponse(
    {
      error: `Unhandled fetch URL: ${url.toString()}`,
    },
    500,
    "Unhandled",
  );
};

function handleGitHubRequest(url, method, body) {
  if (url.pathname === "/graphql" && method === "POST") {
    return jsonResponse({
      data: {
        viewer: {
          login: viewerLogin,
        },
      },
    });
  }

  const issueCommentsMatch = url.pathname.match(
    /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/,
  );

  if (issueCommentsMatch && method === "GET") {
    const perPage = Number(url.searchParams.get("per_page") ?? "100");
    const page = Number(url.searchParams.get("page") ?? "1");
    const start = (page - 1) * perPage;
    return jsonResponse(comments.slice(start, start + perPage));
  }

  if (issueCommentsMatch && method === "POST") {
    const request = JSON.parse(body ?? "{}");
    const id = nextCommentId;
    nextCommentId += 1;

    const comment = {
      body: request.body,
      html_url: `https://github.test/octocat/repo/pull/42#issuecomment-${id}`,
      id,
      user: {
        login: viewerLogin,
      },
    };
    comments.push(comment);
    persistState();
    return jsonResponse(comment, 201, "Created");
  }

  const commentMatch = url.pathname.match(
    /^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/,
  );

  if (commentMatch) {
    const commentId = Number(commentMatch[1]);
    const comment = comments.find((item) => item.id === commentId);

    if (!comment) {
      return jsonResponse(
        {
          message: "Not Found",
        },
        404,
        "Not Found",
      );
    }

    if (method === "GET") {
      return jsonResponse(comment);
    }

    if (method === "PATCH") {
      const request = JSON.parse(body ?? "{}");
      comment.body = request.body;
      persistState();
      return jsonResponse(comment);
    }

    if (method === "DELETE") {
      comments.splice(comments.indexOf(comment), 1);
      persistState();
      return new Response(null, {
        status: 204,
        statusText: "No Content",
      });
    }
  }

  return jsonResponse(
    {
      error: `Unhandled GitHub request: ${method} ${url.pathname}`,
    },
    500,
    "Unhandled",
  );
}

function handleVercelRequest(url) {
  const projectMatch = url.pathname.match(/^\/v9\/projects\/(.+)$/);

  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    return jsonResponse(
      scenario.vercelProjects?.[projectId] ?? {
        id: projectId,
        name: projectId,
      },
    );
  }

  const deploymentMatch = url.pathname.match(/^\/v13\/deployments\/(.+)$/);

  if (deploymentMatch) {
    const idOrHost = decodeURIComponent(deploymentMatch[1]);
    return jsonResponse(
      scenario.vercelDeployments?.[idOrHost] ?? {
        name: idOrHost,
        project: {
          name: idOrHost,
        },
        readyState: "READY",
        url: idOrHost,
      },
    );
  }

  return jsonResponse(
    {
      error: `Unhandled Vercel request: ${url.pathname}`,
    },
    500,
    "Unhandled",
  );
}

function inputToUrl(input) {
  if (typeof input === "string" || input instanceof URL) {
    return new URL(input);
  }

  return new URL(input.url);
}

function bodyToString(body) {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  return String(body);
}

function jsonResponse(body, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
    statusText,
  });
}

function persistState() {
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        calls,
        comments,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function readJson(path, fallback) {
  if (!path) {
    return fallback;
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
