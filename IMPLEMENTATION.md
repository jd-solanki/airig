# ohmyai — Implementation Guide

> Authoritative implementation reference. All decisions below were finalized in the design session. Do not deviate without updating this doc.

---

## MVP Scope

Four commands ship in v1:

| Command | Who uses it | Needs network | Needs auth |
|---|---|---|---|
| `link` | Author, Consumer | No | No |
| `publish` | Author | Yes (GitHub API) | Yes (`GITHUB_TOKEN`) |
| `add` | Consumer | Yes (GitHub API) | No (public repos) |
| `remove` | Consumer | No | No |

`check`, `update`, `sync` are post-MVP.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| CLI framework | commander |
| Build tool | tsdown |
| GitHub API | @octokit/rest |
| Zip creation | archiver |
| Zip extraction | extract-zip |
| Interactive prompts | @inquirer/prompts |
| Runtime | Node.js (`"type": "module"`) |

`package.json` essentials:
```json
{
  "name": "ohmyai",
  "type": "module",
  "bin": { "ohmyai": "./dist/index.js" }
}
```

---

## Project Structure

```
src/
  index.ts                  ← creates Commander program, registers all commands
  commands/
    link.ts                 ← exports linkCommand: Command
    publish.ts              ← exports publishCommand: Command
    add.ts                  ← exports addCommand: Command
    remove.ts               ← exports removeCommand: Command
  lib/
    provider-registry.ts    ← static mapping: provider → symlink rules
    github.ts               ← all @octokit/rest calls
    ai-json.ts              ← read/write/validate ai.json
    zip.ts                  ← create (archiver) + extract (extract-zip)
    linker.ts               ← per-file symlink creation and removal
```

### Commander pattern

Each command file exports a `Command` instance. `index.ts` is a thin registrar:

```typescript
// src/commands/link.ts
import { Command } from 'commander'

export const linkCommand = new Command('link')
  .description('Symlink .ai/ files into provider config directories')
  .argument('<provider>', 'Provider to link: claude | codex')
  .action(async (provider: string) => {
    // implementation
  })
```

```typescript
// src/index.ts
#!/usr/bin/env node
import { Command } from 'commander'
import { linkCommand } from './commands/link.js'
import { publishCommand } from './commands/publish.js'
import { addCommand } from './commands/add.js'
import { removeCommand } from './commands/remove.js'

const program = new Command('ohmyai')
  .description('Distribute and manage AI setups across providers')

program.addCommand(linkCommand)
program.addCommand(publishCommand)
program.addCommand(addCommand)
program.addCommand(removeCommand)

program.parse()
```

---

## Provider Registry

Defined in `src/lib/provider-registry.ts` as a static TypeScript object. Adding a new provider requires a CLI release.

### Resolved mappings (MVP)

**Shared (provider-agnostic):**
```
.ai/skills/   → .agents/skills/   (per-file ownership)
```

**Claude:**
```
.ai/.claude/agents/    → .claude/agents/    (per-file ownership)
.ai/.claude/commands/  → .claude/commands/  (per-file ownership)
```

**Codex:**
```
.ai/.codex/agents/    → .codex/agents/    (per-file ownership)
.ai/.codex/commands/  → .codex/prompts/   (per-file ownership)
```

### Registry shape

```typescript
export interface SymlinkRule {
  source: string   // relative to repo root, e.g. '.ai/skills'
  target: string   // relative to repo root, e.g. '.agents/skills'
}

export interface ProviderEntry {
  name: string
  rules: SymlinkRule[]
}

export const PROVIDER_REGISTRY: Record<string, ProviderEntry> = {
  claude: {
    name: 'claude',
    rules: [
      { source: '.ai/.claude/agents',   target: '.claude/agents' },
      { source: '.ai/.claude/commands', target: '.claude/commands' },
    ],
  },
  codex: {
    name: 'codex',
    rules: [
      { source: '.ai/.codex/agents',   target: '.codex/agents' },
      { source: '.ai/.codex/commands', target: '.codex/prompts' },
    ],
  },
}

// Skills are provider-agnostic — always linked regardless of provider argument
export const SKILLS_RULE: SymlinkRule = {
  source: '.ai/skills',
  target: '.agents/skills',
}
```

---

## `.ai/` Directory Structure

```
.ai/
  ai.json
  skills/           ← provider-agnostic; linked to .agents/skills/ per-file
  .claude/
    agents/
    commands/
  .codex/
    agents/
    commands/       ← linked to .codex/prompts/
```

---

## `ai.json` Schema

```typescript
interface AiJson {
  packages: Record<string, PackageEntry>
  ownership: Record<string, string>   // symlink target path → "owner/repo@version" | ".ai/-relative source path"
}

interface PackageEntry {
  version: string          // exact version e.g. "1.2.0", or "*" for the local "." package
  exclude?: string[]       // paths relative to .ai/, e.g. ["skills/python-pro.md"]
}
```

Package keys are either `"owner/repo"` (remote package) or `"."` (local package — the author's own `.ai/` directory). The `"."` key uses `version: "*"` as a sentinel meaning "always current, no pinning." The `exclude` list on `"."` allows selective linking — specific files or subdirs the author wants to skip.

Example:
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

**Rules:**
- Ownership keys are symlink target paths (e.g. `.claude/agents/reviewer.md`).
- Ownership values are one of two forms:
  - `"owner/repo@version"` — written by `add` for remote package symlinks
  - `".ai/relative/source/path"` — written by `link` for local symlinks; the explicit path lets any reader trace exactly what the symlink points to
- `add` treats `.ai/`-prefixed entries as overwriteable — warns the user and replaces the entry with the package value.
- Versions are always exact for remote packages — no semver ranges. `"*"` is only valid for the `"."` local package.
- Immutability is always verified online via the GitHub API — on every `add`. No offline attestation cache.

---

## GitHub Authentication

| Command | Token required |
|---|---|
| `link` | No |
| `remove` | No |
| `add` | No (public repos, unauthenticated API) |
| `publish` | Yes — `GITHUB_TOKEN` env var |

`publish` reads `process.env.GITHUB_TOKEN`. If absent, it exits with a clear error:
```
✖ GITHUB_TOKEN is not set. Export it before running publish.
  export GITHUB_TOKEN=ghp_...
```

No `gh` CLI dependency anywhere in the codebase.

---

## Command Specifications

### `link [provider]`

**Purpose:** Wires `.ai/` into provider config dirs via per-file symlinks. Fully local — no network. Writes to `ai.json` — exact behaviour depends on the caller: standalone invocations write the `"."` package entry and `.ai/`-relative source path ownership entries; when called internally by `add` with an `ownershipValue`, writes package-owned entries only and skips `packages["."]` handling entirely.

**Behavior:**
1. If `[provider]` is omitted, show a multi-select prompt listing all registered providers — user selects one or more
2. If `[provider]` is given, validate it is in `PROVIDER_REGISTRY` — error if unknown
3. For each selected provider, for each rule in `PROVIDER_REGISTRY[provider].rules` + `SKILLS_RULE`:
   - Walk source dir (e.g. `.ai/.claude/agents/`)
   - For each file found, create a symlink: `<target>/<filename>` → `<source>/<filename>`
   - Create target dir if it doesn't exist
   - If symlink already exists and points to the correct source: skip (idempotent)
   - If symlink already exists and points elsewhere: warn, skip (do not overwrite)
   - If a real file (not symlink) exists at the target path: warn, skip
4. Write ownership entries for each symlink created. Behaviour depends on whether an `ownershipValue` was passed by the caller:
   - **Standalone (no `ownershipValue`):** ensure `packages["."]` entry exists in `ai.json` with `version: "*"` (create `ai.json` if absent); skip files matching the `exclude` list on `packages["."]` if present; write `".ai/<relative-source-path>"` as the ownership value for each symlink
   - **Called by `add` (with `ownershipValue`):** write the provided value (e.g. `"owner/repo@version"`) as the ownership entry for each symlink; skip `packages["."]` handling and the exclude list entirely
5. Print summary: linked N files, skipped M

**Key design decisions:**
- Provider argument is optional — omitting it opens multi-select so users can wire multiple providers in one run
- Per-file symlinks, not directory-level — preserves unmanaged files in target dirs
- Uses `"."` as the local package key (with `version: "*"` and optional `exclude`) so the `packages` section uniformly lists all managed setups; `remove "."` identifies local entries by their `.ai/`-prefixed ownership value
- Idempotent — safe to run repeatedly
- Skills (`.ai/skills/`) are always linked regardless of which providers are selected

---

### `publish [tag]`

**Purpose:** Author's release command. Packages `.ai/` into `ai.zip`, creates an immutable GitHub release.

**Behavior:**
1. Require `GITHUB_TOKEN` — error if absent
2. Resolve tag: if `[tag]` not provided, detect latest local git tag
3. Detect `owner/repo` from `git remote get-url origin`
4. Zip `.ai/` (and `.ai.global/` if it exists) into `ai.zip` using `archiver`
5. Create draft release on GitHub via `@octokit/rest`: `POST /repos/{owner}/{repo}/releases` with `draft: true, tag_name: tag`
6. Upload `ai.zip` as release asset to the draft
7. Publish the release: `PATCH /repos/{owner}/{repo}/releases/{id}` with `draft: false`
8. Print release URL

**Notes:**
- Author tags first (using `bumpp` or any tagging tool) before running `publish`
- The CLI owns the GitHub release lifecycle (draft → attach → publish), not the git tag
- Immutability is enforced at the GitHub repo settings level ("Enable release immutability") — not a per-release API parameter

---

### `add <owner/repo>[@version]`

**Purpose:** Consumer command. Downloads an immutable release, writes files to `.ai/`, runs the `link` interactive flow, and updates `ai.json` with exact version and symlink ownership.

**Behavior:**
1. If no `@version`, resolve latest immutable release via GitHub API
2. **Immutability gate:** verify release is immutable via GitHub API — error and exit if not
3. Download `ai.zip` asset
4. Extract to temp dir, inspect contents
5. **Skills flattening** — process `.ai/skills/` from the extracted zip using SKILL.md-presence detection (see ADR-008): recursively find every directory containing a `SKILL.md`, then write each such skill dir to `.ai/skills/<dirname>/` in the consumer repo, stripping all ancestor category directories. Non-skills content (`.ai/.claude/`, `.ai/.codex/`, etc.) is written verbatim.
6. **Artifact selection** — user picks which subdirs/files to include; deselected items written to `exclude` list
7. **Provider selection** — multi-select prompt listing all registered providers; user picks which to wire
8. **Conflict check** — for each selected artifact × selected provider, compute target symlink path, check against `ai.json` ownership map:
   - **Package-owned entry** (value = `"owner/repo@version"`) → error with conflict report before writing anything
   - **Locally-managed entry** (value starts with `.ai/`) → warn the user ("previously locally-managed, now owned by `owner/repo@version`") and proceed; the entry will be overwritten at step 10
9. Write files from temp dir into `.ai/`
10. Run link for selected providers, passing `"owner/repo@version"` as the `ownershipValue` — link creates symlinks and writes package-owned entries directly to `ai.json`
11. Update `ai.json` — add package entry (version + exclude list); ownership entries are already written by step 10
12. Print install summary: files added to `.ai/`, symlinks created (per provider), files skipped (excluded), locally-managed entries overwritten with a warning (if any), conflicts that blocked the install (if any)
13. Clean up temp dir

---

### `remove <owner/repo|.>`

**Purpose:** Uninstalls a package — removes its symlinks from provider config dirs, optionally deletes its files from `.ai/`, and cleans up `ai.json`. Accepts either a remote package key (`owner/repo`) or the local package key (`.`). No network calls required.

**Behavior:**
1. Look up the package key in `ai.json` — error if not found
2. Collect all owned symlink target paths from `ownership`:
   - **Remote packages (`owner/repo`):** entries where value = `"owner/repo@version"` for this package
   - **Local package (`"."`):** entries where value starts with `.ai/`
3. Delete each collected symlink from its target path (e.g. `.claude/agents/reviewer.md`, `.codex/prompts/foo.md`, `.agents/skills/tdd/SKILL.md`)
4. **Remote packages only:** delete the package's files from `.ai/`
5. **Local package (`"."`):** skip file deletion — `.ai/` files are the author's own; only symlinks are removed
6. Remove the package entry and all its ownership entries from `ai.json`
7. Print removal summary: symlinks removed, files deleted (remote only)

**Operation order:** symlinks → files (remote only) → `ai.json`. If interrupted before `ai.json` is written, the files and symlinks are already gone; re-running `remove` will find no ownership entries for the missing symlinks and exit cleanly.

---

## Architecture Decision Records

### ADR-001: Per-file ownership over directory-level ownership

**Decision:** `link` creates one symlink per file, not one symlink per subdirectory.

**Why:** Directory-level ownership replace the entire target directory, destroying any unmanaged files the author has placed there. Per-file ownership allow `ohmyai`-managed files and user-authored files to coexist in the same target dir. Also required for meaningful conflict detection — you can't detect which file conflicts at a directory level.

---

### ADR-002: Skills live at `.ai/skills/` (provider-agnostic top-level)

**Decision:** Skills are not nested under `.ai/<provider_directory>/skills/` — they live at `.ai/skills/` and are shared across providers.

**Why:** Multiple providers (claude, codex, and future providers) all read from `.agents/skills/`. If skills were per-provider, `link claude` and `link codex` would both try to create `.agents/skills/ → .ai/<provider_directory>/skills/` — a directory symlink conflict. A shared `.ai/skills/` source avoids this entirely and is honest: skills are provider-agnostic Markdown files.

---

### ADR-003: No `gh` CLI dependency

**Decision:** `ohmyai` uses `@octokit/rest` directly for all GitHub API calls. No runtime dependency on the `gh` CLI.

**Why:** `gh` CLI is not guaranteed to be installed on consumer machines. Adding a runtime dependency on another CLI tool creates a fragile install experience and a hard-to-debug failure mode. `@octokit/rest` covers the full release API surface we need and is a proper npm dependency.

---

### ADR-004: Always-online immutability verification

**Decision:** Immutability is verified via live GitHub API call on every `add` and `sync`. No attestation digest is cached in `ai.json` for offline use.

**Why:** Offline verification using a cached digest is weaker than online verification — it only proves the release was immutable at install time, not that it still is. Always-online verification catches any post-install tampering. The security gain outweighs the network cost. Consumers without network access can't `add` anyway.

---

### ADR-005: Author tags first, `publish` owns the release lifecycle

**Decision:** Authors create and push git tags independently (using `bumpp` or any tool). `npx ohmyai publish [tag]` then creates the GitHub release from that tag.

**Why:** Tagging is a git operation with its own tooling ecosystem (bumpp, standard-version, etc.). The CLI should own GitHub release creation, not git history. Separating the two keeps the blast radius of `publish` limited to GitHub releases — a destructive git operation (wrong tag, force-push) is never triggered by the CLI.

---

### ADR-006: `GITHUB_TOKEN` required only for `publish`

**Decision:** Consumer commands (`add`, `check`, `sync`) make unauthenticated GitHub API calls. Only `publish` requires `GITHUB_TOKEN`.

**Why:** GitHub's API allows unauthenticated reads on public repos (60 req/hour — sufficient for package install workflows). Requiring a token for consumers adds friction with no security benefit for public packages. Authors already need a token for write access; `GITHUB_TOKEN` is the universal convention for this.

---

### ADR-007: `link` writes `"."` package entry and explicit source paths to `ai.json`

**Decision:** `link` writes a `packages["."]` entry (`version: "*"`, optional `exclude`) to `ai.json` and records the explicit `.ai/`-relative source path as the ownership value for each symlink (e.g. `".claude/agents/reviewer.md": ".ai/.claude/agents/reviewer.md"`). It creates `ai.json` if absent.

**Why:** The `"."` package key (mirroring how pnpm workspaces treat the root) makes `packages` the uniform list of all managed setups — local and remote — so consumers can see at a glance what is installed. The `exclude` list on `"."` enables selective linking: the author can skip specific files without unlinking everything. Ownership values remain explicit source paths (not a package reference like `".@*"`) so any reader can trace exactly what each symlink points to without resolving the package. `add` distinguishes local entries from remote ones by the `.ai/` prefix and treats them as overwriteable with a warning. `remove "."` deletes symlinks for all entries whose ownership value starts with `.ai/` — no separate local-entry registry needed.

---

### ADR-008: SKILL.md-presence detection for skills flattening on `add`/`update`

**Decision:** When `add` or `update` processes the `.ai/skills/` subtree from an extracted `ai.zip`, it uses SKILL.md-presence detection rather than depth-based heuristics. The algorithm: recursively walk the extracted `.ai/skills/` directory and identify every directory that directly contains a `SKILL.md` file. Each such directory is a "skill dir". Its entire contents are written to `.ai/skills/<dirname>/` in the consumer repo, with all ancestor category directories stripped.

Examples of how source structures flatten:
```
# Flat (1-level)
skills/diagnose/SKILL.md          → .ai/skills/diagnose/SKILL.md

# One category deep (mattpocock style)
skills/engineering/diagnose/SKILL.md  → .ai/skills/diagnose/SKILL.md

# Multiple categories deep
skills/a/b/c/diagnose/SKILL.md    → .ai/skills/diagnose/SKILL.md
```

Collision rule: if two skill dirs within the same package share the same `dirname` (e.g. `engineering/auth/` and `security/auth/`), `add` errors before writing anything — skill names must be unique within a package.

**Why:** The `npx skills` CLI only walks 2 levels deep, which locks out authors who use deeper nesting (sub-subcategories, monorepos with extra wrapper dirs, etc.). SKILL.md-presence detection is depth-agnostic: it makes no assumption about how authors organise their source repo. The skill name (dirname) is the only identity that matters to consumers and agents. Flattening on `add`/`update` means `link` stays simple — it always sees a flat `.ai/skills/` and never needs to know about the author's source layout.

---

### ADR-009: `link` provider argument is optional with interactive multi-select fallback

**Decision:** `link [provider]` — if no provider is given, a multi-select prompt lists all registered providers and the user picks one or more. If a provider name is given directly, it links that provider without prompting.

**Why:** The single-provider argument form is convenient for scripting and for authors who know exactly what they want. The interactive fallback removes the need to know provider names upfront — especially useful at the end of `add` where a first-time consumer may not know which providers to wire. Combining both in one command avoids a separate `link --interactive` flag or a second command.

---

### ADR-010: `add` triggers the `link` interactive flow as its final step

**Decision:** After writing files to `.ai/`, `add` triggers the `link` multi-select prompt so the consumer can wire their chosen providers immediately, in the same command invocation.

**Why:** A consumer who runs `add` almost always wants to wire the installed setup straight away. Requiring a separate `link` invocation adds a step that is easily forgotten, leaving the consumer wondering why their AI tool doesn't see the new files. Embedding the `link` flow at the end of `add` makes the full install a single interaction. Because `link` is idempotent, running it again later is harmless.
