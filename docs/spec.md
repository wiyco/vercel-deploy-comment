# Vercel Deploy Comment Specification

This action deploys one or more Vercel projects, or accepts existing deployment URLs, and maintains one shared pull request comment containing a deployment table.

## Public API

### Top-level Inputs

| Input | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `github-token` | No | Workflow `GITHUB_TOKEN` through `github.token` | GitHub token used only for REST API calls against pull request comments. |
| `vercel-token` | Required for `deploy-and-comment` | None | Vercel token used for isolated CLI execution and Vercel API enrichment. Optional in `comment-only`. |
| `mode` | No | `deploy-and-comment` | Either `deploy-and-comment` or `comment-only`. |
| `deployments` | Yes | None | Non-empty JSON array describing one or more project-driven deployment entries. |
| `header` | No | `Vercel Preview Deployment` | Markdown heading text for the pull request comment. |
| `footer` | No | None | Optional Markdown appended after the table. |
| `comment-marker` | No | `default` | Stable marker key used to find and update the managed PR comment. |
| `status` | No | `success` | Fallback GitHub Actions status when Vercel deployment details are unavailable. |
| `comment-on-failure` | No | `true` | Whether deploy failures still upsert the affected rows before the action fails. |

### `deploy-and-comment` Entries

Required fields:

- `cwd: string`
- `projectId: string`
- `orgId: string`
- `environment: string`
- `projectUrl: string` as an absolute `https://` URL

Optional fields:

- `deploymentUrl: string` as an absolute `https://` URL
- `displayName: string`
- `teamId: string`
- `slug: string`

Removed fields:

- `command`
- `projectName`

The action owns the full `pull -> build -> deploy` lifecycle. Prebuilt output is no longer expected as an external prerequisite.

### `comment-only` Entries

Required fields:

- `projectId: string`
- `environment: string`
- `projectUrl: string` as an absolute `https://` URL
- `deploymentUrl: string` as an absolute `https://` URL

Optional fields:

- `displayName: string`
- `teamId: string`
- `slug: string`

## Runtime Design

### Deploy Execution

`deploy-and-comment` requires the Vercel CLI to already be installed and available on `PATH` as `vercel`. The action shells out to the CLI and does not vendor or download the `vercel` package. `comment-only` does not require the CLI.

For each `deploy-and-comment` entry, the action creates an isolated temporary workspace:

1. Copy the contents of `cwd` into a temp directory, excluding repo-local `.git` and `.vercel`.
2. Do not reuse the repository's existing `.vercel` directory.
3. Write `temp/.vercel/project.json` with:

```json
{
  "projectId": "prj_xxx",
  "orgId": "team_xxx"
}
```

4. Run these Vercel CLI commands inside the temp workspace:

```text
vercel pull --yes --environment <environment>
vercel build --yes
vercel deploy --prebuilt
```

5. Build an explicit child-process environment for every Vercel CLI invocation, remove GitHub Actions `INPUT_*` variables, and attach the input token to authenticated CLI invocations through `VERCEL_TOKEN`, not command-line arguments.
6. Preserve other caller-provided environment variables. This action does not attempt to scrub arbitrary non-`INPUT_*` secrets exported by the workflow.

This design makes same-`cwd`, multi-project and multi-environment deployments safe because local `.vercel` state is not shared between rows.

### Metadata Resolution

Project display names are resolved in this order:

1. `displayName`
2. Vercel project API name
3. Vercel deployment details `project.name`
4. Vercel deployment details `name`
5. `projectId`

Preview URL and deployment status are resolved from the deployment URL plus Vercel deployment details when available.

### External API Usage

GitHub REST API:

- `GET /user` to resolve the authenticated login used to identify the managed comment. See [Get the authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).
- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` to scan pull request conversation comments for the existing managed comment. See [List issue comments](https://docs.github.com/en/rest/issues/comments#list-issue-comments).
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` to create the managed pull request comment. See [Create an issue comment](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).
- `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` to update the managed pull request comment. See [Update an issue comment](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment).

Vercel REST API:

- `GET /v9/projects/{projectId}` to resolve the project display name. See [Find a project by id or name](https://vercel.com/docs/rest-api/reference/endpoints/projects/find-a-project-by-id-or-name).
- `GET /v13/deployments/{idOrUrl}` to resolve preview URL and deployment status details. See [Get a deployment by ID or URL](https://vercel.com/docs/rest-api/reference/endpoints/deployments/get-a-deployment-by-id-or-url).

Vercel REST requests accept optional `teamId` and `slug` query parameters.

## Comment Model

### Row Identity

Each visible row is keyed by:

- `projectId + environment`

`projectId` alone is not sufficient.

### Hidden Markers

The comment stores:

- One full-comment marker:

```markdown
<!-- vercel-deploy-comment:default -->
```

- One per-row marker embedded in the Project cell:

```markdown
<!-- vercel-deploy-comment:row:<encoded-projectId>:<encoded-environment> -->
```

The row marker uses percent-encoded `projectId` and `environment` values so the string stays stable and parseable.

### Update Algorithm

When updating the PR comment, the action:

1. Finds the existing managed comment through the full-comment marker and authenticated GitHub user.
2. Parses existing row markers and row contents from that comment.
3. Replaces or inserts only the rows named in the current `deployments` input.
4. Preserves unrelated existing rows from the fetched comment snapshot.
5. Re-renders the entire comment body in one PATCH request.

### Concurrency

- The managed comment update flow is a single read-modify-write cycle against the full comment body.
- Concurrent jobs or workflow runs that share the same `comment-marker` are not safe. Two writers can both merge against stale snapshots, and the later PATCH can overwrite rows added by the earlier PATCH.
- This action does not provide optimistic locking for comment updates. If multiple jobs need to contribute to one shared comment, serialize updates for that `comment-marker`, for example with `needs`, workflow or job `concurrency`, or a final aggregator job.

### Ordering

- Rows present in the current `deployments` input render in input order.
- Existing rows not present in the current input keep their existing relative order and remain after the current-input rows.

### Table Columns

Base table:

| Project | Status | Preview | Updated (UTC) |
| :--- | :--- | :--- | :--- |

If at least one row uses a custom environment outside `preview`, `production`, or `development`, the action renders:

| Project | Environment | Status | Preview | Updated (UTC) |
| :--- | :--- | :--- | :--- | :--- |

The `Status` cell renders an emoji followed by the linked label, such as `✅ [Ready](https://github.com/my-org/my-repo/actions/runs/1234567890)`.

## Data Sources

- The deployment URL is extracted from `vercel deploy --prebuilt` stdout.
- `Updated (UTC)` uses the current action-run timestamp rendered as `YYYY-MM-DD HH:mm:ss UTC`.
- The run link is built from `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, and `GITHUB_RUN_ID`.
- The pull request number is read from `GITHUB_EVENT_PATH` at `pull_request.number`.
- Non-PR events fail.

## Status Mapping

Vercel `readyState` is preferred when available. Otherwise the fallback GitHub Actions status is used.

| Source value | Display |
| :--- | :--- |
| `READY`, `success` | `✅ Ready` |
| `ERROR`, `failure` | `❌ Failed` |
| `CANCELED`, `cancelled` | `🚫 Cancelled` |
| `skipped` | `⏭️ Skipped` |
| `BUILDING`, `QUEUED`, `INITIALIZING`, `ANALYZING` | `⏳ In Progress` |
| unknown values | `❔ Unknown` |

## Failure Behavior

- If `pull`, `build`, or `deploy` fails and `comment-on-failure` is `true`, the action still upserts the affected row with failure status, then fails the action.
- If `comment-on-failure` is `false`, the action fails immediately without updating the comment.
- Vercel API enrichment failures do not block comment updates.

## Security Requirements

- The action does not execute arbitrary user-provided shell commands.
- `github-token` and `vercel-token` are registered with `core.setSecret`.
- Vercel CLI child processes do not inherit GitHub Actions `INPUT_*` variables; `VERCEL_TOKEN` is attached only to authenticated Vercel steps.
- Workflow-managed secrets exported through other environment variables remain visible to child processes unless the workflow scopes them more narrowly.
- Tokens are stripped from warning and terminal failure messages before logging.
- Markdown cells and link URLs are escaped before rendering.
- Existing comments are updated only when both the full hidden marker and authenticated GitHub user match.
- `projectUrl` is required and `projectUrl` / `deploymentUrl` must use `https`; the action does not infer dashboard URLs.
- Fork PRs and Dependabot PRs are expected to fail unless the workflow grants a token with write access.

## Required Workflow Permissions

For the default GitHub token:

```yaml
permissions:
  contents: read
  issues: write
```

`issues: write` is required because pull request conversation comments are written through GitHub's Issue comments REST API. See [External API Usage](#external-api-usage) for the exact endpoints. `pull-requests: write` is also acceptable.

## Acceptance Criteria

- A first run creates one PR comment.
- Later runs with the same `comment-marker` update that comment.
- Serialized jobs and workflow runs with the same `comment-marker` can add or replace independent rows in that same comment.
- Same-`cwd` multi-project deployments do not share `.vercel/project.json`.
- Custom environments trigger the `Environment` column for all rows.
- Deploy failures can still update the comment when `comment-on-failure` is `true`.
- The implementation passes typecheck, lint, tests, and build.
