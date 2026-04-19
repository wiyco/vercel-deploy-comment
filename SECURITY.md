# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| v1.x    | ✅        |

Only the latest supported major release line receives security fixes.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it through [GitHub private vulnerability reporting](https://github.com/wiyco/vercel-deploy-comment/security/advisories/new).

Please do not open a public issue for security vulnerabilities.

Do not include production GitHub tokens, Vercel tokens, private preview URLs, private deployment logs, or other secrets in public issues, discussions, pull requests, or comments.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected version, tag, or commit SHA
- Relevant workflow configuration with secrets redacted
- Potential impact
- Suggested fix, if any

### Response Timeline

This project is maintained on a best-effort basis. For valid reports, maintainers aim to provide:

- Acknowledgement within 7 business days
- Initial assessment within 14 business days
- Fix release based on severity and impact, typically within 21 days for critical issues

## Scope

Vercel Deploy Comment is a GitHub Action that runs inside the user's GitHub Actions runner, optionally invokes the Vercel CLI, calls the GitHub REST API and Vercel Deployment API, and creates or updates a pull request comment.

Security concerns include, but are not limited to:

- GitHub token and Vercel token handling or exposure
- Exposure of private preview URLs, Vercel dashboard URLs, deployment metadata, or workflow run URLs
- Command execution risks from `deployments[].command` and `deployments[].cwd`
- Markdown or URL injection in generated pull request comments
- Abuse of the hidden comment marker used to find the existing action comment
- GitHub Actions output injection or log injection
- Unsafe use on untrusted pull requests, especially with `pull_request_target`
- Dependency supply-chain risks

## Security Model

- The default deploy command is executed through `@actions/exec` as an argument vector, not through a shell.
- A custom `deployments[].command` is still executable workflow configuration. Treat it as trusted code and do not build it from untrusted pull request input.
- `github-token` and `vercel-token` are registered with `@actions/core.setSecret`.
- User-supplied table values and link URLs are escaped or validated before they are rendered into the generated Markdown comment.
- `footer` is intentionally rendered as caller-provided Markdown. Do not populate it from untrusted pull request data.
- Existing pull request comments are updated only when both the hidden marker and authenticated GitHub user match.

> [!CAUTION]
>
> Pass Vercel credentials through `vercel-token` instead of embedding `--token=...` in `deployments[].command`. This action masks the `vercel-token` input, but it cannot automatically register unrelated tokens written directly into custom commands.

## Recommended Workflow Hardening

- Grant the GitHub token the minimum required permissions, typically `contents: read` and `issues: write`.
- Avoid exposing write-scoped GitHub tokens or Vercel tokens to workflows triggered by untrusted forks.
- Prefer pinning third-party actions and this action to immutable release tags or commit SHAs in sensitive repositories.
- Scope Vercel tokens to the least privilege available for the target project or team.
- Do not publish private preview URLs in public repositories unless that exposure is intended.

## Out of Scope

The following are outside this project's vulnerability response scope:

- Vulnerabilities in GitHub, GitHub Actions, Vercel, or the Vercel CLI
- Secrets printed by user-defined custom commands or other workflow steps
- Misconfigured repository permissions, branch protection, environments, or Vercel project settings
- Vulnerabilities in the application being deployed

## Disclosure

Please allow maintainers reasonable time to investigate and release a fix before public disclosure. Security fixes and relevant policy updates will be tracked in the repository history and release notes where appropriate.
