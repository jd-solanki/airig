# airig Security Model

---

## Threat Model

AI setup files (Project Instruction Files, skills, agents, commands) are Markdown instructions that AI coding agents execute with real tools — `Bash`, `Read`, `Write`, `WebFetch`. A malicious or compromised setup file is not inert text; it is a command channel into those tools running inside a developer's machine.

### Attack vectors

**Prompt injection via skill content**
Skill files are loaded into the agent's context window alongside legitimate instructions. A malicious file can override agent behaviour, steer it toward attacker-controlled services, or suppress normal safety responses. The attack is invisible to the user — the agent simply follows the injected instructions.

**Supply chain via silent auto-update**
If an AI setup tool auto-updates to the latest version of a Setup Release, a compromised or hijacked author account can push a malicious update that propagates silently to every user on next run. No user action required. The attack lands before anyone notices.

**Data exfiltration via declared tool permissions**
Skills can declare broad `allowed-tools` permissions (e.g. `Bash(*)`). A malicious skill uses these to read `~/.aws/credentials`, `~/.ssh/id_rsa`, `.env` files, then exfiltrates them via a `curl` subprocess or `WebFetch` call — all within the skill's "setup" step, before the ostensible skill behaviour runs.

**Persistent backdoor via written files**
A skill run once can instruct the agent to write other files to disk: additional skills, hooks in `.claude/settings.json`, or agent configuration. The backdoor survives after the original skill is removed.

**Code injection into the project**
Skills that assist with coding can inject subtle logic bugs, hardcoded credentials in generated code, or calls to attacker-controlled URLs — defects that persist in the codebase long after the skill is uninstalled.

**Repository impersonation**
If a popular Setup Release's repository is deleted, an attacker can recreate it at the same `owner/repo` path and publish malicious releases under the same name.

---

## Mitigations

### 1. GitHub Immutable Releases

airig uses GitHub's Immutable Releases feature as the foundation of its distribution security.

When a release is published as immutable:
- The Git tag is locked to a specific commit and cannot be moved, modified, or deleted
- All attached release assets are permanently sealed — `ai.zip` cannot be swapped after publication
- GitHub generates a cryptographic release attestation containing the tag, commit SHA, and asset digests
- Even if the repository is deleted and recreated at the same path, immutable release tags cannot be reused — closing the repository impersonation attack

Authors publish via `airig publish`, which always follows the recommended workflow: create draft → attach `ai.zip` → publish as immutable. The CLI enforces this sequence; there is no flag to skip immutability.

### 2. Immutability Gate on Every Install

Every `add` and `update` command verifies the target release's attestation before writing a single file to disk.

```
$ airig add yourname/setup@1.2.0
  → fetching release metadata...
  → verifying immutability attestation...
  ✖ yourname/setup@1.2.0 is not an immutable release. Refusing to install.
```

If the release has no attestation or is not immutable, the command exits with an error. Nothing is written. The check cannot be bypassed by the user.

Immutability is always verified online via the GitHub API — on every `add` and `update`. No attestation is cached locally.

### 3. Always-Online Integrity Verification

Every command that writes remote Setup Release content verifies release immutability through a live GitHub API call at write time. airig does not cache attestation results in `ai.json`; an install or update must prove the target release is immutable during that command run.

This means an old successful install does not become permanent trust for future writes. If GitHub reports that a release is no longer immutable, cannot provide the required attestation, or cannot be verified, `add` and `update` fail before changing local setup content.

### 4. Exact Version Pinning — No Auto-Updates

Every installed Setup Release is pinned to an exact version in `ai.json`:

```json
{
  "packages": {
    "yourname/setup": {
      "version": "1.2.0",
      "linked": ["AGENTS.md", "skills/tdd"]
    }
  }
}
```

There are no semver ranges (`^1.0.0`, `~2.1.0`). Version transitions require explicit user intent:

- `airig update yourname/setup@1.3.0` — bumps to that exact version, re-verifies attestation

A malicious new release cannot reach any user unless they deliberately run `update` with that version. Compromising an author's account and publishing `1.9.0` affects no existing installs.

### 5. Conflict Detection via Linked Artifacts

Each package entry in `ai.json` records the source artifacts that are installed and active:

```json
{
  "packages": {
    "yourname/setup": {
      "version": "1.2.0",
      "linked": ["AGENTS.md", ".claude/agents/reviewer.md"]
    }
  }
}
```

Before remote `add` writes selected artifacts into `.ai/`, the CLI expands every package's `linked` list through the Provider Registry into target symlink paths and builds an in-memory ownership index. If a Setup Release attempts to claim a target already owned by another remote Setup Release, or if a real file or wrong symlink already occupies a target path, the operation errors before files are written. No silent last-write-wins overwrite.

### 6. Local Authoring is Fully Local

The `add .` command wires local `.ai/` artifacts into provider config directories using only files already on disk. It makes no network calls, fetches no releases, and performs no version or attestation checks. It is the Author's command for wiring up their own setup while building it — the two concerns (local authoring and remote distribution) are completely separated.

---

## What airig Does Not Protect Against

**Malicious content in a legitimately immutable release**
Immutability guarantees the bits don't change after publication — it does not guarantee the content is safe. An author can intentionally publish a harmful skill as an immutable release. Users should review setup content before installing, treat `git diff` output after every install as a security artifact, and only install from authors they trust.

**Compromised author at publish time**
If an attacker controls the author's GitHub account before the release is published, they can publish a malicious immutable release. The immutability gate will accept it because the attestation will be valid. Exact pinning limits the blast radius to users who explicitly upgrade to that version.

**Broad `allowed-tools` declarations**
airig does not currently validate or restrict `allowed-tools` declarations in skill files. Users should audit tool permissions when reviewing downloaded setup content.

---

## Security Comparison: airig vs `npx skills`

| Concern | `npx skills` | `airig` |
|---|---|---|
| **Release immutability** | None — assets can be deleted and re-uploaded, tags can be force-pushed | GitHub Immutable Releases — assets and tags permanently sealed after publish |
| **Attestation verification** | None | Cryptographic GitHub attestation verified on every `add` and `update` |
| **Version model** | Always latest HEAD — silent updates on every `npx skills update` | Exact pinning — version never moves without explicit user command |
| **Auto-update attack surface** | Full — any `update` run pulls whatever is at HEAD | None — `update` requires explicit version |
| **Repository impersonation** | Vulnerable — repo deleted + recreated at same path is indistinguishable | Protected — GitHub immutable release tags cannot be reused after repo recreation |
| **Conflict detection** | None — last-write-wins across install sources | Derived from package `linked` lists and the Provider Registry |
| **Restore from manifest** | Not supported — `npx skills install` does not exist | Post-MVP |
| **Lockfile integrity** | `skills-lock.json` stores SHA-256 of disk contents — detects local drift only | Always-online GitHub API verification on every `add` and `update` — no cached attestation |
| **`remove` updates manifest** | No — lockfile diverges silently after `remove` | Yes — `remove` is atomic: files deleted and `ai.json` updated together |
| **Supply chain scan** | Snyk scan on blob fast path only; git clone fallback bypasses scanner | No scanner (exact pinning + attestation gate makes silent propagation impossible) |
| **Known CVE-class issues** | `isRepoPrivate` null-return leaked private repo telemetry | N/A |
| **Author dogfooding** | Author cannot install their own skills repo — bootstrapping problem | `add .` is local-only; Authors wire up their own setup with no GitHub involvement |
