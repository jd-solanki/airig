# airig — Domain Context

## What It Is

`airig` is a CLI tool for distributing and managing entire AI Setups across providers (Claude Code, Codex, Copilot, Gemini, OpenCode, etc.). It is published as the npm Package `@airig/cli`, but users are encouraged to install it globally and run the short `airig` command. It fills the gap left by `npx skills`, which only distributes `SKILL.md` files and requires manual installation of agents, commands, and hooks.

## Core Insight

Authors dogfood their own setup before sharing it. They place their AI setup in `.ai/`, run `airig add .` to wire selected local artifacts into their own repo, then cut a GitHub release to share it. Users install selected artifacts with one command and stay current via explicit version bumps.

---

## Glossary

### Author

The person or organization that creates an AI Setup and publishes it as a Setup Release.

### User

The person who downloads an Author's Setup Release and uses it in their own repository.

### AI Setup

The complete collection of AI configuration artifacts for one or more providers — project instruction files, skills, agents, custom commands, hooks. An AI Setup can be project-scoped or global-scoped.

### Project AI Setup

An AI Setup that belongs to a repository. It is kept in the repository's `.ai/` directory and can be distributed as a Setup Release when published.

### Global AI Setup

An AI Setup that belongs to a User rather than a repository. It is kept in the User's home-level `~/.ai/` directory and represents personal AI configuration shared across repositories on that machine.

Global scope uses the User's home-level `~/.ai/` directory as the target AI Setup root. The same provider artifact layout and target-path rules apply; only the target AI Setup root changes from the current repository directory to `~/.ai/`.

### Project Instruction File

A root-level AI Setup artifact that coding agents and IDEs read to understand how to work in a repository. `AGENTS.md` is the broadly supported filename; `CLAUDE.md` is the Claude-recognized filename and may either share the same guidance or carry Claude-specific guidance.

### Instruction Target

A provider-recognized root filename where a Project Instruction File is exposed in the user repository. Multiple Instruction Targets can expose shared or provider-specific guidance to different coding agents.

### Package

The public npm CLI Package named `@airig/cli` that provides the `airig` command. Published to npm so users can install it globally with `npm install --global @airig/cli`; one-off usage remains available through `npx @airig/cli`. A Package release distributes the CLI through npm; it is not an AI Setup and does not create `ai.zip`.

### Setup Release

A versioned AI Setup published by an author on GitHub. Identified as `<owner>/<repo>` (e.g. `yourname/setup`). Distributed via GitHub immutable releases as an `ai.zip` asset. A Setup Release is created by `airig publish [tag]`; it is not an npm Package publication.

### Provider

An AI coding agent/tool that consumes the setup artifacts. Examples: `claude`, `codex`, `copilot`, `opencode`, `kiro`. Providers consume shared artifacts such as `AGENTS.md` and `skills/` when they support them, and use provider-specific source directories only for artifacts that need provider-native targets.

### `.ai/` Directory

The directory that holds AI Setup content for a scope. Project AI Setups use a repo-root `.ai/` directory; Global AI Setups use the User's `~/.ai/` directory.

```
.ai/
  ai.json
  AGENTS.md        ← root Project Instruction File
  CLAUDE.md        ← root Project Instruction File
  skills/          ← linked to provider-specific skill targets per-file (e.g. .claude/skills/, .agents/skills/)
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

Manifest keys are either `"owner/repo"` (remote Setup Release) or a local setup root. Project `add .` uses `"."` as the local setup root because the source root and target root are the same repository. Global `add --global .` uses the relative path from `~/.ai/` to the current working repository root because the source root and target root are different. Local setup roots use `version: "*"` as a sentinel meaning "always current, no pinning." Both local and remote entries use the same `linked` list of source artifact labels — `.ai/`-relative artifacts that are installed and wired into provider target paths.

**Versions are always exact** for remote Setup Releases — no semver ranges. The CLI pins the exact version on `add` and only moves it on an explicit `update` command. `"*"` is only valid for local setup roots.

Immutability is always verified online via the GitHub API — on every `add` and `update`. No offline attestation cache.

The `linked` list is written by the CLI after interactive selection during `add` and `remove`. For remote Setup Releases, `.ai/` contains only selected active artifacts, plus any relative symlink dependency required to preserve an Author-provided setup symlink such as `CLAUDE.md -> AGENTS.md`. There is no downloaded-but-inactive remote cache.

In global scope, remote Setup Release artifacts are copied into `~/.ai/` just as project-scope remote artifacts are copied into the repo-root `.ai/`. The symlink-to-source behavior is only for local dogfooding with `add --global .`.

### Interactive Selection

The CLI prompt that lets Users pick which artifact subdirectories and individual files to add or remove. Selected active items are written to the `linked` list in `ai.json`. Users never edit the linked list manually — the CLI owns it.

### Command Interaction Model

`add` is the public activation command. For a remote Setup Release, it verifies immutability, extracts the release into a temp directory, prompts for providers first and artifacts second, checks conflicts before writing, copies only selected artifacts into `.ai/`, creates target symlinks, and writes the package `linked` list. If that Setup Release is already installed, `add owner/repo` fetches the currently pinned version and lets the User add more artifacts without moving versions; `add owner/repo@new-version` errors and points to `update`. `add .` is the local Author dogfooding flow: it prompts over the current working `.ai/` artifacts and wires selected local artifacts without network access. With `--global`, the local source remains the current working `.ai/`; the target AI Setup root changes to `~/.ai/`.

`add`, `update`, and `remove` accept a subcommand-level `--global` option that changes the selected scope from the current repository to the User's `~/.ai/` directory. `publish` does not accept `--global`; publishing is a project Author workflow.

Project scope and global scope are isolated. Each scope reads and writes only its own `ai.json`, source artifacts, target symlinks, and ownership state; installing the same Setup Release in both scopes is valid and does not create a cross-scope conflict.

`update` is explicit, non-interactive, and remote-only. It requires `owner/repo@version`, verifies immutability, refreshes only artifacts currently listed in that package's `linked` list, prunes artifacts deleted upstream, unlinks their target symlinks, and ignores newly-added upstream artifacts until the User runs `add owner/repo`. Local setup roots use `add` instead of `update`; their source files are already current, and `add` is the command for activating more local artifacts.

`remove` is interactive. It shows active artifacts grouped by package and artifact category, then removes selected target symlinks and prunes selected labels from `linked`. For remote Setup Releases, it also deletes the selected `.ai/` source artifacts. For local setup roots, identified by `version: "*"`, it preserves the Author's source files and only removes target-scope symlinks and manifest state.

When removing a specific package, the package argument is matched exactly against the selected scope's `ai.json` key. Global local dogfooding entries therefore use their stored relative source-root key, not `"."` aliases.

Global local dogfooding keys are not automatically migrated when an Author moves a source repository. Running `add --global .` from a new source path creates or updates the key for that path; stale keys are removed explicitly by their stored package key.

`add --global .` is invalid when run from the global target AI Setup root itself. Global local dogfooding needs a separate current working source repository so the global manifest can record a source-root package key that is not `"."`.

There is no global-scope behavior in the MVP. The command surface is limited to `add`, `update`, `remove`, and `publish`; public `link`, `check`, `sync`, and `list` are out of scope.

### Release Asset

The `ai.zip` file that authors upload to a GitHub immutable release. Contains AI Setup artifacts from `.ai/`, but excludes `.ai/ai.json` because the manifest is local installation state. The CLI always looks for an asset named exactly `ai.zip` on the resolved release tag. Only immutable releases are accepted by the CLI — non-immutable releases are rejected at install time.

### Add

The act of selecting AI Setup artifacts and making them active in the current repository. Each managed file gets its own symlink, preserving unmanaged files in the same target directories. `add` prompts for providers first and artifacts second. Skills (`.ai/skills/`) are treated as regular provider artifacts — each provider declares its own skills target (e.g. claude → `.claude/skills/`, codex → `.agents/skills/`).

### Link Conflict

A target path that cannot be linked because it is already claimed or occupied. Conflicts between remote Setup Releases block the operation before `.ai/` files or target symlinks are written. Existing real files or symlinks pointing somewhere else also block `add`; the User must remove or move the conflicting file before retrying.
_Avoid_: Overwrite, last-write-wins

Local setup roots are identified by `version: "*"`, not by a specific package key. Within one scope, remote Setup Releases may override local dogfooding links and prune the affected local `linked` entries; remote Setup Releases still conflict with other remote Setup Releases.

### Provider Registry

A static mapping built into the CLI (`src/lib/provider-registry.ts`) that declares, for each supported provider: its canonical name and its symlink rules (source path → target path). File sources map to file targets, directory sources map to directory targets, and root Project Instruction Files are represented as normal provider rules. Adding a new provider requires a CLI release.

### Install Summary

The log printed after `add` or `update` showing which files were added, replaced, or deleted — and why. Users use this alongside `git diff` to understand what changed.

### Immutability Gate

The security check run on every `add` and `update` before any files are written. The CLI fetches the release attestation from GitHub and verifies the release is immutable. If the release has no attestation or is not immutable, the command errors and nothing is written to disk.

---

## Version Model

- Versions are always **exact** in `ai.json` (e.g. `"1.2.0"`, never `"^1.0.0"`)
- `airig add yourname/setup` resolves to the latest immutable release and pins that exact version
- `airig add yourname/setup@1.2.0` installs that specific immutable release
- `airig update yourname/setup@1.3.0` bumps to that explicit immutable release
- No automatic version resolution — every version transition is a deliberate user decision

---

## Update Behaviour

Running `airig update yourname/setup@<version>`:

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
airig add <owner/repo>[@version]    # interactively install and link selected artifacts from an immutable Setup Release
airig add .                         # interactively link selected local Author artifacts
airig update <owner/repo>@<version> # refresh currently linked artifacts at an exact immutable version
airig remove [owner/repo|.]         # interactively remove active artifacts
airig publish [tag]                 # publish project .ai artifacts as immutable ai.zip
airig add --global <owner/repo>[@version]
airig add --global .
airig update --global <owner/repo>@<version>
airig remove --global [owner/repo|stored-local-key]
```

Public `link`, `check`, `sync`, and `list` are post-MVP.

---

## Release Flows

### Package Release

Maintainers run `pnpm release` to publish the `@airig/cli` npm Package. The script uses `bumpp` to choose the next Package version, update Package metadata, create the release commit, create a `v<version>` tag, and push the commit and tag.

Pushed `v*` tags trigger the `Publish Package` GitHub Actions workflow. The workflow installs with pnpm, runs the existing test command, builds the CLI, and publishes the Package to npm. npm publishing uses trusted publishing with GitHub Actions OIDC, so the repository must not carry a long-lived npm token for Package releases.

### Setup Release

Authors run `airig publish [tag]` to publish a Setup Release. This command zips the current project's `.ai/` into an immutable GitHub release asset named `ai.zip`; it does not publish the npm Package. Global AI Setups are shared by publishing the source setup repository, not by publishing `~/.ai/` directly.

---

## Author Workflow

1. Create `.ai/<provider>/` directories with skills, agents, commands, hooks
2. Run `airig add .` to wire selected `.ai/` artifacts into provider config dirs — multi-select prompt picks providers and artifacts
3. Iterate on the setup freely; rerun `add .` when adding new local artifacts
4. Tag a release and run `airig publish` to zip `.ai/` and upload as an immutable release
5. Share `airig add yourname/repo`

## User Workflow

1. Run `airig add yourname/setup` — latest immutable release is inspected in temp, selected artifacts are written to `.ai/`, and `ai.json` is created with an exact version
2. Commit `.ai/`, `ai.json` to git
3. Edit active files in `.ai/` freely to customize
4. Run `airig update yourname/setup@<version>` explicitly when ready to upgrade

---

## Useful Links

- [GitHub Immutable Releases Concepts](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [Preventing Changes to Your Releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/preventing-changes-to-your-releases)
- [Verifying the Integrity of a Release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verifying-the-integrity-of-a-release)

---

## Key Differences from `npx skills`

| Concern | `npx skills` | `airig` |
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
