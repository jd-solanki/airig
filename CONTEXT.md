# ohmyai — Domain Context

## What It Is

`ohmyai` is a CLI tool (`npx ohmyai`) for distributing and managing entire AI setups across providers (Claude Code, Codex, Copilot, Gemini, OpenCode, etc.). It fills the gap left by `npx skills`, which only distributes `SKILL.md` files and requires manual installation of agents, commands, and hooks.

## Core Insight

Authors dogfood their own setup before sharing it. They place their AI setup in `.ai/`, run `npx ohmyai link` to wire it up in their own repo, then cut a GitHub release to share it. Users install it with one command and stay current via explicit version bumps.

---

## Glossary

### Author
The person or organization that creates an AI Setup and publishes it as a Setup Release.
_Avoid_: Setup owner, publisher

### User
The person who downloads an Author's Setup Release and uses it in their own repository.
_Avoid_: Consumer, installer

### AI Setup
The complete collection of AI configuration artifacts for one or more providers — project instruction files, skills, agents, custom commands, hooks. Stored in the `.ai/` directory and distributed as a Setup Release when published.

### Project Instruction File
A root-level AI Setup artifact that coding agents and IDEs read to understand how to work in a repository. `AGENTS.md` is the broadly supported filename; `CLAUDE.md` is the Claude-recognized filename and may either share the same guidance or carry Claude-specific guidance.
_Avoid_: Cloud.md

### Instruction Target
A provider-recognized root filename where a Project Instruction File is exposed in the user repository. Multiple Instruction Targets can expose shared or provider-specific guidance to different coding agents.
_Avoid_: Provider instruction, duplicate instruction file

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

### `ai.json`
The single manifest file for project scope. Lives at `.ai/ai.json`. Declares which Setup Releases are downloaded at which exact versions and which downloaded artifacts are linked. Active ownership is derived from each package's `linked` list and the Provider Registry instead of being stored as a separate map.

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

Manifest keys are either `"owner/repo"` (remote Setup Release) or `"."` (local AI Setup — the author's own `.ai/` directory, written by `link`). The `"."` key uses `version: "*"` as a sentinel meaning "always current, no pinning." Both local and remote entries use the same `linked` list of source artifact labels — `.ai/`-relative artifacts that should be wired into provider target paths.

**Versions are always exact** for remote Setup Releases — no semver ranges. The CLI pins the exact version on `add` and only moves it on an explicit `update` command. `"*"` is only valid for the `"."` local AI Setup.

Immutability is always verified online via the GitHub API — on every `add` and `update`. No offline attestation cache.

The `linked` list is written by the CLI after interactive selection during `link`. `add` downloads Setup Release content into `.ai/`, creates or updates the local `.ai/ai.json` entry for the downloaded Setup Release with an initially empty `linked` list, then invokes `link` to decide which downloaded artifacts are wired.

### Interactive Selection
The CLI prompt that lets users pick which artifact subdirectories and individual files to keep linked. Selected items are written to the `linked` list in `ai.json`. Users never edit the linked list manually — the CLI owns it.

### Command Interaction Model
`add` downloads all artifacts from a Setup Release into `.ai/`, writes the local manifest entry, then automatically invokes `link` so users choose which downloaded artifacts to keep wired. If that Setup Release is already downloaded, `add` errors and points the user to `link`, `update`, or `remove`. When a command needs both provider and artifact choices, provider selection comes first and artifact selection comes second. `link` is interactive when needed — checked artifacts are kept linked, newly checked artifacts are linked, and newly unchecked artifacts have only their target symlinks removed. `remove` is non-interactive and removes an entire installed Setup Release, including its downloaded files from `.ai/` and its owned links. `remove .` unlinks all local AI Setup artifacts and removes the `"."` manifest entry, but leaves `.ai/` source files untouched. `update` is explicit — requires a version argument, refreshes downloaded content, reconciles symlinks for artifacts still in the user's `linked` list, removes deleted upstream artifacts from `linked`, does not link newly-added upstream artifacts, never auto-resolves, and never prompts.

There is no global-scope behavior in the MVP. The command surface is limited to `add`, `link`, `update`, `remove`, and `publish`; `check`, `sync`, and `list` are out of scope.

### Release Asset
The `ai.zip` file that authors upload to a GitHub immutable release. Contains AI Setup artifacts from `.ai/`, but excludes `.ai/ai.json` because the manifest is local installation state. The CLI always looks for an asset named exactly `ai.zip` on the resolved release tag. Only immutable releases are accepted by the CLI — non-immutable releases are rejected at install time.

### Link
The act of reconciling which downloaded AI Setup artifacts are symlinked into provider target paths. Each managed file gets its own symlink, preserving any unmanaged files in the same target directories. Run via `npx ohmyai link [provider]` — if no provider is given, a multi-select prompt lets the user pick one or more providers to wire, then choose which artifacts stay linked. Checked artifacts are linked, newly checked artifacts are linked, and newly unchecked artifacts have only their target symlinks removed; the source files remain in `.ai/`. No network, no release verification. Skills (`.ai/skills/`) are always considered regardless of which providers are selected. Also triggered automatically at the end of `add`.

### Link Conflict
A target path that cannot be linked because it is already claimed or occupied. Conflicts between remote Setup Releases block the operation before files are written; locally-managed links can be taken over by a remote Setup Release with a warning. Existing real files or symlinks pointing somewhere else are skipped rather than overwritten.
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
- Replaces files that exist in the new release
- Downloads files new to the release into `.ai/` without linking them
- Deletes files removed from the release, removes their target symlinks if linked, and prunes them from the package's `linked` list
- Preserves files in `.ai/` that are not part of the Setup Release (user-added files)
- Reconciles symlinks for artifacts that remain in the package's `linked` list
- Prints an update summary after reconciliation
- User uses `git diff` to review and recover any customizations

---

## v1 Command Surface

```
npx ohmyai add <owner/repo>[@version]    # download immutable ai.zip into .ai/, create ai.json entry, then run link
npx ohmyai link [provider]               # reconcile selected .ai artifacts into provider target paths
npx ohmyai update <owner/repo>@<version> # refresh downloaded content at an exact immutable version
npx ohmyai remove <owner/repo|.>         # remove a Setup Release, or unlink local "." while preserving .ai sources
npx ohmyai publish [tag]                 # publish project .ai artifacts as immutable ai.zip
```

`check`, `sync`, `list`, and global scope are post-MVP.

---

## Author Workflow

1. Create `.ai/<provider>/` directories with skills, agents, commands, hooks
2. Run `npx ohmyai link` to wire `.ai/` into provider config dirs — multi-select prompt picks providers (local only — no GitHub involved)
3. Iterate on the setup freely; `link` keeps it live in the provider
4. Tag a release and run `npx ohmyai publish` to zip `.ai/` and upload as an immutable release
5. Share `npx ohmyai add yourname/repo`

## User Workflow

1. Run `npx ohmyai add yourname/setup` — latest immutable release written to `.ai/`, `ai.json` created with exact version; multi-select provider prompt wires chosen providers immediately
2. Commit `.ai/`, `ai.json` to git
3. Edit files in `.ai/` freely to customize
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
| Author dogfooding | Author cannot use own skills repo (bootstrapping problem) | Author runs `link` to use own setup immediately (local, no GitHub) |
| Agents, commands, hooks | Manual copy | First-class, distributed automatically |
