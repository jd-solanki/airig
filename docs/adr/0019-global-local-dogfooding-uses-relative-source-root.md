# Global local dogfooding records the source root

Global `add --global .` records the local setup repository root as the package key in `~/.ai/ai.json`, relative from `~/.ai/`, while keeping `version: "*"` and `.ai/`-relative artifact labels. The command uses relative symlinks from `~/.ai/` artifacts back to selected artifacts in the current working source setup instead of copying them, because this mode is for Author dogfooding and the Author is responsible for keeping or relinking their local source repository path.
