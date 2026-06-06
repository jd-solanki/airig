# Derive ownership from linked artifacts

`ai.json` does not store a separate `ownership` map. Active ownership is derived at runtime by expanding each package's positive `linked` source artifact list through the Provider Registry into concrete target symlink paths. This avoids two sources of truth while preserving file-level conflict detection.

Remote `add` builds an in-memory target index before writing selected artifacts into `.ai/` or creating target symlinks. Conflicts between remote Setup Releases block the operation before files are written. Existing real files or wrong symlinks at target paths also block reconciliation before `linked` state is persisted, because the User needs to resolve those conflicts before ohmyai can safely make a selected artifact active.
