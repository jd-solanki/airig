---
status: superseded by ADR-0014
---

# `remove` supports partial artifact selection

`remove owner/repo` shows the installed artifacts as a pre-checked interactive selection, where selecting everything performs a full uninstall and selecting a subset removes only those artifacts while preserving the Setup Release entry with updated excludes. This makes trimming an install fully local and avoids a `remove` plus `add` round trip, while keeping command semantics clearer than introducing a separate `unlink` command.
