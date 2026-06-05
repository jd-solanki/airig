# Skills live at `.ai/skills/`

Skills are shared provider-agnostic artifacts, so they live at `.ai/skills/` instead of under provider-specific directories. Multiple providers read from `.agents/skills/`, and a shared source avoids provider directory symlink conflicts while reflecting that skills are Markdown artifacts usable across providers.
