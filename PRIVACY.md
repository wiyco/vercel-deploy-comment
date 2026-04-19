# Privacy Policy

Last updated: 2026-04-19

## Overview

Vercel Deploy Comment is a GitHub Action that deploys or records Vercel preview deployments and keeps a single pull request comment updated. This policy explains what data the Action accesses, how it is processed, and where it may be stored.

## What Data Is Accessed

### Workflow Inputs

The Action reads the inputs supplied by your workflow, including:

- `github-token`
- `vercel-token`, when provided
- `mode`
- `deployments`, including project URLs, project names, deployment URLs, team IDs, team slugs, working directories, and custom deploy commands
- `header`, `footer`, `comment-marker`, `status`, and `comment-on-failure`

### GitHub Data

The Action reads GitHub runtime context and GitHub API data needed to find and update the pull request comment:

- Repository owner and name
- Pull request or issue number from the GitHub event payload
- Workflow run ID, GitHub server URL, and GitHub API URL
- Authenticated GitHub account login for the supplied token
- Existing pull request issue comments, including comment IDs, comment bodies, and author logins, only to find the Action's previous comment marker

### Vercel Data

When deployment or enrichment is enabled, the Action may process:

- Deployment URLs produced by the Vercel CLI or supplied in `deployments`
- Vercel Deployment API metadata, such as deployment URL, deployment name, ready state, creation timestamp, project ID, and project name
- Optional Vercel team ID or team slug supplied by the workflow

### Deployment Content

The Action itself does not parse or store your application source code. However, in `deploy-and-comment` mode the default command runs `vercel deploy --prebuilt`, which may upload deployment output from the configured working directory to Vercel. Custom deploy commands may send additional data depending on how you configure them.

## How Data Is Processed

All Action logic runs inside the GitHub Actions runner for the duration of the workflow job.

The Action:

- Uses the GitHub REST API to identify the authenticated user, list pull request comments, and create or update one pull request comment
- Runs the Vercel CLI in `deploy-and-comment` mode
- Uses the Vercel Deployment API to enrich deployment status when `vercel-token` and a deployment URL are available
- Renders a Markdown pull request comment containing deployment status and links
- Sets GitHub Actions outputs for the comment ID, comment URL, deployment URLs, and status keys

The maintainers of this Action do not operate an external server, database, analytics service, or telemetry pipeline for this Action.

## Where Data Is Stored

| Location | Scope | Retention |
| --- | --- | --- |
| Runner memory | Single workflow job | Released when the job ends |
| Workflow logs | GitHub Actions workflow run | Retained according to the repository's GitHub Actions log retention settings |
| GitHub Actions outputs | Workflow run and downstream workflow steps | Retained with the workflow run |
| Pull request comment | Repository pull request or issue | Persists until edited or deleted by a user or automation with sufficient permissions |
| Vercel platform | Vercel project, deployment, and team | Governed by your Vercel account settings and Vercel's terms and policies |

The Action does not maintain its own database, external store, cache, or persistent state between runs.

## What Appears in Pull Request Comments

Generated pull request comments may include:

- The configured comment header
- Project names and project URLs
- Deployment status labels and status icons
- Preview deployment URLs
- GitHub Actions run URLs
- UTC timestamps
- The configured Markdown footer, when provided
- A hidden HTML comment marker used to update the same comment on later runs

Pull request comments are visible according to the repository's visibility and permission model. In public repositories, deployment links and project links in comments may be publicly visible.

## Token Handling

The GitHub token supplied through `github-token` is used only for authenticated requests to the GitHub API.

The Vercel token supplied through `vercel-token` is used only for Vercel CLI deployment and Vercel Deployment API requests. For the default Vercel command, the token is passed to the CLI as a token argument.

Both tokens are registered with `@actions/core.setSecret` so GitHub Actions can mask exact token values in logs. The Action does not intentionally write tokens to pull request comments, outputs, artifacts, or files.

Custom commands and other workflow steps can still print or transmit secrets if configured to do so. Treat workflow configuration as trusted code and avoid placing secrets in `header`, `footer`, `deployments`, or other values that may be rendered into comments or logs.

## Data Minimization

- The Action reads the GitHub event payload only to identify the pull request or issue number.
- Existing comment bodies are inspected only to find the hidden marker for this Action's prior comment.
- Vercel metadata is requested only when a Vercel token and deployment URL are available.
- No telemetry or analytics data is collected by the Action maintainers.
- No reports or artifacts are created by this Action unless your workflow creates them separately.

## Third-Party Services

This Action requires GitHub-operated services and may require Vercel-operated services:

- GitHub Actions runner and logs
- GitHub REST API
- GitHub pull request comments
- Vercel CLI
- Vercel Deployment API

Use of GitHub and Vercel is governed by their respective terms and privacy policies. If you configure a custom deploy command, that command may contact additional services outside the control of this Action.

## Your Controls

Repository administrators and workflow authors can:

- Limit GitHub token permissions in workflow `permissions`
- Scope or rotate Vercel tokens
- Use `comment-only` mode to avoid running the Vercel CLI
- Delete or edit pull request comments created by the Action
- Revoke GitHub or Vercel credentials
- Disable or remove workflows that use the Action

## Changes to This Policy

Updates to this policy will be tracked in the repository's commit history and may be noted in release notes.

## Contact

For privacy-related questions or concerns, please open an issue in this repository. For sensitive security matters, use [GitHub private vulnerability reporting](https://github.com/wiyco/vercel-deploy-comment/security/advisories/new).
