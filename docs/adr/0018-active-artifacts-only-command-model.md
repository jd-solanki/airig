# Active artifacts only command model

Remote `.ai/` content is active setup source, not a downloaded release cache. For remote Setup Releases, ohmyai writes selected active artifacts into `.ai/`, plus any relative symlink dependency needed to preserve an Author-provided setup symlink such as `CLAUDE.md -> AGENTS.md`.

`add` is the public activation command. Remote `add` verifies the immutable Setup Release, extracts it into temporary storage, prompts for providers first and artifacts second, checks conflicts before writing, then copies selected artifacts into `.ai/`, creates target symlinks, and records selected labels in `ai.json`. `add .` is the local Author dogfooding command and wires selected existing `.ai/` artifacts without network access.

`update` is non-interactive. It requires an exact `owner/repo@version`, verifies the immutable release, refreshes only artifacts currently listed in that package's `linked` list, prunes linked artifacts deleted upstream, and ignores new upstream artifacts until the User runs `add owner/repo`.

`remove` is interactive. It shows active artifacts grouped by package and artifact category, then removes selected target symlinks and prunes selected labels from `ai.json`. For remote Setup Releases it also deletes selected `.ai/` source artifacts. For local `"."` it preserves `.ai/` source files because they are the Author's working setup.

Why: a downloaded-but-inactive remote cache makes `linked` shallow. Remove and update have to know about artifacts that are not in their interface, and failed activation can mutate `.ai/` before conflicts are reported. Making `linked` mean "installed and active" gives the manifest better locality and lets conflict checks happen before local writes.
