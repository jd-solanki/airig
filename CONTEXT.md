# ohmyai — Domain Context

## What It Is

`ohmyai` is a CLI tool (`npx ohmyai`) for distributing and managing entire AI setups across providers (Claude Code, Codex, Copilot, Gemini, OpenCode, etc.). It fills the gap left by `npx skills`, which only distributes `SKILL.md` files and requires manual installation of agents, commands, and hooks.

## Core Insight

Authors dogfood their own setup before sharing it. They place their AI setup in `.ai/`, run `npx ohmyai add .` to wire selected local artifacts into their own repo, then cut a GitHub release to share it. Users install selected artifacts with one command and stay current via explicit version bumps.

---

## Glossary

### Author

The person or organization that creates an AI Setup and publishes it as a Setup Release.

### User

The person who downloads an Author's Setup Release and uses it in their own repository.

### AI Setup

The complete collection of AI configuration artifacts for one or more providers — project instruction files, skills, agents, custom commands, hooks. Stored in the `.ai/` directory and distributed as a Setup Release when published.

### Project Instruction File

A root-level AI Setup artifact that coding agents and IDEs read to understand how to work in a repository. `AGENTS.md` is the broadly supported filename; `CLAUDE.md` is the Claude-recognized filename and may either share the same guidance or carry Claude-specific guidance.

### Instruction Target

A provider-recognized root filename where a Project Instruction File is exposed in the user repository. Multiple Instruction Targets can expose shared or provider-specific guidance to different coding agents.

### Package

The public npm CLI package named `ohmyai` that provides the `ohmyai` command. Published to npm so users can run `npx ohmyai`.

### Setup Release

A versioned AI Setup published by an author on GitHub. Identified as `<owner>/<repo>` (e.g. `yourname/setup`). Distributed via GitHub immutable releases as an `ai.zip` asset.

### Provider

An AI coding agent/tool that consumes the setup artifacts. Examples: `claude`, `codex`, `copilot`, `gemini`, `opencode`. Each provider has its own subdirectory under `.ai/` (mirroring its target config directory name) and its own target config directories in the repo.

### `.ai/` Directory

The committed directory at the repo root that holds project-scoped AI Setup content, organized by provider:

```
.ai/
  ai.json
  AGENTS.md        ← root Project Instruction File
  CLAUDE.md        ← root Project Instruction File
  skills/          ← provider-agnostic; linked to .agents/skills/ per-file
  .claude/
    agents/
    commands/
  .codex/
    agents/
    commands/      ← linked to .codex/prompts/
```

Committed to git. Users can edit files freely — git is the diff/merge tool.

> _NOTE: `ai.json` file will not be part of the release asset and is only for local installation state. However, users working in a team should commit this file so that other team members can have similar AI setup._

### `ai.json`

The single manifest file for project scope. Lives at `.ai/ai.json`. Declares which Setup Releases are installed at which exact versions and which source artifacts are active. Active ownership is derived from each package's `linked` list and the Provider Registry instead of being stored as a separate map.

```json
{
  "packages": {
    ".": {
      "version": "*",
      "linked": [".claude/commands/review.md"]
    },
    "yourname/setup": {
      "version": "1.2.0",
      "linked": ["AGENTS.md", "skills/tdd", ".claude/agents/reviewer.md"]
    }
  }
}
```

Manifest keys are either `"owner/repo"` (remote Setup Release) or `"."` (local AI Setup — the Author's own `.ai/` directory, written by `add .`). The `"."` key uses `version: "*"` as a sentinel meaning "always current, no pinning." Both local and remote entries use the same `linked` list of source artifact labels — `.ai/`-relative artifacts that are installed and wired into provider target paths.

**Versions are always exact** for remote Setup Releases — no semver ranges. The CLI pins the exact version on `add` and only moves it on an explicit `update` command. `"*"` is only valid for the `"."` local AI Setup.

Immutability is always verified online via the GitHub API — on every `add` and `update`. No offline attestation cache.

The `linked` list is written by the CLI after interactive selection during `add` and `remove`. For remote Setup Releases, `.ai/` contains only selected active artifacts, plus any relative symlink dependency required to preserve an Author-provided setup symlink such as `CLAUDE.md -> AGENTS.md`. There is no downloaded-but-inactive remote cache.

### Interactive Selection

The CLI prompt that lets Users pick which artifact subdirectories and individual files to add or remove. Selected active items are written to the `linked` list in `ai.json`. Users never edit the linked list manually — the CLI owns it.

### Command Interaction Model

`add` is the public activation command. For a remote Setup Release, it verifies immutability, extracts the release into a temp directory, prompts for providers first and artifacts second, checks conflicts before writing, copies only selected artifacts into `.ai/`, creates target symlinks, and writes the package `linked` list. If that Setup Release is already installed, `add owner/repo` fetches the currently pinned version and lets the User add more artifacts without moving versions; `add owner/repo@new-version` errors and points to `update`. `add .` is the local Author dogfooding flow: it prompts over existing `.ai/` artifacts and wires selected local artifacts without network access.

`update` is explicit and non-interactive. It requires `owner/repo@version`, verifies immutability, refreshes only artifacts currently listed in that package's `linked` list, prunes artifacts deleted upstream, unlinks their target symlinks, and ignores newly-added upstream artifacts until the User runs `add owner/repo`.

`remove` is interactive. It shows active artifacts grouped by package and artifact category, then removes selected target symlinks and prunes selected labels from `linked`. For remote Setup Releases, it also deletes the selected `.ai/` source artifacts. For the local `"."` package, it preserves `.ai/` source files because they are the Author's working setup.

There is no global-scope behavior in the MVP. The command surface is limited to `add`, `update`, `remove`, and `publish`; public `link`, `check`, `sync`, and `list` are out of scope.

### Release Asset

The `ai.zip` file that authors upload to a GitHub immutable release. Contains AI Setup artifacts from `.ai/`, but excludes `.ai/ai.json` because the manifest is local installation state. The CLI always looks for an asset named exactly `ai.zip` on the resolved release tag. Only immutable releases are accepted by the CLI — non-immutable releases are rejected at install time.

### Add

The act of selecting AI Setup artifacts and making them active in the current repository. Each managed file gets its own symlink, preserving unmanaged files in the same target directories. `add` prompts for providers first and artifacts second. Skills (`.ai/skills/`) are always considered regardless of which providers are selected.

### Link Conflict

A target path that cannot be linked because it is already claimed or occupied. Conflicts between remote Setup Releases block the operation before `.ai/` files or target symlinks are written. Existing real files or symlinks pointing somewhere else also block `add`; the User must remove or move the conflicting file before retrying.
_Avoid_: Overwrite, last-write-wins

### Provider Registry

A static mapping built into the CLI (`src/lib/provider-registry.ts`) that declares, for each supported provider: its canonical name and its symlink rules (source path → target path). File sources map to file targets, directory sources map to directory targets, and root Project Instruction Files are represented as normal provider rules. MVP providers: `claude` and `codex`. Adding a new provider requires a CLI release.

### Install Summary

The log printed after `add` or `update` showing which files were added, replaced, or deleted — and why. Users use this alongside `git diff` to understand what changed.

### Immutability Gate

The security check run on every `add` and `update` before any files are written. The CLI fetches the release attestation from GitHub and verifies the release is immutable. If the release has no attestation or is not immutable, the command errors and nothing is written to disk.

---

## Version Model

- Versions are always **exact** in `ai.json` (e.g. `"1.2.0"`, never `"^1.0.0"`)
- `npx ohmyai add yourname/setup` resolves to the latest immutable release and pins that exact version
- `npx ohmyai add yourname/setup@1.2.0` installs that specific immutable release
- `npx ohmyai update yourname/setup@1.3.0` bumps to that explicit immutable release
- No automatic version resolution — every version transition is a deliberate user decision

---

## Update Behaviour

Running `npx ohmyai update yourname/setup@<version>`:

- Verifies the target release is immutable (errors if not)
- Replaces files in the package's current `linked` list when they exist in the new release
- Ignores files new to the release until the User explicitly runs `add owner/repo`
- Deletes linked files removed from the release, removes their target symlinks, and prunes them from the package's `linked` list
- Preserves local files in `.ai/` that are not owned by the package
- Reconciles symlinks for artifacts that remain in the package's `linked` list
- Prints an update summary after reconciliation
- User uses `git diff` to review and recover any customizations

---

## v1 Command Surface

```
npx ohmyai add <owner/repo>[@version]    # interactively install and link selected artifacts from an immutable Setup Release
npx ohmyai add .                         # interactively link selected local Author artifacts
npx ohmyai update <owner/repo>@<version> # refresh currently linked artifacts at an exact immutable version
npx ohmyai remove [owner/repo|.]         # interactively remove active artifacts
npx ohmyai publish [tag]                 # publish project .ai artifacts as immutable ai.zip
```

Public `link`, `check`, `sync`, `list`, and global scope are post-MVP.

---

## Author Workflow

1. Create `.ai/<provider>/` directories with skills, agents, commands, hooks
2. Run `npx ohmyai add .` to wire selected `.ai/` artifacts into provider config dirs — multi-select prompt picks providers and artifacts
3. Iterate on the setup freely; rerun `add .` when adding new local artifacts
4. Tag a release and run `npx ohmyai publish` to zip `.ai/` and upload as an immutable release
5. Share `npx ohmyai add yourname/repo`

## User Workflow

1. Run `npx ohmyai add yourname/setup` — latest immutable release is inspected in temp, selected artifacts are written to `.ai/`, and `ai.json` is created with an exact version
2. Commit `.ai/`, `ai.json` to git
3. Edit active files in `.ai/` freely to customize
4. Run `npx ohmyai update yourname/setup@<version>` explicitly when ready to upgrade

---

## Useful Links

- [GitHub Immutable Releases Concepts](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [Preventing Changes to Your Releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/preventing-changes-to-your-releases)
- [Verifying the Integrity of a Release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verifying-the-integrity-of-a-release)

---

## Key Differences from `npx skills`

| Concern | `npx skills` | `ohmyai` |
|---|---|---|
| Distribution unit | Single `SKILL.md` file | Entire AI setup (skills + agents + commands + hooks) |
| Versioning | Raw GitHub clone, no releases | GitHub immutable releases, exact version pinning |
| Version mutability | Always latest HEAD, silent updates | Exact pins, explicit upgrades only |
| Immutability enforcement | None | Immutability gate on every install — non-immutable releases rejected |
| Conflict detection | None (last-write-wins) | Derived from package `linked` lists and the Provider Registry |
| Manifest + lockfile | `skills-lock.json` (hash only, no version intent) | Single `ai.json` (exact versions + linked artifact lists) |
| Restore on fresh machine | Not supported | Post-MVP |
| Author dogfooding | Author cannot use own skills repo (bootstrapping problem) | Author runs `add .` to use own setup immediately (local, no GitHub) |
| Agents, commands, hooks | Manual copy | First-class, distributed automatically |
