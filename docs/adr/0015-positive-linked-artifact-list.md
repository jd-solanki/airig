# Store linked artifacts as a positive list

`ai.json` records a positive `linked` list for each installed Setup Release instead of a negative `exclude` list. The local `"."` package uses the same `linked` list shape, with `version: "*"` as its only special case. The list stores source artifact labels, such as `AGENTS.md`, `skills/tdd`, and `.claude/agents/reviewer.md`; the Provider Registry is responsible for resolving those artifacts into target symlink paths.

For remote Setup Releases, `linked` means "installed and active." `.ai/` contains selected active remote artifacts, plus any relative symlink dependency needed to preserve an Author-provided setup symlink such as `CLAUDE.md -> AGENTS.md`. Those dependency files are copied only because an active selected artifact needs them; they are not a downloaded-but-inactive remote cache. `add` adds selected labels to `linked`, `remove` prunes labels from `linked`, and `update` refreshes only labels already in `linked`.
