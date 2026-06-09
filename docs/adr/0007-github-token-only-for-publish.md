# `GITHUB_TOKEN` is required only for `publish`

User commands make unauthenticated GitHub API calls for public repos, while `publish` requires `GITHUB_TOKEN` because it writes GitHub releases. Requiring a token from users would add friction without improving security for public Setup Releases, while authors already need authenticated write access.

`publish` resolves the token from the exported environment first, then from a `.env` file in the current working directory. This keeps the write credential scoped to author workflows without making every user command read local secrets.

Authors who publish Setup Releases from GitHub Actions should use `resources/templates/publish.yml` as the workflow template in their AI Setup repository. The template keeps the built-in workflow token read-only and maps a custom `AIRIG_PUBLISH_TOKEN` repository secret to `GITHUB_TOKEN` only for the `airig publish` step.

`AIRIG_PUBLISH_TOKEN` should be a fine-grained GitHub PAT scoped only to the Setup Release repository. It needs `Contents` read/write access to create the release and upload `ai.zip`, plus `Administration` read-only access because `publish` checks the repository immutable-release setting before it writes the release.
