# `add` activates and `remove` deactivates

`add` is responsible for making AI Setup artifacts active in provider target paths. It writes selected remote artifacts into `.ai/`, creates target symlinks, and records selected source labels in `ai.json`.

`remove` is responsible for deactivating selected active artifacts. It removes target symlinks, prunes selected labels from `ai.json`, and for remote Setup Releases deletes the selected source artifacts from `.ai/`. `remove .` preserves `.ai/` source files because they are the Author's working setup.

This replaces the earlier `link`/downloaded-cache split. There is no public MVP `link` command, and there is no downloaded-but-inactive remote content in `.ai/`.
