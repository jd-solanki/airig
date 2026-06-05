# Per-file symlinks over directory-level symlinks

`link` creates one symlink per file instead of one symlink per subdirectory. Directory-level symlinks would replace the entire target directory and destroy unmanaged files the author has placed there; per-file symlinks allow `ohmyai`-managed files and user-authored files to coexist in the same target directory while preserving meaningful file-level conflict detection.
