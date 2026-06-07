# airig

Distribute and manage AI setups across coding agents from one project-local `.ai/` directory.

## Usage

Install the CLI globally to use the short `airig` command:

```sh
npm install --global airig
```

```sh
airig add <owner/repo>[@version]
airig add .
airig update <owner/repo>@<version>
airig remove [owner/repo|.]
airig publish [tag]
```

For one-off usage without a global install, run the npm package directly:

```sh
npx airig add <owner/repo>[@version]
npx airig add .
npx airig update <owner/repo>@<version>
npx airig remove [owner/repo|.]
npx airig publish [tag]
```

The package is named `airig`; the installed binary is `airig`.

## What It Does

airig installs selected AI setup artifacts from immutable GitHub releases into `.ai/`, then links them into provider-specific config paths. It supports local author dogfooding with `add .`, explicit version updates, interactive removal, and publishing `.ai/` as an `ai.zip` release asset.

Remote setup releases are pinned to exact versions in `.ai/ai.json`. `add` and `update` verify GitHub release immutability before writing remote content.

## Author Workflow

1. Create setup artifacts under `.ai/`.
2. Run `airig add .` to wire local artifacts into your repo.
3. Tag a release with your normal git tooling.
4. Run `airig publish` to upload `ai.zip` to an immutable GitHub release.
5. Share `airig add yourname/repo`.

## Requirements

- Node.js `24.11.0` or newer in the Node 24 release line.
- GitHub immutable releases enabled for repositories that publish setup releases.
- `GITHUB_TOKEN` with repository write access when running `publish`.
