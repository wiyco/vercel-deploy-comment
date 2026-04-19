# Vercel Deploy Comment Specification

This action deploys one or more Vercel previews, or accepts existing Vercel deployment URLs, and writes one pull request comment containing a deployment table.

## Inputs

| Input | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `github-token` | No | Workflow `GITHUB_TOKEN` through `github.token` | GitHub token used only for REST API calls against pull request comments. Override it when you need a different token. |
| `vercel-token` | Required for `deploy-and-comment` | None | Vercel token used for deploy execution and [Vercel Deployment API](https://vercel.com/docs/rest-api/reference/endpoints/deployments/get-a-deployment-by-id-or-url) enrichment. Optional in `comment-only` mode, but without it the action cannot enrich Vercel deployment metadata. |
| `mode` | No | `deploy-and-comment` | Either `deploy-and-comment` or `comment-only`. |
| `deployments` | Yes | None | JSON array string describing one or more deployments. Every item must include `projectUrl`, and every item renders as one table row. |
| `header` | No | `Vercel Preview Deployment` | Markdown heading text for the pull request comment. |
| `footer` | No | None | Optional Markdown appended after the table. |
| `comment-marker` | No | `default` | Stable marker key used to find and update the existing action comment. The rendered marker is a hidden HTML comment. |
| `status` | No | `success` | Fallback GitHub Actions status for comment-only mode: `success`, `failure`, `cancelled`, or `skipped`. |
| `comment-on-failure` | No | `true` | Whether deploy failures should still update the pull request comment before failing the action. |

Each `deployments` item supports:

- `cwd`: optional working directory for deploy execution.
- `command`: optional string or argv array. Defaults to `["vercel", "deploy", "--prebuilt"]`. The default command expects Vercel build output in `.vercel/output` under `cwd`, normally produced by `vercel build` after `vercel pull` refreshes local project settings and environment variables. Override this with a non-prebuilt deploy command when prebuilt output is not available.
- `deploymentUrl`: optional URL used by comment-only mode or as a precomputed deployment URL.
- `projectName`: optional display name fallback.
- `projectUrl`: required dashboard URL for the Project column. The action does not infer this URL.
- `teamId`: optional Vercel team ID passed to the Deployment API.
- `slug`: optional Vercel team slug passed to the Deployment API.

## Comment Format

The visible comment body closely mirrors Vercel's GitHub Integration preview comment: a heading followed by a deployment table with Project, Deployment, Preview, and Updated columns. The body is:

```markdown
## Vercel Preview Deployment

| Project | Deployment | Preview | Updated (UTC) |
| :--- | :----- | :------ | :------ |
| [vercel-project-name](vercel-project-url) | ✅ [Ready](run-url) | [Preview](vercel-preview-url) | 2026-04-19 00:00:00 UTC |
| [another-vercel-project](another-vercel-project-url) | ⏳ [In Progress](run-url) | [Preview](another-vercel-preview-url) | 2026-04-19 00:00:00 UTC |
```

Each `deployments` item renders as one row, and all rows are kept in the same pull request comment. When `footer` is set, it is appended below the table. The action also appends a hidden marker:

```markdown
<!-- vercel-deploy-comment:default -->
```

The marker, not the heading, is used to find the existing comment. Changing `header` does not create a new comment unless `comment-marker` also changes.

## Data Sources

- `vercel deploy --prebuilt` writes the deployment URL to stdout. The action captures stdout and extracts the last HTTP URL. This command deploys prebuilt output from `.vercel/output`, so workflows using the default command should run `vercel pull` and `vercel build`, or otherwise create equivalent Build Output API files before this action. Deployment creation is delegated to the Vercel CLI; Vercel documents the REST equivalent as [Create a new deployment](https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment).
- The `Updated (UTC)` column uses the timestamp from the current action run and renders it as `YYYY-MM-DD HH:mm:ss UTC`, so it is consistent whether Vercel API enrichment is available or not.
- If `vercel-token` is available, the action calls [`GET /v13/deployments/{idOrUrl}`](https://vercel.com/docs/rest-api/reference/endpoints/deployments/get-a-deployment-by-id-or-url) on the Vercel API to enrich project name, preview URL, and deployment state.
- The run link is built from `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, and `GITHUB_RUN_ID`.
- The pull request number is read from `GITHUB_EVENT_PATH`'s `pull_request.number`. Non-PR events fail.

## Status Mapping

Vercel `readyState` is preferred when available. Otherwise the fallback GitHub Actions status is used.

| Source value | Display |
| :--- | :--- |
| `READY`, `success` | ✅ Ready |
| `ERROR`, `failure` | ❌ Failed |
| `CANCELED`, `cancelled` | 🚫 Cancelled |
| `skipped` | ⏭️ Skipped |
| `BUILDING`, `QUEUED`, `INITIALIZING`, `ANALYZING` | ⏳ In Progress |
| unknown values | ❔ Unknown |

## Security Requirements

- The action never uses shell execution for deploy commands. Commands are parsed into argv and executed directly.
- `github-token` and `vercel-token` are registered with `core.setSecret`.
- Tokens are never included in thrown error messages.
- Markdown cells and link URLs are escaped before rendering.
- `projectUrl` is required because the action does not infer Vercel dashboard URLs.
- Existing comments are updated only when both the hidden marker and authenticated GitHub user match. This avoids editing attacker-created comments that copy the marker.
- If the GitHub token cannot list, create, or update comments, the action fails.
- Fork PRs and Dependabot PRs are expected to fail unless the workflow grants a token with write access. This is intentional.

> [!CAUTION]
>
> Pass Vercel credentials through `vercel-token` instead of embedding `--token=...` in `deployments[].command`. This action masks the `vercel-token` input, but it cannot automatically register unrelated tokens written directly into custom commands.

## Required Workflow Permissions

For the default GitHub token:

```yaml
permissions:
  contents: read
  issues: write
```

`issues: write` is required because the action writes a regular pull request conversation comment through GitHub's Issue comments REST API ([create](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment), [update](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment)). Pull requests are issues for shared features such as comments, labels, and assignees, so issue comment endpoints are used for PR conversation comments.

GitHub documents the issue comment create and update endpoints as accepting either `Issues: write` or `Pull requests: write` repository permissions. `pull-requests: write` may be used by repositories that prefer or require the pull request permission scope.

## Acceptance Criteria

- A first run creates one PR comment.
- Later runs with the same `comment-marker` update that comment.
- Changing `header` updates the same comment.
- Multiple deployments render as multiple table rows.
- Deploy failures update the comment when `comment-on-failure` is `true`, then fail the action.
- The implementation passes typecheck, lint, tests, and coverage.
