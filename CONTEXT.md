# ohmyai — Domain Context

## What It Is

`ohmyai` is a CLI tool (`npx ohmyai`) for distributing and managing entire AI setups across providers (Claude Code, Codex, Copilot, Gemini, OpenCode, etc.). It fills the gap left by `npx skills`, which only distributes `SKILL.md` files and requires manual installation of agents, commands, and hooks.

## Core Insight

The author is the first consumer of their own setup. Authors place their AI setup in `.ai/`, run `npx ohmyai link` to wire it up in their own repo, then cut a GitHub release to share it. Consumers install it with one command and stay current via explicit version bumps.

---

## Glossary

### AI Setup
The complete collection of AI configuration artifacts for one or more providers — skills, agents, custom commands, hooks. The unit of distribution in `ohmyai`. Stored in the `.ai/` directory.

### Package
A versioned AI Setup published by an author on GitHub. Identified as `<owner>/<repo>` (e.g. `yourname/setup`). Distributed via GitHub immutable releases as an `ai.zip` asset.

### Provider
An AI coding agent/tool that consumes the setup artifacts. Examples: `claude`, `codex`, `copilot`, `gemini`, `opencode`. Each provider has its own subdirectory under `.ai/` (mirroring its target config directory name) and its own target config directories in the repo.

### `.ai/` Directory
The committed directory at the repo root that holds project-scoped AI Setup content, organized by provider:
```
.ai/
  ai.json
  skills/          ← provider-agnostic; linked to .agents/skills/ per-file
  .claude/
    agents/
    commands/
  .codex/
    agents/
    commands/      ← linked to .codex/prompts/
```
Committed to git. Consumers can edit files freely — git is the diff/merge tool.

### `.ai.global/` Directory
The directory at the repo root that holds global-scoped AI Setup content — artifacts that apply across all of the author's projects. Same internal structure as `.ai/` (organized by provider). When published, both `.ai/` and `.ai.global/` are included in `ai.zip`. When a consumer installs with global scope, `.ai.global/<provider>/` content lands in `~/.ai/<provider>/`.
```
.ai.global/
  .claude/
    skills/
    agents/
  .codex/
    agents/
```

### `ai.json`
The single manifest file for an installation scope. Lives at `.ai/ai.json` (project scope) or `~/.ai/ai.json` (global scope). Declares which packages are installed at which exact versions, which artifacts are excluded, and records the symlink ownership map. Ownership keys are symlink target paths. Values are either `"owner/repo@version"` (package-managed) or a `.ai/`-relative source path (locally-managed, written by `link`).

```json
{
  "packages": {
    ".": {
      "version": "*",
      "exclude": [".claude/commands/scratch.md"]
    },
    "yourname/setup": {
      "version": "1.2.0",
      "exclude": ["skills/python-pro.md", ".claude/agents/"]
    }
  },
  "ownership": {
    ".claude/agents/reviewer.md": ".ai/.claude/agents/reviewer.md",
    ".agents/skills/tdd/SKILL.md": "yourname/setup@1.2.0",
    ".codex/agents/reviewer.md": ".ai/.codex/agents/reviewer.md"
  }
}
```

Package keys are either `"owner/repo"` (remote package) or `"."` (local package — the author's own `.ai/` directory, written by `link`). The `"."` key uses `version: "*"` as a sentinel meaning "always current, no pinning." Its `exclude` list enables selective linking — specific files or dirs the author wants to skip.

**Versions are always exact** for remote packages — no semver ranges. The CLI pins the exact version on `add` and only moves it on an explicit `update` command. `"*"` is only valid for the `"."` local package.

Immutability is always verified online via the GitHub API — on every `add`, `update`, and `sync`. No offline attestation cache.

The `ownership` section is written and owned by the CLI — consumers never edit it manually. Values are either `"owner/repo@version"` (remote) or an explicit `.ai/`-relative source path (local, written by `link`). It records which package owns each symlinked file for conflict detection.

The `exclude` list is written by the CLI after interactive selection during `add` (remote packages) or respected during `link` (local `"."` package). Directory paths exclude everything under them.

### Interactive Selection
The CLI prompt shown during `npx ohmyai add` that lets consumers pick which artifact subdirectories and individual files to install. Deselected items are written to the `exclude` list in `ai.json`. Consumers never edit the exclude list manually — the CLI owns it.

### Command Interaction Model
`add` is interactive — triggers the Interactive Selection prompt so consumers choose which artifacts to install. `update` is explicit — requires a version argument, never auto-resolves, never prompts. `check` is unattended-safe — read-only, prints available newer immutable releases, safe in CI.

### Update Warnings
Informational messages printed during `npx ohmyai check` for excluded artifacts that have changed upstream:
- **Excluded file updated**: Author modified a file in the consumer's exclude list — ignored, warning shown.
- **Excluded file deleted**: Author removed a file that exists in the consumer's exclude list — consumer prompted to decide (remove the exclusion entry or keep the local file).

### Release Asset
The `ai.zip` file that authors upload to a GitHub immutable release. Contains the `.ai/` directory. The CLI always looks for an asset named exactly `ai.zip` on the resolved release tag. Only immutable releases are accepted by the CLI — non-immutable releases are rejected at install time.

### Link
The act of symlinking individual files from `.ai/<provider_directory>/` (and `.ai/skills/` for shared skills) into the provider's real config directories. Each managed file gets its own symlink, preserving any unmanaged files the author has in the same target directories. Run via `npx ohmyai link [provider]` — if no provider is given, a multi-select prompt lets the user pick one or more providers to wire. After creating each symlink, writes a locally-managed ownership entry to `ai.json` (value = `.ai/`-relative source path) so `remove` can clean up those symlinks later. No network, no release verification. Skills (`.ai/skills/`) are always linked regardless of which providers are selected. Also triggered automatically at the end of `add`.

### Provider Registry
A static mapping built into the CLI (`src/lib/provider-registry.ts`) that declares, for each supported provider: its canonical name and its per-file symlink rules (source path → target path). MVP providers: `claude` and `codex`. Adding a new provider requires a CLI release.

### Install Summary
The log printed after `add` or `update` showing which files were added, replaced, or deleted — and why. Consumers use this alongside `git diff` to understand what changed.

### Immutability Gate
The security check run on every `add` and `update` before any files are written. The CLI fetches the release attestation from GitHub and verifies the release is immutable. If the release has no attestation or is not immutable, the command errors and nothing is written to disk.

---

## Version Model

- Versions are always **exact** in `ai.json` (e.g. `"1.2.0"`, never `"^1.0.0"`)
- `npx ohmyai add yourname/setup` resolves to the latest immutable release and pins that exact version
- `npx ohmyai add yourname/setup@1.2.0` installs that specific immutable release
- `npx ohmyai update yourname/setup@1.3.0` bumps to that explicit immutable release
- No automatic version resolution — every version transition is a deliberate consumer decision

---

## Update Behaviour

Running `npx ohmyai update yourname/setup@<version>`:
- Verifies the target release is immutable (errors if not)
- Replaces files that exist in the new release
- Adds files new to the release
- Deletes files removed from the release
- Preserves files in `.ai/` that are not part of the package (consumer-added files)
- Prints a full install summary before writing anything
- Consumer uses `git diff` to review and recover any customizations

Running `npx ohmyai check [owner/repo]`:
- Read-only, never writes files
- Fetches available newer immutable releases for installed packages
- Reports which packages have updates available
- Safe to run in CI

---

## v1 Command Surface

```
npx ohmyai add <owner/repo>[@version]    # fetch ai.zip from immutable GitHub release, write to .ai/, update ai.json
npx ohmyai check [owner/repo]            # report newer immutable releases available, read-only
npx ohmyai update <owner/repo>@<version> # pull specific immutable release, replace/add/delete files, print summary
npx ohmyai remove <owner/repo>           # remove package artifacts from .ai/, update ai.json
npx ohmyai sync                          # restore .ai/ from ai.json (re-fetch pinned immutable releases, verify attestations)
npx ohmyai link [provider]               # symlink .ai/<provider>/ subdirs → provider config dirs; omit provider for multi-select (local only)
npx ohmyai publish                       # create draft release, attach ai.zip, publish as immutable release
```

`list` is post-MVP.

---

## Author Workflow

1. Create `.ai/<provider>/` directories with skills, agents, commands, hooks
2. Run `npx ohmyai link` to wire `.ai/` into provider config dirs — multi-select prompt picks providers (local only — no GitHub involved)
3. Iterate on the setup freely; `link` keeps it live in the provider
4. Tag a release and run `npx ohmyai publish` to zip `.ai/` and upload as an immutable release
5. Share `npx ohmyai add yourname/repo`

## Consumer Workflow

1. Run `npx ohmyai add yourname/setup` — latest immutable release written to `.ai/`, `ai.json` created with exact version; multi-select provider prompt wires chosen providers immediately
2. Commit `.ai/`, `ai.json` to git
3. Edit files in `.ai/` freely to customize
4. Run `npx ohmyai check` periodically to see if newer immutable releases are available
5. Run `npx ohmyai update yourname/setup@<version>` explicitly when ready to upgrade

---

## Key Differences from `npx skills`

| Concern | `npx skills` | `ohmyai` |
|---|---|---|
| Distribution unit | Single `SKILL.md` file | Entire AI setup (skills + agents + commands + hooks) |
| Versioning | Raw GitHub clone, no releases | GitHub immutable releases, exact version pinning |
| Version mutability | Always latest HEAD, silent updates | Exact pins, explicit upgrades only |
| Immutability enforcement | None | Immutability gate on every install — non-immutable releases rejected |
| Conflict detection | None (last-write-wins) | `ownership` section in `ai.json`, detected at install time |
| Manifest + lockfile | `skills-lock.json` (hash only, no version intent) | Single `ai.json` (version + attestation + ownership) |
| Restore on fresh machine | Not supported | `npx ohmyai sync` re-fetches pinned immutable releases |
| Author dogfooding | Author cannot use own skills repo (bootstrapping problem) | Author runs `link` to use own setup immediately (local, no GitHub) |
| Agents, commands, hooks | Manual copy | First-class, distributed automatically |
