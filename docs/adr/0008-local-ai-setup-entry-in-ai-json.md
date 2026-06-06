---
status: superseded by ADR-0015, ADR-0016, and ADR-0018
---

# Local AI Setup entries use `"."`

`link` writes a `packages["."]` entry with `version: "*"` to `ai.json` and the same positive `linked` source artifact list used by remote Setup Releases. The `"."` key gives local Author-owned setup content and remote downloaded setup content one manifest shape while keeping active wiring explicit.

This ADR is superseded by ADR-0015, ADR-0016, and ADR-0018: `ai.json` no longer stores excludes or a symlink ownership map, active ownership is derived at runtime by expanding each package's `linked` list through the Provider Registry, and local Author dogfooding now uses `add .` instead of a public `link` command.
