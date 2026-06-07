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
airig update <owner/repo>@<version>
airig remove [owner/repo|.]
airig publish [tag]
```

For one-off usage without a global install, run the npm Package directly:

```sh
npx @airig/cli add <owner/repo>[@version]
npx @airig/cli add .
npx @airig/cli update <owner/repo>@<version>
npx @airig/cli remove [owner/repo|.]
npx @airig/cli publish [tag]
```

The Package is named `@airig/cli`; the installed binary is `airig`.

## What It Does

airig installs selected AI Setup artifacts from immutable GitHub releases into `.ai/`, then links them into provider-specific config paths. It supports local author dogfooding with `add .`, explicit version updates, interactive removal, and publishing `.ai/` as an `ai.zip` release asset.

Remote Setup Releases are pinned to exact versions in `.ai/ai.json`. `add` and `update` verify GitHub release immutability before writing remote content.

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

## Requirements

- Node.js `24.11.0` or newer in the Node 24 release line.
- GitHub immutable releases enabled for repositories that publish Setup Releases.
- `GITHUB_TOKEN` with repository write access when running `publish`.
