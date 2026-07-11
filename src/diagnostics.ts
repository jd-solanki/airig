import { Diagnostic, defineDiagnostics, formatDiagnostic } from 'nostics'

export const diagnostics = /*#__PURE__*/ defineDiagnostics({
  codes: {
    AIRIG_C0001: {
      why: (p: { pkg: string }) => `Invalid package reference "${p.pkg}". Expected: owner/repo or owner/repo@version`,
      fix: 'Pass a package reference as owner/repo, optionally followed by @version.',
    },
    AIRIG_C0002: {
      why: (p: { pkg: string }) => `Invalid package reference "${p.pkg}". Expected exact version: owner/repo@version`,
      fix: 'Include an explicit version, for example owner/repo@v1.2.3.',
    },
    AIRIG_C0003: {
      why: (p: { aiJsonPath: string }) => `${p.aiJsonPath} is malformed: expected { "packages": {} }`,
      fix: (p: { aiJsonPath: string }) =>
        `Restore the missing top-level keys, or delete ${p.aiJsonPath} to reset it.`,
    },
    AIRIG_C0004: {
      why: (p: { aiJsonPath: string; packageKey: string }) =>
        `${p.aiJsonPath} is malformed: package "${p.packageKey}" must be an object.`,
      fix: 'Change the package entry to a JSON object with version and linked fields.',
    },
    AIRIG_C0005: {
      why: (p: { aiJsonPath: string; packageKey: string }) =>
        `${p.aiJsonPath} is malformed: package "${p.packageKey}" must have a version string.`,
      fix: 'Add a non-empty string version to the package entry.',
    },
    AIRIG_C0006: {
      why: (p: { aiJsonPath: string }) => `${p.aiJsonPath} is malformed: local package "." must use version "*".`,
      fix: 'Set the local package version to "*".',
    },
    AIRIG_C0007: {
      why: (p: { aiJsonPath: string; packageKey: string }) =>
        `${p.aiJsonPath} is malformed: package "${p.packageKey}" linked must be a string array.`,
      fix: 'Set linked to an array of non-empty artifact path strings.',
    },
    AIRIG_C0008: {
      why: (p: { aiJsonPath: string; detail: string }) =>
        `${p.aiJsonPath} is malformed: expected valid JSON.\n  Parser error: ${p.detail}`,
      fix: 'Fix the JSON syntax in the manifest and retry.',
    },
    AIRIG_C0009: {
      why: 'No tag found. Pass a tag argument or create a git tag first.',
      fix: 'Pass a tag to airig publish, or create a local git tag before publishing.',
    },
    AIRIG_C0010: {
      why: 'Could not read git remote origin. Is this a git repository with a remote?',
      fix: 'Run publish from a git repository that has an origin remote.',
    },
    AIRIG_C0011: {
      why: (p: { remote: string }) => `Could not parse owner/repo from remote: ${p.remote}`,
      fix: 'Set origin to a GitHub remote such as https://github.com/owner/repo.git.',
    },
    AIRIG_C0012: {
      why: 'GITHUB_TOKEN is not set. Add it to .env in this directory or export it before running publish.',
      fix: 'Set GITHUB_TOKEN, for example: GITHUB_TOKEN=ghp_...',
    },
    AIRIG_C0013: {
      why: (p: { aiJsonPath: string; packageKey: string }) =>
        `${p.aiJsonPath} is malformed: package "${p.packageKey}" has an unknown source. Expected "release" or "skills-repo".`,
      fix: 'Set source to "release" (or omit it) for a Setup Release, or "skills-repo" for a Skills Repo.',
    },
    AIRIG_R0001: {
      why: (p: { packageKey: string; hint?: string }) =>
        `Package "${p.packageKey}" is not installed.${p.hint ? `\n  ${p.hint}` : ''}`,
      fix: 'Install the package first, or choose a package listed in ai.json.',
    },
    AIRIG_R0002: {
      why: (p: { packageKey: string; installedVersion: string }) =>
        `${p.packageKey} is already installed at ${p.installedVersion}.`,
      fix: 'Use airig update <owner/repo>@<version> to move versions.',
    },
    AIRIG_R0003: {
      why: (p: { owner: string; repo: string; tag: string; action: 'Installing' | 'Updating from' }) =>
        `Security restriction: release ${p.tag} of ${p.owner}/${p.repo} is not immutable.`,
      fix: (p: { action: 'Installing' | 'Updating from' }) =>
        `${p.action} mutable releases is unsafe because assets can be swapped after review. Ask the package author to enable immutable releases in their repo settings.`,
    },
    AIRIG_R0004: {
      why: (p: { packageKey: string; files: string }) =>
        `Conflicts detected: ${p.packageKey} would overwrite existing .ai source files:\n${p.files}`,
      fix: 'Remove the conflicting files, then run add again.',
    },
    AIRIG_R0005: {
      why: (p: { conflicts: string }) =>
        `Conflicts detected: the following symlinks are already owned by another package:\n${p.conflicts}`,
      fix: (p: { command: string }) => `Remove the conflicting files first with: ${p.command}`,
    },
    AIRIG_R0006: {
      why: (p: { conflicts: string }) =>
        `Conflicts detected: the following target paths are already occupied:\n${p.conflicts}`,
      fix: (p: { retryCommand: string }) => `Remove or move the conflicting files, then run ${p.retryCommand} again.`,
    },
    AIRIG_R0007: {
      why: (p: { packageKey: string }) =>
        `Package "${p.packageKey}" is a local setup and cannot be updated as a remote Setup Release.`,
      fix: 'Update local setup files directly, or choose an installed remote package.',
    },
    AIRIG_R0008: {
      why: 'add --global . must be run from a setup repository, not from the Global AI Setup root ~/.ai.',
      fix: 'Run the command from the source setup repository instead of ~/.ai.',
    },
    AIRIG_R0009: {
      why: 'No AI Setup artifacts are installed.',
      fix: 'Install artifacts with airig add before running remove.',
    },
    AIRIG_R0010: {
      why: (p: { conflicts: string }) =>
        `Conflicts detected: the following target paths could not be linked:\n${p.conflicts}`,
      fix: 'Remove or move the conflicting files, then run the command again.',
    },
    AIRIG_R0011: {
      why: (p: { ref: string; owner: string; repo: string }) =>
        `No ai.zip asset found in release "${p.ref}" of ${p.owner}/${p.repo}`,
      fix: 'Publish the setup release with an ai.zip asset, then retry.',
    },
    AIRIG_R0012: {
      why: (p: { status: number; statusText: string }) =>
        `Failed to download asset: HTTP ${p.status} ${p.statusText}`,
      fix: 'Check the release asset URL and network access, then retry.',
    },
    AIRIG_R0013: {
      why: 'Verifying release immutability requires a GitHub token (even for public repos).',
      fix: 'Set GITHUB_TOKEN and retry: export GITHUB_TOKEN=ghp_...',
    },
    AIRIG_R0014: {
      why: 'GITHUB_TOKEN is invalid or expired.',
      fix: 'Generate a new token at: https://github.com/settings/tokens',
    },
    AIRIG_R0015: {
      why: (p: { owner: string; repo: string }) => `Token lacks write access to ${p.owner}/${p.repo}.`,
      fix: 'Classic PAT needs the "repo" scope. Fine-grained PAT needs "Contents: Read and write".',
    },
    AIRIG_R0016: {
      why: (p: { owner: string; repo: string }) =>
        `Repository ${p.owner}/${p.repo} not found or the token has no access to it.`,
      fix: 'Check the git remote URL and token permissions.',
    },
    AIRIG_R0017: {
      why: (p: { owner: string; repo: string; tag: string }) =>
        `A release for tag ${p.tag} already exists in ${p.owner}/${p.repo}.`,
      fix: 'Immutable releases cannot be deleted or have their tag reused. Bump the version, push a new tag, and retry.',
    },
    AIRIG_R0018: {
      why: 'An asset named ai.zip already exists on a stale draft release.',
      fix: (p: { owner: string; repo: string }) =>
        `Delete stale drafts at: https://github.com/${p.owner}/${p.repo}/releases`,
    },
    AIRIG_R0019: {
      why: (p: { status: number; message: string }) => `GitHub API error (HTTP ${p.status}): ${p.message}`,
      fix: 'Review the GitHub API response and retry after correcting the request or permissions.',
    },
    AIRIG_R0020: {
      why: 'The release zip does not contain an .ai/ directory',
      fix: 'Publish a setup release whose ai.zip contains a top-level .ai directory.',
    },
    AIRIG_R0021: {
      why: (p: { owner: string; repo: string }) => `Immutable releases are not enabled for ${p.owner}/${p.repo}.`,
      fix: (p: { owner: string; repo: string }) =>
        `Enable it at: https://github.com/${p.owner}/${p.repo}/settings`,
    },
    AIRIG_R0022: {
      why: (p: { name: string; firstPath: string; secondPath: string }) =>
        `Skill name collision: "${p.name}" appears at "${p.firstPath}" and "${p.secondPath}" in the package`,
      fix: 'Rename or remove one of the duplicate skills in the setup release.',
    },
    AIRIG_R0023: {
      why: (p: { owner: string; repo: string; ref: string }) =>
        `Could not resolve ${p.ref} in ${p.owner}/${p.repo}. The repository or ref was not found.`,
      fix: 'Check the owner/repo spelling and that the branch, tag, or commit exists and is public.',
    },
    AIRIG_R0024: {
      why: (p: { packageKey: string }) =>
        `Package "${p.packageKey}" is a Skills Repo and cannot be managed with this command.`,
      fix: 'Use airig skills <add|update|remove> for Skills Repos.',
    },
    AIRIG_R0025: {
      why: (p: { packageKey: string }) =>
        `Package "${p.packageKey}" is not a Skills Repo.`,
      fix: 'Use airig add/update/remove for Setup Releases and local setups; airig skills is only for Skills Repos.',
    },
    AIRIG_R0026: {
      why: (p: { skill: string; packageKey: string }) =>
        `Skill "${p.skill}" was not found in ${p.packageKey}.`,
      fix: 'List available skills by running airig skills add <owner/repo> without a skill path.',
    },
    AIRIG_R0027: {
      why: (p: { packageKey: string; installedSha: string; requestedSha: string }) =>
        `${p.packageKey} is already installed at ${p.installedSha}, not ${p.requestedSha}.`,
      fix: 'Use airig skills update <owner/repo>[@<ref>] to move to a different commit.',
    },
    AIRIG_R0028: {
      why: 'The downloaded repository archive did not contain a single top-level directory.',
      fix: 'Retry the command; if it persists, the repository archive may be malformed.',
    },
  },
})

export function reportCliError(err: unknown): void {
  if (err instanceof Diagnostic) {
    console.error(formatDiagnostic(err))
    return
  }

  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`)
}
