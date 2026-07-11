# Skills flatten to a single provider-dir namespace via one Skill Resolver

Coding agents discover Skills only at a flat depth (`.claude/skills/<name>/SKILL.md`), so a catalog-layout source (`skills/<category>/<name>/SKILL.md`, e.g. `jd-solanki/.ai`) that airig linked category-and-all was invisible to the agent. We introduce a single **Skill Resolver** — `resolveSkills(root) → { name, sourceRelPath, group }` — that every install path (Setup Release `add`, Skills Repo `airig skills add`, local `add .`) goes through, and we hold the invariant that **Skills are always flat in provider dirs**, flattening a catalog's category away to the leaf `name`. The category survives only as display-only `group` for grouped Interactive Selection.

## Status

accepted

## Consequences

- **`.ai/skills/` layout differs by role, deliberately.** Remote installs (Setup Release / Skills Repo) normalize to flat `.ai/skills/<name>` because `.ai/` is airig's install cache. Local `add .` leaves the Author's tree author-shaped (`.ai/skills/<group>/<name>`) because `.ai/` is their hand-organized source; flattening happens only at the provider link. A reader would otherwise assume `.ai/` mirrors the source uniformly — it does not.
- **`group` is never persisted** into `.ai/`; it is re-derived from the source on every `add`/`update` (remotes are re-fetched at the pinned ref), which is why flat remote `.ai/` loses nothing for grouped selection.
- **Leaf-name collisions error** rather than last-write-wins, consistent with ADR-0016's ownership model — one flat namespace per target cannot hold two Skills that flatten to the same name.
- Extends `0009-skill-md-presence-detection`: presence of `SKILL.md` still marks a Skill, now applied while descending catalog categories.
