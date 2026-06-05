---
status: superseded by ADR-0015 and ADR-0016
---

# Local AI Setup entries use `"."`

`link` writes a `packages["."]` entry with `version: "*"` to `ai.json` and records each local symlink ownership value as an explicit `.ai/` source path. The `"."` key gives local and remote setups a uniform manifest shape, the optional local `exclude` list supports selective linking, and explicit source paths let readers trace symlinks without resolving a Setup Release reference.
