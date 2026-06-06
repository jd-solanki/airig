# Per-artifact symlinks over provider directory symlinks

ohmyai creates symlinks for selected artifacts instead of symlinking whole provider target directories. Directory-level symlinks would replace the entire target directory and hide unmanaged files the Author or User has placed there. Per-artifact symlinks let `ohmyai`-managed artifacts and user-authored files coexist in the same target directory while preserving meaningful target-path conflict detection.
