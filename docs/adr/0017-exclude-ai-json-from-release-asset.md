# Exclude `ai.json` from release assets

`publish` excludes `.ai/ai.json` from `ai.zip`. The manifest records local installation and active artifact state for one repository; it is not part of the Author's shared AI Setup. Release assets contain setup artifacts only, such as Project Instruction Files, skills, agents, commands, hooks, and provider directories. `add` recreates or updates `.ai/ai.json` locally after the User selects which release artifacts to make active.
