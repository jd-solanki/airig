# Exclude `ai.json` from release assets

`publish` excludes `.ai/ai.json` from `ai.zip`. The manifest records local installation and linking state for one repository, including downloaded Setup Releases and linked artifacts; it is not part of the Author's shared AI Setup. Release assets contain setup artifacts only, such as Project Instruction Files, skills, agents, commands, hooks, and provider directories. `add` recreates or updates `.ai/ai.json` locally after downloading a release, then `link` fills the package's `linked` list from the user's wiring choices.
