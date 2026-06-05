# `GITHUB_TOKEN` is required only for `publish`

User commands make unauthenticated GitHub API calls for public repos, while `publish` requires `GITHUB_TOKEN` because it writes GitHub releases. Requiring a token from users would add friction without improving security for public Setup Releases, while authors already need authenticated write access.
