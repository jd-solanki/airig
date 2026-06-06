# `remove` prompts over active artifacts

`remove` is interactive because Users may want to deactivate one artifact from a Setup Release without uninstalling every artifact from the same Author package. The prompt is driven by the package `linked` lists, so the choices represent active artifacts rather than downloaded cache entries.

For remote Setup Releases, removing an artifact removes its target symlinks, prunes the artifact from `linked`, and deletes the selected `.ai/` source artifact. For the local `"."` package, `remove` removes target symlinks and prunes `linked` while preserving `.ai/` source files because they are the Author's working setup.
