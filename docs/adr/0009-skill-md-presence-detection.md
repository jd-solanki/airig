# Detect skills by `SKILL.md` presence

When `add` or `update` processes an extracted `.ai/skills/` subtree, it discovers skill directories by recursively finding directories that directly contain `SKILL.md`, then writes each skill to `.ai/skills/<dirname>/` with ancestor category directories stripped. This avoids depth-based assumptions that reject deeper source organization, keeps active artifact selection simple by presenting a flat user skills directory, and makes the skill directory name the user-visible identity.

If two discovered skill directories in the same Setup Release share the same directory name, `add` errors before writing anything because skill names must be unique within a release.
