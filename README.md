# airig

Distribute and manage AI setups across coding agents from one project-local `.ai/` directory.

## Usage

Install the CLI globally to use the short `airig` command:

```sh
npm install --global @airig/cli
```

```sh
airig add <owner/repo>[@version]
airig add .
airig add --global <owner/repo>[@version]
airig add --global .
airig update <owner/repo>@<version>
airig update --global <owner/repo>@<version>
airig remove [owner/repo|.]
airig remove --global [owner/repo|stored-local-key]
airig publish [tag]
```

For one-off usage without a global install, run the npm Package directly:

```sh
npx @airig/cli add <owner/repo>[@version]
npx @airig/cli add .
npx @airig/cli add --global <owner/repo>[@version]
npx @airig/cli add --global .
npx @airig/cli update <owner/repo>@<version>
npx @airig/cli update --global <owner/repo>@<version>
npx @airig/cli remove [owner/repo|.]
npx @airig/cli remove --global [owner/repo|stored-local-key]
npx @airig/cli publish [tag]
```

The Package is named `@airig/cli`; the installed binary is `airig`.

## What It Does

airig installs selected AI Setup artifacts from immutable GitHub releases into `.ai/`, then links them into provider-specific config paths. It supports local author dogfooding with `add .`, explicit version updates, interactive removal, and publishing `.ai/` as an `ai.zip` release asset.

Remote Setup Releases are pinned to exact versions in `.ai/ai.json`. `add` and `update` verify GitHub release immutability before writing remote content.

## Global AI Setups

Add, update, and remove also accept a subcommand-level `--global` option to manage your personal Global AI Setup in `~/.ai` instead of the current project's `.ai/` directory. Global state is stored in `~/.ai/ai.json`, and selected artifacts are activated under the global setup root with the same provider layout as project installs.

```sh
airig add --global <owner/repo>[@version]
airig add --global .
airig update --global <owner/repo>@<version>
airig remove --global [owner/repo|stored-local-key]
```

Use `add --global .` from an AI Setup source repository when you want to dogfood local changes in your own global setup. airig records the source repository as a stored local key relative to `~/.ai`, so use that exact key with `remove --global <stored-local-key>` when removing it later.

`publish` remains project-only and does not support `--global`. Authors share Global AI Setups by publishing the source setup repository, then installing or dogfooding that repository; `~/.ai` itself is not published directly.

## Maintainer Releases

Use Package releases to publish the `@airig/cli` npm Package, which provides the `airig` CLI:

```sh
pnpm release
```

The release script is maintainer-facing. It uses `bumpp` to choose the next Package version, update Package metadata, create the release commit, create a `v<version>` tag, and push the commit and tag. Pushed `v*` tags trigger `.github/workflows/publish-package.yml`, which installs dependencies, runs tests, builds the CLI, and publishes the Package to npm.

npm publishing uses trusted publishing with GitHub Actions OIDC. Do not add a long-lived npm token for Package releases.

Package releases are separate from Setup Releases. `airig publish [tag]` creates a GitHub immutable Setup Release containing `ai.zip` from `.ai/`; it does not publish the npm Package.

## Author Workflow

1. Create AI Setup artifacts under `.ai/`.
2. Run `airig add .` to wire local artifacts into your repo.
3. Tag a release with your normal git tooling.
4. Run `airig publish` to upload `ai.zip` to an immutable GitHub Setup Release.
5. Share `airig add yourname/repo`.

For AI Setup repositories, use [`bumpp`](https://github.com/antfu-collective/bumpp)
to create and push release tags from a package script:

```json
{
  "scripts": {
    "release": "bumpp"
  }
}
```

To publish Setup Releases from your AI Setup repository with GitHub Actions, copy
`resources/templates/publish.yml` to `.github/workflows/publish.yml` in that
repository. The workflow publishes when `bumpp` pushes a `v*` tag and expects an
`AIRIG_PUBLISH_TOKEN` repository secret. Create that secret from a fine-grained
GitHub PAT scoped only to the Setup Release repository with:

- `Contents`: Read and write
- `Administration`: Read-only

## Requirements

- Node.js `24.11.0` or newer in the Node 24 release line.
- GitHub immutable releases enabled for repositories that publish Setup Releases.
- `GITHUB_TOKEN` when running `publish`. For local use or custom GitHub Actions workflows, use a fine-grained GitHub PAT scoped to the Setup Release repository with `Contents` read/write access to create releases and `Administration` read-only access so `airig publish` can verify immutable releases are enabled before publishing.
