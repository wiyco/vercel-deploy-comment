# Vercel Deploy Comment

[![Coverage](docs/assets/coverage.svg)](docs/assets/coverage.svg)
[![Code to Test Ratio](docs/assets/code-to-test-ratio.svg)](docs/assets/code-to-test-ratio.svg)

Deploy one or more Vercel preview builds from GitHub Actions and keep a single pull request comment updated.

The pull request comment will look like this:

| Project | Deployment | Preview | Updated (UTC) |
| :--- | :----- | :------ | :------ |
| [web](https://vercel.com/my-team/web) | ✅ [Ready](https://github.com/acme/repo/actions/runs/1234567890) | [Preview](https://web-git-feature-my-team.vercel.app) | 2026-04-19 00:00:00 UTC |
| [admin](https://vercel.com/my-team/admin) | ✅ [Ready](https://github.com/acme/repo/actions/runs/1234567890) | [Preview](https://admin-git-feature-my-team.vercel.app) | 2026-04-19 00:01:00 UTC |

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
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: vercel pull --cwd apps/web --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
      - run: vercel build --cwd apps/web --yes --token=${{ secrets.VERCEL_TOKEN }}
      - run: vercel pull --cwd apps/admin --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
      - run: vercel build --cwd apps/admin --yes --token=${{ secrets.VERCEL_TOKEN }}
      - uses: wiyco/vercel-deploy-comment@v1 # or pin to a specific commit SHA for security
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          deployments: |
            [
              {
                "cwd": "apps/web",
                "projectName": "web",
                "projectUrl": "https://vercel.com/my-team/web"
              },
              {
                "cwd": "apps/admin",
                "projectName": "admin",
                "projectUrl": "https://vercel.com/my-team/admin"
              }
            ]
```

`issues: write` is needed because this action creates and updates a regular pull request conversation comment through GitHub's Issue comments REST API ([create](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment), [update](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment)). GitHub models every pull request as an issue for shared features such as comments, labels, and assignees.

GitHub documents the issue comment create and update endpoints as accepting either `Issues: write` or `Pull requests: write` repository permissions. You can use `pull-requests: write` instead when you choose that alternative.

The action runs `vercel deploy --prebuilt --token=***` by default and creates or updates a pull request comment. Deployment creation is delegated to the Vercel CLI; Vercel documents the REST equivalent as [Create a new deployment](https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment). When a Vercel token is available, this action enriches the result through Vercel's [Get a deployment by ID or URL](https://vercel.com/docs/rest-api/reference/endpoints/deployments/get-a-deployment-by-id-or-url) endpoint.

Because the default command uses `--prebuilt`, each deployment's `cwd` must already contain Vercel build output in `.vercel/output`, normally produced by `vercel build`. Run `vercel pull` first to refresh local Vercel project settings and environment variables for that build. If your workflow deploys source directly instead, set `deployments[].command` to a non-prebuilt command such as `vercel deploy`.

The rendered comment closely mirrors Vercel's GitHub Integration preview comment: a heading plus a deployment table with Project, Deployment, Preview, and Updated columns. Multiple `deployments` entries render as multiple rows in that same PR comment, so monorepos can publish web, admin, and other previews together.

> [!CAUTION]
>
> Pass Vercel credentials through `vercel-token` instead of embedding `--token=...` in `deployments[].command`. This action masks the `vercel-token` input, but it cannot automatically register unrelated tokens written directly into custom commands.

`github-token` defaults to the workflow `GITHUB_TOKEN`. Pass `github-token` only when you need to use a different token.

For the Vercel-side GitHub Actions setup, see [How can I use GitHub Actions with Vercel?](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).

For comment-only mode:

```yaml
- uses: wiyco/vercel-deploy-comment@v1
  with:
    mode: comment-only
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    deployments: |
      [
        {
          "deploymentUrl": "https://example-git-feature-team.vercel.app",
          "projectName": "my-vercel-project",
          "projectUrl": "https://vercel.com/my-team/my-vercel-project"
        }
      ]
```

See [docs/spec.md](docs/spec.md) for the complete behavior and security model.
