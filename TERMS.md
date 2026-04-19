# Terms of Service

Last updated: 2026-04-19

## 1. Acceptance

By using Vercel Deploy Comment (the "Action"), you agree to these Terms of Service. If you do not agree, do not use the Action.

## 2. Description

The Action is a free, open-source GitHub Action that deploys or records Vercel preview deployments and creates or updates a pull request comment with deployment status and links.

## 3. License

Use of the source code is governed by the [MIT License](LICENSE) included in this repository. These Terms supplement, but do not replace, the MIT License by covering operational use of the Action.

## 4. Relationship to GitHub Marketplace and Third-Party Services

If you obtain or use the Action through GitHub Marketplace, your use of GitHub Marketplace is also governed by GitHub's Marketplace terms and other applicable GitHub terms.

The Action depends on GitHub Actions and GitHub APIs, and may depend on the Vercel CLI and Vercel APIs. Your use of those services is governed by the terms, policies, limits, and billing rules of GitHub, Vercel, and any other service contacted by your workflow or custom deploy command.

## 5. User Responsibilities

You are responsible for:

- Ensuring you have the necessary rights to access the repository data and Vercel projects used by the workflow
- Managing GitHub token permissions and Vercel token scope
- Protecting secrets and deployment URLs
- Reviewing workflow configuration before exposing secrets to pull requests, forks, or custom commands
- Ensuring `deployments[].command` and `deployments[].cwd` are trusted and appropriate for the runner environment
- Complying with all laws, policies, and third-party terms that apply to your repository, workflow, deployment content, and Vercel account

## 6. Data Processing

The Action processes data retrieved from workflow inputs, the GitHub Actions runtime, the GitHub REST API, the Vercel CLI, and the Vercel Deployment API during workflow execution.

By using the Action, you acknowledge that:

- It reads GitHub repository context, pull request or issue numbers, authenticated user login, and existing pull request comments to create or update the Action's comment.
- It may send deployment data and deployment output to Vercel when deployment or Vercel API enrichment is configured.
- Pull request comments created by the Action may expose project names, project links, preview deployment links, workflow run links, timestamps, and any Markdown footer you configure.
- Custom deploy commands may process or transmit additional data according to your workflow configuration.

For full details, see the [Privacy Policy](PRIVACY.md).

## 7. Outputs and Accuracy

Deployment status, preview URLs, timestamps, and comment links are provided for informational workflow automation purposes. They depend on GitHub, Vercel, runner behavior, network availability, token permissions, and your workflow configuration.

The Action does not guarantee that deployment state, metadata, comments, or outputs are accurate, complete, current, or suitable for any particular purpose.

## 8. Fees and External Charges

The Action is provided free of charge by its maintainers. GitHub, Vercel, runners, package registries, or other services used by your workflow may charge fees or enforce usage limits. You are responsible for those fees and limits.

## 9. No Warranty

THE ACTION IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. See the MIT License for the complete warranty disclaimer.

## 10. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL THE AUTHORS, MAINTAINERS, OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, LOSSES, COSTS, OR OTHER LIABILITY ARISING FROM THE USE OF THE ACTION, WORKFLOW CONFIGURATION, DEPLOYMENT OUTPUTS, PULL REQUEST COMMENTS, OR THIRD-PARTY SERVICES, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE.

## 11. Security

You are responsible for choosing appropriate token scopes, repository permissions, runner environments, and workflow triggers. The Action includes token masking and comment-rendering safeguards, but it cannot protect secrets or systems exposed by your workflow configuration, custom commands, Vercel settings, or other workflow steps.

For vulnerability reporting and recommended hardening steps, see [SECURITY.md](SECURITY.md).

## 12. Support

The Action is maintained on a best-effort basis. There is no guaranteed response time, service-level agreement, uptime commitment, or obligation to provide support. Bug reports and feature requests may be filed through GitHub Issues.

## 13. Modifications

These Terms may be updated at any time. Changes will be reflected in this file with an updated date. Continued use of the Action after a change constitutes acceptance of the revised Terms.

## 14. Governing Terms

The MIT License governs the software license grant and license warranty disclaimer. These Terms govern operational use of the Action to the extent they do not conflict with the MIT License or mandatory applicable law. GitHub, Vercel, and other third-party terms govern their respective services.

## 15. Contact

For questions about these Terms, please open an issue in this repository. For sensitive security matters, use [GitHub private vulnerability reporting](https://github.com/wiyco/vercel-deploy-comment/security/advisories/new).
