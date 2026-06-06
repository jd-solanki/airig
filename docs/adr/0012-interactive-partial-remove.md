---
status: superseded by ADR-0018
---

# `remove` was non-interactive

`remove owner/repo` now removes an entire installed Setup Release without prompting: downloaded source artifacts owned by the package are deleted from `.ai/`, target symlinks derived from its `linked` list are removed, and the package entry is removed from `ai.json`.

`remove .` is the local Author workflow: it removes target symlinks and the local manifest entry while preserving `.ai/` source files. This ADR is superseded by ADR-0018; `remove` is interactive again because `.ai/` now contains active remote artifacts only, and Users need a direct way to deactivate selected files without uninstalling an entire Author package.
