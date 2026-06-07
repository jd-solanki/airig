# npx skills CLI — Versioning Research

> _NOTE: This document is for `skills.sh CLI` and not for `airig`_

Reference document for designing a competing tool. Based on analysis of the
`vercel-labs/skills` source code (v1.5.9, released 2026-05-27), the local
`skills-lock.json`, and open issues/security disclosures as of May 2026.

---

## 1. What the CLI Is

`npx skills` (npm package `skills`, source at `github.com/vercel-labs/skills`) is a
package manager for AI agent "skill" files — Markdown instructions placed in
agent config directories (`.claude/skills/`, `.agents/skills/`, etc.). It supports
50+ agents (Claude Code, Cursor, Codex, Copilot, Windsurf, etc.).

The distribution unit is a single `SKILL.md` file with YAML frontmatter (`name` +
`description` required). Agents, commands, hooks, and MCP config are **not**
distributed by the CLI — they must be copied manually.

---

## 2. How Skill Fetching Works

The CLI has two fetch paths for GitHub sources. It tries the fast path first and
falls back to git clone.

### 2a. Fast path — Blob download via skills.sh API (primary)

1. Call `https://api.github.com/repos/<owner>/<repo>/git/trees/HEAD?recursive=1`
   to get the full repo tree without cloning (unauthenticated; 60 req/hr per IP).
2. Walk the tree to find `SKILL.md` files up to 3 levels deep under known prefixes
   (`skills/`, `skills/<category>/`, agent-specific dirs, etc.).
3. Fetch each `SKILL.md` from `raw.githubusercontent.com` to parse frontmatter and
   get the skill name/slug.
4. Fetch full skill file contents from `https://skills.sh/api/download/<owner>/<repo>/<slug>`.
   This is a **Vercel-hosted CDN cache** — not a direct GitHub fetch.
5. Write files to the target agent directory.

If any download from `skills.sh/api/download` fails, the entire blob path aborts
and the fallback kicks in.

### 2b. Fallback — git clone (shallow)

```
git clone --depth 1 [--branch <ref>] <url> /tmp/skills-XXXXX
```

- `simple-git` library, 5-minute timeout (configurable via `SKILLS_CLONE_TIMEOUT_MS`).
- Clones the default branch (or an explicit `ref` from a `#fragment` in the URL).
- Skill folders are copied out of the temp dir, then the temp dir is deleted.
- git-lfs is deliberately disabled (`GIT_LFS_SKIP_SMUDGE=1`, `filter.lfs.*` overrides)
  to avoid failures on repos that use LFS for non-skill assets.

### 2c. Source formats supported

| Input | What happens |
|---|---|
| `owner/repo` | Clones `https://github.com/owner/repo.git` |
| `owner/repo@skill-name` | Filters to a single skill by name |
| `owner/repo/path/to/skill` | Limits discovery to that subpath |
| `owner/repo#branch@skill` | Checks out a specific branch |
| Full GitHub URL | Same as shorthand |
| GitLab URL | Supported via direct git clone |
| Local `./path` | Copies from disk |
| `https://example.com` (non-GitHub/GitLab) | Fetches `/.well-known/agent-skills/index.json` |

---

## 3. Versioning Mechanism

### 3a. No semantic versioning, no releases

The CLI has **no concept of tagged releases, semver ranges, or version pinning for
skill packages**. There is no `package.json`-equivalent for skills. A source like
`owner/repo` always resolves to the HEAD of the default branch at the moment of
installation (or the specific `ref` fragment if provided).

### 3b. Hash-based change detection (not pinning)

The CLI tracks two different hashes for update detection:

**Global lock** (`~/.agents/.skill-lock.json`, schema v3):

- `skillFolderHash` — the GitHub Trees API **tree SHA** for the skill's folder. This
  is a Git object SHA, not a content hash. It changes when any file in the folder
  changes upstream.
- Stores `installedAt` / `updatedAt` timestamps, `sourceUrl`, optional `ref`,
  optional `skillPath`.

**Project lock** (`skills-lock.json` in cwd, schema v1):

- `computedHash` — a **SHA-256** computed locally from the actual file contents on
  disk (sorted by relative path for determinism).
- Stores `source`, `sourceType`, `skillPath`, no timestamps (intentionally, to
  minimise merge conflicts).

Both locks record _what was installed and from where_, not _what version was requested_.
There is no way to say "I want `diagnose` at commit `abc123` forever" — only
"I installed `diagnose` from `mattpocock/skills`, and its folder SHA at install time
was `xyz`."

### 3c. The local `skills-lock.json` in this repo

```json
{
  "version": 1,
  "skills": {
    "diagnose": {
      "source": "mattpocock/skills",
      "sourceType": "github",
      "skillPath": "skills/engineering/diagnose/SKILL.md",
      "computedHash": "15939a26f86edec2d4862042b8564e5a062cb81d..."
    }
  }
}
```

The `computedHash` is the SHA-256 of the skill folder's contents **on disk** at
install time. It is used by `npx skills check` to detect drift — if the upstream
folder SHA differs from the stored hash, the skill is reported as out of date.

---

## 4. Update Behaviour

### 4a. `npx skills check` / `npx skills update`

**Global scope (`-g`):**

1. Reads `~/.agents/.skill-lock.json`.
2. Groups skills by source repo to minimise GitHub API calls.
3. Fetches the current repo tree via GitHub Trees API.
4. Compares `skillFolderHash` (tree SHA) per skill against stored hash.
5. For each changed skill, re-runs `npx skills add <sourceUrl> -g -y` as a subprocess.

**Project scope (default):**

1. Reads `skills-lock.json` from cwd.
2. For each source, does a `git clone --depth 1` to discover currently-available skills.
3. Checks for upstream deletions (prompts user).
4. For each skill with a recorded `skillPath`, re-runs `npx skills add <source> --skill <name> -y`.

Skills installed with older CLI versions that lack a `skillPath` entry **cannot be
updated automatically** and must be manually reinstalled.

### 4b. No `npx skills install` / `npx skills sync` (as of v1.5.9)

There is **no command to restore all skills from the lockfile on a fresh machine**.
`npx skills update` only updates already-installed skills — it silently exits if
skills are not present on disk. This is a known open issue (GitHub issue #549, #283).

The `sync` command does exist but only for `node_modules`-sourced skills (npm
packages that ship `SKILL.md` files) — it crawls `node_modules` and installs into
agent dirs. It does not restore from `skills-lock.json`.

### 4c. Update is always "latest HEAD"

When an update runs, it fetches whatever is currently at HEAD (or the stored `ref`).
If you want to stay on a specific commit, you must encode the commit SHA as a `#ref`
fragment in the source URL — but the CLI does not write this automatically. There is
no equivalent of `npm ci` (install exactly the locked version).

---

## 5. Known Limitations

### 5a. No version pinning / no semver

- `owner/repo` always means "latest HEAD". If a skill author makes a breaking change,
  it silently rolls out to all users who next run `update`.
- No way to express "I want version `^1.0` of this skill package."
- No way to lock to a specific commit hash via the normal CLI interface.

### 5b. No restore-from-lockfile command

- `skills-lock.json` exists but there is no `npx skills install` to hydrate it on a
  fresh checkout.
- Teams cannot onboard by just running a single command after cloning.
- CI environments cannot reproduce a known-good skill set.
- (Feature requested: issues #549, #283.)

### 5c. `remove` does not update the lockfile

Running `npx skills remove <name>` removes the files from disk but does not delete
the entry from `skills-lock.json` or `~/.agents/.skill-lock.json`. The lockfile
diverges from reality silently.

### 5d. Broken project-level check/update (fixed in recent versions, was a bug)

Before recent patches (issue #542), `npx skills check` and `npx skills update` were
hardcoded to read only the global lock file and silently ignored project-level
`skills-lock.json`. Users installing project-scoped skills saw "No skills tracked."

Additionally, when the global lock schema version bumped (v1/v2 → v3), `readSkillLock()`
silently discarded all existing entries with no migration or warning — total silent
data loss on upgrade.

### 5e. No conflict detection

If two different packages install a skill with the same name, the second write wins
("last-write-wins"). There is no mechanism to detect or warn about conflicts.

### 5f. Installation scope confusion (project vs. global)

- `npx skills add` (no `-g`) installs to the **project** directory by default.
- `npx skills check/update` defaults to prompting for scope, which can surprise
  users in non-TTY environments (CI).
- The global lock (`~/.agents/.skill-lock.json`) and project lock (`skills-lock.json`)
  are separate files with different schemas, different hash methods, and different
  command support — a source of ongoing confusion.

---

## 6. Security Issues

### 6a. Supply chain / prompt injection

Skills are Markdown instructions that an AI agent follows without sandboxing. A
malicious or compromised skill can:

- Steer agents toward specific commercial services.
- Exfiltrate data through generated code or tool calls.
- Introduce unsafe coding patterns silently.
- Perform prompt injection to override other instructions.

Because updates are always "latest HEAD" with no pinning, a compromised skill author
can push a malicious update that propagates to all users on next `update`. There
is no code-signing or integrity check on skill content (signature verification is an
open RFC — issue #617, not yet implemented).

Snyk's analysis of 3,984 published skills found 13.4% had critical security issues
and 76 were confirmed malicious (prompt injection, credential theft, malicious
downloads). Vercel and Snyk have a scanning partnership that runs on install via
`skills.sh/api/download`, but this only works for the blob fast path — git clone
fallback bypasses the scanner.

### 6b. isRepoPrivate telemetry leak (CVE-class bug, disclosed March 2026)

The `isRepoPrivate()` function returns `null` (not just `true`/`false`) when the
GitHub API is unreachable or returns an error. The telemetry gate used this value
directly, meaning private repo usage could be reported to Vercel's telemetry
infrastructure even when users believed it was suppressed. Reported via GitHub
issue, a partial fix was proposed but not merged as of the disclosure article's
publication date.

### 6c. Path traversal in subpath inputs

The CLI includes a `sanitizeSubpath()` function that rejects `..` segments in
subpaths passed via URL fragments. This indicates path traversal was a considered
threat vector, though the sanitization is only applied to URL-sourced subpaths, not
all code paths.

### 6d. No signature verification

Skills are installed with no cryptographic verification of the author's identity or
the content's integrity. The RFC for ed25519 signature verification (issue #617)
is currently open and unimplemented.

---

## 7. Summary Table

| Concern | `npx skills` behaviour |
|---|---|
| Distribution unit | Single `SKILL.md` file |
| Agents, commands, hooks | NOT distributed — manual copy |
| Source format | `owner/repo` GitHub shorthand, URLs, local paths |
| Fetch mechanism | `skills.sh` CDN blob (fast path) → `git clone --depth 1` (fallback) |
| Version model | Always latest HEAD; no semver, no releases, no pinning |
| Ref/branch support | Via `#ref` URL fragment; not stored automatically |
| Lockfile (project) | `skills-lock.json` — SHA-256 of disk contents, no timestamps |
| Lockfile (global) | `~/.agents/.skill-lock.json` — GitHub tree SHA, timestamps |
| Restore from lockfile | Not supported (`npx skills install` does not exist) |
| Update mechanism | Hash comparison → re-fetch from HEAD |
| `remove` updates lock | No — lockfile diverges silently |
| Conflict detection | None (last-write-wins) |
| Supply chain security | Snyk scan on blob path only; no code signing; no pinning |
| Private repo leak | Known bug: `isRepoPrivate` null-return leaked telemetry |
| Author dogfooding | Author cannot use own skills repo (bootstrapping problem) |

---

## 8. Key Design Gaps for a Competing Tool

1. **Semver ranges + release-based distribution** — `owner/repo@^1.0.0` resolves
   against GitHub releases, lockfile pins exact version.
2. **`install` command** — reads lockfile, re-fetches pinned releases, idempotent.
   Equivalent of `npm ci`.
3. **Full artifact support** — distribute agents, commands, hooks, MCP config in
   addition to skills.
4. **Conflict detection** — lockfile records which package owns which file; warn on
   collision at install time.
5. **`remove` updates lockfile** — atomic: remove files + update lockfile together.
6. **Consistent scope model** — single manifest (`ai.json`) + lockfile (`ai-lock.json`)
   for both project and global scope; no dual-schema confusion.
7. **Author dogfooding** — `link` command symlinks author's own `.ai/` dir so
   authors can use their own setup before publishing.
8. **Integrity verification** — hash every artifact at install time; detect tampering
   on update.

---

## References

- Source repo: <https://github.com/vercel-labs/skills>
- npm package: <https://www.npmjs.com/package/skills> (v1.5.9 as of 2026-05-27)
- skills.sh marketplace: <https://skills.sh>
- Issue #283 (install/sync): <https://github.com/vercel-labs/skills/issues/283>
- Issue #337 (project update): <https://github.com/vercel-labs/skills/issues/337>
- Issue #542 (project lock bug): <https://github.com/vercel-labs/skills/issues/542>
- Issue #549 (npx skills install): <https://github.com/vercel-labs/skills/issues/549>
- Issue #617 (signature verification RFC): <https://github.com/vercel-labs/skills/issues/617>
- isRepoPrivate telemetry bug: <https://cjlludwig.github.io/blog/vercel-hack-skillssh-security/>
- Snyk security analysis: <https://snyk.io/blog/snyk-vercel-securing-agent-skill-ecosystem/>
- Supply chain attack vector: <https://github.com/vercel-labs/agent-skills/issues/91>
- Lockfile article: <https://maier.tech/notes/a-lockfile-for-agent-skills>
