# ohmyai — Implementation Guide

> Authoritative implementation reference. All decisions below were finalized in the design session. Do not deviate without updating this doc.

---

## MVP Scope

Four commands ship in v1:

| Command | Who uses it | Needs network | Needs auth |
|---|---|---|---|
| `link` | Author | No | No |
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
.ai/claude/agents/    → .claude/agents/    (per-file ownership)
.ai/claude/commands/  → .claude/commands/  (per-file ownership)
```

**Codex:**
```
.ai/codex/agents/    → .codex/agents/    (per-file ownership)
.ai/codex/commands/  → .codex/prompts/   (per-file ownership)
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
      { source: '.ai/claude/agents',   target: '.claude/agents' },
      { source: '.ai/claude/commands', target: '.claude/commands' },
    ],
  },
  codex: {
    name: 'codex',
    rules: [
      { source: '.ai/codex/agents',   target: '.codex/agents' },
      { source: '.ai/codex/commands', target: '.codex/prompts' },
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
  claude/
    agents/
    commands/
  codex/
    agents/
    commands/       ← linked to .codex/prompts/
```

---

## `ai.json` Schema

```typescript
interface AiJson {
  packages: Record<string, PackageEntry>
  ownership: Record<string, string>   // target path → "owner/repo@version"
}

interface PackageEntry {
  version: string          // always exact, e.g. "1.2.0"
  exclude?: string[]       // paths relative to .ai/, e.g. ["skills/python-pro.md"]
}
```

Example:
```json
{
  "packages": {
    "yourname/setup": {
      "version": "1.2.0",
      "exclude": ["skills/python-pro.md", "claude/agents/"]
    }
  },
  "ownership": {
    ".claude/agents/reviewer.md": "yourname/setup@1.2.0",
    ".agents/skills/tdd/SKILL.md": "yourname/setup@1.2.0"
  }
}
```

**Rules:**
- `ownership` is written and owned by `add`/`remove`. Never written by `link`.
- Versions are always exact — no semver ranges.
- Immutability is always verified online via the GitHub API — on every `add` and `remove`. No offline attestation cache.

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

### `link <provider>`

**Purpose:** Author's primary command. Wires `.ai/` into provider config dirs via per-file ownership. Fully local — no network, no `ai.json` reads or writes.

**Behavior:**
1. Validate `provider` is in `PROVIDER_REGISTRY` — error if unknown
2. For each rule in `PROVIDER_REGISTRY[provider].rules` + `SKILLS_RULE`:
   - Walk source dir (e.g. `.ai/claude/agents/`)
   - For each file found, create a symlink: `<target>/<filename>` → `<source>/<filename>`
   - Create target dir if it doesn't exist
   - If symlink already exists and points to the correct source: skip (idempotent)
   - If symlink already exists and points elsewhere: warn, skip (do not overwrite)
   - If a real file (not symlink) exists at the target path: warn, skip
3. Print summary: linked N files, skipped M

**Key design decisions:**
- Per-file ownership, not directory-level — preserves unmanaged files in target dirs
- `link` never touches `ai.json` — it is `ai.json`-agnostic
- Idempotent — safe to run repeatedly
- Skills are always linked regardless of provider argument (shared, provider-agnostic)

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

**Purpose:** Consumer command. Downloads an immutable release, writes files to `.ai/`, creates ownership, updates `ai.json`.

**Behavior:**
1. If no `@version`, resolve latest immutable release via GitHub API
2. **Immutability gate:** verify release is immutable via GitHub API — error and exit if not
3. Download `ai.zip` asset
4. Extract to temp dir, inspect contents
5. **Skills flattening** — process `.ai/skills/` from the extracted zip using SKILL.md-presence detection (see ADR-008): recursively find every directory containing a `SKILL.md`, then write each such skill dir to `.ai/skills/<dirname>/` in the consumer repo, stripping all ancestor category directories. Non-skills content (`.ai/claude/`, `.ai/codex/`, etc.) is written verbatim.
6. Interactive selection — user picks which subdirs/files to include; deselected items written to `exclude` list
7. Conflict check — for each selected file, check `ai.json` ownership map; error if already owned by another package
8. Write files from temp dir into `.ai/`
9. Create per-file ownership into provider config dirs (runs link logic internally)
10. Update `ai.json` — add package entry + update ownership map
11. Print install summary
12. Clean up temp dir

---

### `remove <owner/repo>`

**Purpose:** Consumer command. Removes a package's files from `.ai/`, deletes its ownership, updates `ai.json`.

**Behavior:**
1. Look up package in `ai.json` — error if not found
2. Remove all ownership owned by this package (from `ownership` map)
3. Delete package files from `.ai/`
4. Remove package entry from `ai.json`
5. Print removal summary

**Note:** Atomic — `ai.json` is updated in the same operation as file deletion.

---

## Architecture Decision Records

### ADR-001: Per-file ownership over directory-level ownership

**Decision:** `link` creates one symlink per file, not one symlink per subdirectory.

**Why:** Directory-level ownership replace the entire target directory, destroying any unmanaged files the author has placed there. Per-file ownership allow `ohmyai`-managed files and user-authored files to coexist in the same target dir. Also required for meaningful conflict detection — you can't detect which file conflicts at a directory level.

---

### ADR-002: Skills live at `.ai/skills/` (provider-agnostic top-level)

**Decision:** Skills are not nested under `.ai/<provider>/skills/` — they live at `.ai/skills/` and are shared across providers.

**Why:** Multiple providers (claude, codex, and future providers) all read from `.agents/skills/`. If skills were per-provider, `link claude` and `link codex` would both try to create `.agents/skills/ → .ai/<provider>/skills/` — a directory symlink conflict. A shared `.ai/skills/` source avoids this entirely and is honest: skills are provider-agnostic Markdown files.

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

### ADR-007: `link` is `ai.json`-agnostic

**Decision:** `link` never reads or writes `ai.json`. The `ownership` map in `ai.json` is owned exclusively by `add`/`remove`.

**Why:** `link` is the author's wiring command — authors run it before any package management exists. If `link` wrote to `ai.json`, it would create "local"-owned symlink entries that have no package semantics, polluting the conflict detection system. Clean separation: `link` = file system wiring, `ai.json` = package ownership tracking.

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
