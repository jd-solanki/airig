---
status: superseded by ADR-0018
---

# `link` provider is optional

`link [provider]` accepts a provider for scripted single-provider linking, and when omitted opens an interactive multi-select prompt for one or more registered providers. This keeps the command convenient for automation while helping first-time users wire providers without knowing provider names upfront, including at the end of an `add` flow.

This ADR is superseded by ADR-0018. `link` is no longer part of the public MVP command surface; `add` owns provider and artifact selection.
