# No `gh` CLI dependency

`ohmyai` uses `@octokit/rest` directly for all GitHub API calls instead of depending on the `gh` CLI at runtime. The `gh` CLI is not guaranteed to exist on user machines, and requiring it would create a fragile install experience; `@octokit/rest` provides the release API surface needed as a normal npm dependency.
