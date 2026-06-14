# airig

Distribute and manage AI setups across coding agents from one `.ai/` directory.

> *P.S. You can think of it as successor to the [skills CLI](https://skills.sh/) which allows you to distribute entire AI Setup including custom slash commands, agents, hooks, etc along with skills.*

## Why?

Teams rarely share only skills. They also share agents, commands, hooks, and provider-specific instruction files. [skills CLI](https://skills.sh/) is useful for distributing skills, but `airig` is built to distribute the full AI Setup from one `.ai/` directory.

Even as a solo developer, You can reuse your AI Setup across projects easily via [centralized repository](#author-workflow).

Why I call it successor over [skills CLI](https://skills.sh/):

| Capability | skills CLI | airig |
| --- | --- | --- |
| Share skills | ✅ | ✅ |
| Share agents, commands, hooks, and instruction files | ❌ | ✅ |
| Watch changes/updates of installed artifacts | ❌ | ✅ |
| Release security | ❌ | ✅ |
| [Strict and security-first](#strict-and-security-first) installs | ❌ | ✅ |
| Support [provider-specific artifacts](#provider-specific-artifacts) | ❌ | ✅ |
| Dogfood your local setup before publishing | ❌ | ✅ |

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

## Provider-Specific Artifacts

`airig` lets authors keep provider-specific artifacts in dedicated directories under `.ai/` instead of forcing every tool into one shared format.

For example, Claude-specific artifacts can live under `.ai/.claude/`, while other providers can have their own dedicated directories alongside it. That means you can ship shared assets like `AGENTS.md` or `skills/`, plus provider-native artifacts such as commands, agents, and other provider-recognized files from the same setup.

```text
.ai/
  AGENTS.md
  skills/
  .claude/
    commands/
    agents/
  .codex/
    ...
```

This keeps the setup organized for authors and makes installs clearer for users because provider-specific files stay grouped by the tool that actually consumes them.

## Strict And Security-First

`airig` is intentionally strict about versioning and review. Remote installs are pinned to an exact version in `.ai/ai.json`, and upgrades only happen when the user explicitly chooses a target version with `update`.

On top of that, `airig` installs from immutable GitHub releases. Once a release has been reviewed and published, its artifacts cannot be silently swapped out later. Users stay in control of when they add or update artifacts, and they can review the resulting file changes in their repository before trusting them. That makes the workflow far safer than pulling mutable prompt files from an unpinned source, and it lowers the chance of unwanted prompt changes or prompt-injection surprises reaching the working setup.

## Author Workflow

1. Create new ".ai" repository for your AI Setup.
2. Enable "Immutable Releases" in that repository settings to ensure all releases are immutable and secure for users. See [GitHub Docs](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes#enforcing-immutable-releases-for-your-repository) for instructions.
3. Create AI Setup artifacts under `.ai/`. See [jd-solanki/.ai](https://github.com/jd-solanki/.ai) for example.
4. Run `airig add .` to wire local artifacts into your own repo to test it out. For example:
    - Assume you have `write-a-skill` skill which helps you write new skills. You can create that skill under `.ai/skills/write-a-skill/SKILL.md`, then run `airig add .` to link it into your preferred AI provider and create new skills in same repo using `/write-a-skill Write skill for TDD workflow`.
    - You can create new hook under `.ai/.claude/hooks/safe-git.sh`, then run `airig add .` & choose claude as AI provider and you'll have `.claude/hooks/safe-git.sh` hook which run via pre-tool. Now whenever you update our source hook file, it'll be reflected in your linked hook file so you can test it out in your local setup before making AI Setup release.
5. Tag a release with your normal git tooling.
6. Run `airig publish` to upload `ai.zip` to an immutable GitHub Setup Release.
7. Share via `airig add yourname/repo`.

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

### Requirements

- Node.js `24.11.0` or newer in the Node 24 release line.
- GitHub immutable releases enabled for repositories that publish Setup Releases.
- `GITHUB_TOKEN` when running `publish`. For local use or custom GitHub Actions workflows, use a fine-grained GitHub PAT scoped to the Setup Release repository with `Contents` read/write access to create releases and `Administration` read-only access so `airig publish` can verify immutable releases are enabled before publishing.

## AI Provider Compatibility

`airig` currently supports these AI providers:

- Codex
- Claude
- [More](https://github.com/jd-solanki/airig/issues/37) will be added soon

Want to add your favorite provider? It's really easy, have a look at [providers registry](./src/lib/provider-registry.ts). Contributions are always welcome!
