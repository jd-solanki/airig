# Store linked artifacts as a positive list

`ai.json` records a positive `linked` list for each installed Setup Release instead of a negative `exclude` list. The local `"."` package uses the same `linked` list shape, with `version: "*"` as its only special case. The list stores source artifact labels, such as `AGENTS.md`, `skills/tdd`, and `.claude/agents/reviewer.md`; the Provider Registry is responsible for resolving those artifacts into target symlink paths.

For remote Setup Releases, `linked` means "installed and active." `.ai/` contains only selected active remote artifacts, plus any relative symlink dependency required to preserve an Author-provided setup symlink. There is no downloaded-but-inactive remote cache. `add` adds labels to `linked`, `remove` prunes labels from `linked`, and `update` refreshes only labels already in `linked`.
