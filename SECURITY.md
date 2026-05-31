# ohmyai Security Model

---

## Threat Model

AI setup files (skills, agents, commands) are Markdown instructions that AI coding agents execute with real tools — `Bash`, `Read`, `Write`, `WebFetch`. A malicious or compromised setup file is not inert text; it is a command channel into those tools running inside a developer's machine.

### Attack vectors

**Prompt injection via skill content**
Skill files are loaded into the agent's context window alongside legitimate instructions. A malicious file can override agent behaviour, steer it toward attacker-controlled services, or suppress normal safety responses. The attack is invisible to the user — the agent simply follows the injected instructions.

**Supply chain via silent auto-update**
If an AI setup tool auto-updates to the latest version of a package, a compromised or hijacked author account can push a malicious update that propagates silently to every consumer on next run. No user action required. The attack lands before anyone notices.

**Data exfiltration via declared tool permissions**
Skills can declare broad `allowed-tools` permissions (e.g. `Bash(*)`). A malicious skill uses these to read `~/.aws/credentials`, `~/.ssh/id_rsa`, `.env` files, then exfiltrates them via a `curl` subprocess or `WebFetch` call — all within the skill's "setup" step, before the ostensible skill behaviour runs.

**Persistent backdoor via written files**
A skill run once can instruct the agent to write other files to disk: additional skills, hooks in `.claude/settings.json`, or agent configuration. The backdoor survives after the original skill is removed.

**Code injection into the project**
Skills that assist with coding can inject subtle logic bugs, hardcoded credentials in generated code, or calls to attacker-controlled URLs — defects that persist in the codebase long after the skill is uninstalled.

**Repository impersonation**
If a popular package's repository is deleted, an attacker can recreate it at the same `owner/repo` path and publish malicious releases under the same name.

---

## Mitigations

### 1. GitHub Immutable Releases

ohmyai uses GitHub's Immutable Releases feature as the foundation of its distribution security.

When a release is published as immutable:
- The Git tag is locked to a specific commit and cannot be moved, modified, or deleted
- All attached release assets are permanently sealed — `ai.zip` cannot be swapped after publication
- GitHub generates a cryptographic release attestation containing the tag, commit SHA, and asset digests
- Even if the repository is deleted and recreated at the same path, immutable release tags cannot be reused — closing the repository impersonation attack

Authors publish via `npx ohmyai publish`, which always follows the recommended workflow: create draft → attach `ai.zip` → publish as immutable. The CLI enforces this sequence; there is no flag to skip immutability.

### 2. Immutability Gate on Every Install

Every `add` and `update` command verifies the target release's attestation before writing a single file to disk.

```
$ npx ohmyai add yourname/setup@1.2.0
  → fetching release metadata...
  → verifying immutability attestation...
  ✖ yourname/setup@1.2.0 is not an immutable release. Refusing to install.
```

If the release has no attestation or is not immutable, the command exits with an error. Nothing is written. The check cannot be bypassed by the user.

Immutability is always verified online via the GitHub API — on every `add`, `update`, and `sync`. No attestation is cached locally.

### 3. Exact Version Pinning — No Auto-Updates

Every installed package is pinned to an exact version in `ai.json`:

```json
{
  "packages": {
    "yourname/setup": {
      "version": "1.2.0",
      "attestation": "sha256:abc123..."
    }
  }
}
```

There are no semver ranges (`^1.0.0`, `~2.1.0`). Version transitions require explicit consumer intent:

- `npx ohmyai check` — read-only, reports available newer immutable releases
- `npx ohmyai update yourname/setup@1.3.0` — bumps to that exact version, re-verifies attestation

A malicious new release cannot reach any consumer unless they deliberately run `update` with that version. Compromising an author's account and publishing `1.9.0` affects no existing installs.

### 4. Conflict Detection via Symlink Ownership

The `ownership` section of `ai.json` records which package owns each installed file:

```json
{
  "ownership": {
    ".claude/agents/reviewer.md": "yourname/setup@1.2.0",
    ".claude/skills/tdd/SKILL.md": "anotheruser/setup@2.0.0"
  }
}
```

At install time, if a new package attempts to install a file already owned by another package, the CLI errors and reports the conflict. No silent last-write-wins overwrite. The consumer must explicitly exclude the conflicting artifact from one of the packages before the install proceeds.

### 5. Always-Online Integrity Verification

`npx ohmyai sync` re-fetches all pinned immutable releases and verifies via the GitHub API that each release is still immutable. Immutability is never cached locally — every `add`, `update`, and `sync` makes a live API call. If verification fails, `sync` errors:

```
✖ Immutability check failed: yourname/setup@1.2.0
  Release is no longer immutable or has been deleted.
  Do not use this installation. Report to the package author.
```

### 6. `link` is Fully Local

The `link` command ownership `.ai/<provider>/` into provider config directories using only files already on disk. It makes no network calls, fetches no releases, and performs no version or attestation checks. It is the author's command for wiring up their own setup while building it — the two concerns (local authoring and remote distribution) are completely separated.

---

## What ohmyai Does Not Protect Against

**Malicious content in a legitimately immutable release**
Immutability guarantees the bits don't change after publication — it does not guarantee the content is safe. An author can intentionally publish a harmful skill as an immutable release. Consumers should review setup content before installing, treat `git diff` output after every install as a security artifact, and only install from authors they trust.

**Compromised author at publish time**
If an attacker controls the author's GitHub account before the release is published, they can publish a malicious immutable release. The immutability gate will accept it because the attestation will be valid. Exact pinning limits the blast radius to consumers who explicitly upgrade to that version.

**Broad `allowed-tools` declarations**
ohmyai does not currently validate or restrict `allowed-tools` declarations in skill files. Consumers should audit tool permissions during Interactive Selection on `add`.

---

## Security Comparison: ohmyai vs `npx skills`

| Concern | `npx skills` | `ohmyai` |
|---|---|---|
| **Release immutability** | None — assets can be deleted and re-uploaded, tags can be force-pushed | GitHub Immutable Releases — assets and tags permanently sealed after publish |
| **Attestation verification** | None | Cryptographic GitHub attestation verified on every `add`, `update`, and `sync` |
| **Version model** | Always latest HEAD — silent updates on every `npx skills update` | Exact pinning — version never moves without explicit consumer command |
| **Auto-update attack surface** | Full — any `update` run pulls whatever is at HEAD | None — `update` requires explicit version; `check` is read-only |
| **Repository impersonation** | Vulnerable — repo deleted + recreated at same path is indistinguishable | Protected — GitHub immutable release tags cannot be reused after repo recreation |
| **Conflict detection** | None — last-write-wins across packages | `ownership` ownership map in `ai.json`, error on collision |
| **Restore from manifest** | Not supported — `npx skills install` does not exist | `npx ohmyai sync` re-fetches and verifies all pinned immutable releases |
| **Lockfile integrity** | `skills-lock.json` stores SHA-256 of disk contents — detects local drift only | Always-online GitHub API verification on every `add`, `update`, `sync` — no cached attestation |
| **`remove` updates manifest** | No — lockfile diverges silently after `remove` | Yes — `remove` is atomic: files deleted and `ai.json` updated together |
| **Supply chain scan** | Snyk scan on blob fast path only; git clone fallback bypasses scanner | No scanner (exact pinning + attestation gate makes silent propagation impossible) |
| **Known CVE-class issues** | `isRepoPrivate` null-return leaked private repo telemetry | N/A |
| **Author dogfooding** | Author cannot install their own skills repo — bootstrapping problem | `link` is local-only; authors wire up their own setup with no GitHub involvement |
