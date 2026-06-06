# PRD #8 Review Findings

Review target: PRD #8 implementation and child issues #15-#22.

## Finding 1: `add` writes release files before conflict resolution

Severity: P1

Status: resolved by the active-artifacts-only command model.

Files:
- `src/commands/add.ts`
- `src/lib/setup-release.ts`

Problem:
`add` currently copies the full Setup Release into `.ai/` with `force: true` before the `link` flow detects target conflicts. If an installed Setup Release already owns a target such as `AGENTS.md`, adding another Setup Release that contains the same source artifact can overwrite `.ai/AGENTS.md` before the conflict is raised. Since active target symlinks point back into `.ai/`, the active content can change even though the add/link operation fails.

Decision:
`add` should be interactive before writing selected files into `.ai/`. The User should select which Setup Release artifacts to download/link, and conflicts should be reported before any conflicting files are written locally.

Resolution:
`add` now extracts remote releases into temp storage, prompts for providers and artifacts, preflights package ownership conflicts, target path conflicts, and symlink dependency source conflicts, then writes only selected active artifacts into `.ai/`.

Why:
The PRD separates downloaded content from active wiring, but the current implementation makes `.ai/` writes happen before conflict detection. That breaks locality: the link module reports failure, while the setup-release copy module may already have changed active content.

## Finding 2: `remove owner/repo` leaves downloaded-but-unlinked artifacts behind

Severity: P1

Status: resolved by changing remote `.ai/` from downloaded cache to active artifact source.

Files:
- `src/commands/remove.ts`

Problem:
`remove owner/repo` deletes only artifacts currently listed in the package `linked` list. PRD #8 says `remove` deletes the downloaded Setup Release files from `.ai/`, but `add` downloads all artifacts while `linked` records only active wiring. Any downloaded-but-unlinked artifact is left behind after the manifest entry is removed, so the CLI loses the ability to know which Setup Release it came from.

Why:
`linked` is active wiring state, not downloaded ownership state. Using it as the deletion list makes the remove module shallow: callers must remember that inactive downloaded artifacts are outside its interface.

Resolution:
Remote `.ai/` no longer has downloaded-but-unlinked artifacts. `remove` is interactive and deletes selected remote source artifacts from `.ai/` while pruning the same labels from `linked`.

## Finding 3: `update` leaves stale inactive artifacts

Severity: P1

Status: resolved by making `update` refresh linked artifacts only.

Files:
- `src/commands/update.ts`

Problem:
`update` detects deleted upstream artifacts by comparing the new release artifacts only to `previousLinked`. If v1 downloaded an artifact that was never linked and v2 removes it, the stale v1 artifact remains in `.ai/`.

Why:
PRD #8 says `update` refreshes downloaded Setup Release content and deletes files removed from the release. The current implementation only refreshes and prunes active wiring, so inactive downloaded content can drift from the selected exact version.

Resolution:
The domain model changed: there is no inactive remote cache. `update` now refreshes artifacts already in `linked`, prunes deleted linked artifacts, and ignores new upstream artifacts until the User runs `add owner/repo`.

## Finding 4: skipped link targets are still persisted as linked

Severity: P2

Status: resolved by blocking target conflicts before persisted link reconciliation.

Files:
- `src/lib/linker.ts`

Problem:
When a selected artifact cannot be linked because a real file or wrong symlink already exists at the target, `linkPackageArtifacts` reports it as skipped, but `reconcilePackageLinks` still writes the selected artifact into the package `linked` list. `ai.json` then claims active ownership where no target link exists.

Why:
The `linked` list is the source for derived ownership. Persisting skipped artifacts creates false ownership, causing misleading conflicts and cleanup behavior later.

Resolution:
`reconcilePackageLinks` now preflights selected target paths before mutating link state. Real-file and wrong-symlink conflicts fail with an actionable message and do not write false `linked` ownership. Idempotent already-linked targets remain allowed.

## Verification

Latest verification:
- `pnpm test` passed with 103 tests.
- `pnpm build` passed; tsdown still prints the existing `define` option warning.
