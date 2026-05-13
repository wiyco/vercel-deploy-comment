# Vercel Deploy Comment

[![Coverage](docs/assets/coverage.svg)](docs/assets/coverage.svg)
[![Code to Test Ratio](docs/assets/code-to-test-ratio.svg)](docs/assets/code-to-test-ratio.svg)

Deploy one or more Vercel projects and environments from GitHub Actions and keep a single pull request comment updated.

This action is project-driven:

- `deploy-and-comment` takes `cwd`, `projectId`, `orgId`, `environment`, and `projectUrl`.
- `comment-only` takes `projectId`, `environment`, `projectUrl`, and `deploymentUrl`.
- Each row is keyed by `projectId + environment`, so serialized updates with one shared `comment-marker` can replace targeted rows while preserving unrelated rows.

> [!IMPORTANT]
>
> `projectUrl` and `deploymentUrl` must be absolute `https://` URLs.

The rendered comment looks like this:

| Project | Environment | Status | Preview | Updated (UTC) |
| :--- | :--- | :--- | :--- | :--- |
| [web](https://vercel.com/my-team/web) | preview | ✅ [Ready](https://github.com/my-org/my-repo/actions/runs/1234567890) | [Preview](https://web-git-feature-my-team.vercel.app) | 2026-04-19 00:00:00 UTC |
| [admin](https://vercel.com/my-team/admin) | staging | ✅ [Ready](https://github.com/my-org/my-repo/actions/runs/1234567890) | [Preview](https://admin-git-feature-my-team.vercel.app) | 2026-04-19 00:01:00 UTC |

The `Environment` column is shown only when at least one row uses a custom environment outside `preview`, `production`, or `development`.
Status cells render an emoji plus the linked status label, for example `✅ [Ready](https://github.com/my-org/my-repo/actions/runs/1234567890)`.

## Usage

```yaml
name: Preview

on:
  pull_request:

permissions:
  contents: read
  issues: write # or pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - run: npm install --global vercel@latest
      - uses: wiyco/vercel-deploy-comment@v2 # or pin to a specific commit SHA
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          deployments: |
            [
              {
                "cwd": ".",
                "projectId": "prj-web",
                "orgId": "team_123",
                "environment": "preview",
                "projectUrl": "https://vercel.com/my-team/web"
              },
              {
                "cwd": ".",
                "projectId": "prj-web-staging",
                "orgId": "team_123",
                "environment": "staging",
                "projectUrl": "https://vercel.com/my-team/web-staging"
              },
              {
                "cwd": "admin",
                "projectId": "prj-admin",
                "orgId": "team_123",
                "environment": "preview",
                "projectUrl": "https://vercel.com/my-team/admin"
              }
            ]
```

`deploy-and-comment` requires the Vercel CLI to already be installed and available on `PATH` as `vercel`. This action shells out to the CLI and does not bundle it. `comment-only` does not require the CLI.

> [!IMPORTANT]
> Jobs or workflow runs that share the same `comment-marker` should update the managed comment serially. Parallel writers are last-writer-wins and can drop rows. See [docs/spec.md#concurrency](docs/spec.md#concurrency).

> [!CAUTION]
>
> Pass Vercel credentials through `vercel-token`. This action strips GitHub Actions `INPUT_*` variables from Vercel CLI child processes and injects the token into authenticated steps through `VERCEL_TOKEN`, but it does not remove unrelated secrets that your workflow exports through other environment variables. Do not embed tokens in deployment JSON or other workflow commands.

For each `deploy-and-comment` entry, the action:

1. Copies `cwd` into an isolated temporary workspace, excluding repo-local `.git` and `.vercel`.
2. Writes `.vercel/project.json` from `projectId` and `orgId`.
3. Runs `vercel pull --yes --environment <environment>`.
4. Runs `vercel build --yes`.
5. Runs `vercel deploy --prebuilt`.

This avoids sharing repo-local `.vercel` state across multiple projects or environments, including multiple rows that point at the same source `cwd`.
The action strips GitHub Actions `INPUT_*` variables from all Vercel CLI child processes and passes `vercel-token` to authenticated steps through `VERCEL_TOKEN`, so action input secrets do not appear in command-line arguments or in the local build step's environment. Other workflow-managed secrets still remain visible to `vercel build` if the workflow exports them through non-`INPUT_*` environment variables.

## Inputs

Top-level inputs:

| Input | Required | Description | Default |
| :--- | :--- | :--- | :--- |
| `github-token` | No | GitHub token for PR comment APIs. | `github.token` |
| `vercel-token` | `deploy-and-comment` only | Vercel token for CLI execution and API enrichment. | - |
| `mode` | No | Selects `deploy-and-comment` or `comment-only`. | `deploy-and-comment` |
| `deployments` | Yes | Non-empty JSON array of deployment entries. | - |
| `header` | No | Markdown heading text shown above the table. | `Vercel Preview Deployment` |
| `footer` | No | Optional Markdown appended below the table. | - |
| `comment-marker` | No | Stable key for the managed PR comment. | `default` |
| `status` | No | Fallback action status when Vercel deployment details are unavailable. | `success` |
| `comment-on-failure` | No | When `true`, failed deploy rows are still upserted before the action fails. | `true` |

`deploy-and-comment` entries:

| Field | Required | Description |
| :--- | :--- | :--- |
| `cwd` | Yes | Working directory copied into the isolated temporary workspace before running the Vercel CLI. |
| `projectId` | Yes | Vercel project ID used for project API lookup. |
| `orgId` | Yes | Vercel organization ID written into `.vercel/project.json`. |
| `environment` | Yes | Vercel deployment environment passed to `vercel pull`. |
| `projectUrl` | Yes | Absolute `https://` URL for the Vercel project. |
| `deploymentUrl` | No | Optional absolute `https://` URL used as a preview URL hint or fallback when resolving deployment metadata. |
| `displayName` | No | Display override for the project name shown in the PR comment. |
| `teamId` | No | Optional Vercel team ID used for API enrichment. |
| `slug` | No | Optional Vercel team or account slug used for API enrichment. |

`comment-only` entries:

| Field | Required | Description |
| :--- | :--- | :--- |
| `projectId` | Yes | Vercel project ID used for project API lookup. |
| `environment` | Yes | Deployment environment rendered in the PR comment. |
| `projectUrl` | Yes | Absolute `https://` URL for the Vercel project. |
| `deploymentUrl` | Yes | Absolute `https://` URL for the deployment preview. |
| `displayName` | No | Display override for the project name shown in the PR comment. |
| `teamId` | No | Optional Vercel team ID used for API enrichment. |
| `slug` | No | Optional Vercel team or account slug used for API enrichment. |

`projectUrl` and `deploymentUrl` must be absolute `https://` URLs. `http://` links are rejected so untrusted workflow input cannot render insecure or phishing-oriented links into the managed PR comment.

`projectId` is the Vercel project ID used for project API lookup.
`displayName` is only a display override. The action otherwise prefers the Vercel project API name, then deployment metadata, then `projectId`.

Legacy `deployments[].command` and `deployments[].projectName` are no longer supported.

## Comment-only Mode

```yaml
- uses: wiyco/vercel-deploy-comment@2
  with:
    mode: comment-only
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    deployments: |
      [
        {
          "projectId": "prj_web",
          "environment": "preview",
          "projectUrl": "https://vercel.com/my-team/web",
          "deploymentUrl": "https://web-git-feature-my-team.vercel.app"
        }
      ]
```

## Notes

- The action stores one hidden comment marker for the whole comment and one hidden marker per row. Row updates are scoped to `projectId + environment`.
- Rows included in the current `deployments` input are rendered in input order. Existing rows not included in the current run stay in the comment.
- The exact GitHub and Vercel APIs used by the action are documented in [docs/spec.md#external-api-usage](docs/spec.md#external-api-usage).
- `issues: write` is required for the managed pull request comment. See [docs/spec.md#required-workflow-permissions](docs/spec.md#required-workflow-permissions).

For the full behavior and security model, see [docs/spec.md](docs/spec.md).
