# Provider selection precedes artifact selection

When an interactive command needs both provider and artifact choices, it asks for providers first and artifacts second. Provider selection determines which Provider Registry rules apply, including provider-recognized root Project Instruction Files, while the User can still choose the exact artifacts.

`add` uses this flow for both remote Setup Releases and local `.` authoring. For remote Setup Releases, artifact choices are read from the extracted release before anything is written into `.ai/`. For local `add .`, artifact choices are read from the Author's existing `.ai/` directory.

`update` never prompts. It refreshes only artifacts already in the package's `linked` list and ignores new upstream artifacts until the User explicitly runs `add owner/repo`.

`remove` prompts over active artifacts grouped by package and artifact category. It does not ask for providers because removal is driven by the existing `linked` list and Provider Registry expansion.
