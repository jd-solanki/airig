---
status: superseded by ADR-0014
---

# `remove` is non-interactive

`remove owner/repo` now removes an entire installed Setup Release without prompting: downloaded source artifacts owned by the package are deleted from `.ai/`, target symlinks derived from its `linked` list are removed, and the package entry is removed from `ai.json`.

`remove .` is the local Author workflow: it removes target symlinks and the local manifest entry while preserving `.ai/` source files. This ADR is superseded by ADR-0014; the old partial-selection model and exclude-list manifest are out of the MVP command model.
