# Skills Distribution Research

> _NOTE: This document is for `skills.sh CLI` and not for `airig`_

How to create, distribute, and list AI agent skills on [skills.sh](https://www.skills.sh).

## How It All Works

The `npx skills` CLI ([vercel-labs/skills](https://github.com/vercel-labs/skills)) is the universal installer. It reads `SKILL.md` files from any GitHub repo and installs them into the correct agent directories (`.claude/skills/`, `.cursor/skills/`, etc.).

**No submission process** — skills appear on skills.sh automatically once people install them via the CLI (telemetry-driven ranking). Your page is at `skills.sh/<github-owner>/<github-repo>`.

---

## Repo Structure

Two valid structures are supported.

### Flat (simple)

```
my-skills/
├── skills/
│   ├── my-skill-a/
│   │   └── SKILL.md
│   └── my-skill-b/
│       └── SKILL.md
├── .claude-plugin/
│   └── plugin.json       ← optional, for plugin marketplace compat
├── skills.sh.json        ← optional, for skills.sh page customization
└── README.md
```

### Categorized (mattpocock style)

```
my-skills/
├── skills/
│   ├── engineering/
│   │   ├── diagnose/SKILL.md
│   │   └── tdd/SKILL.md
│   ├── productivity/
│   │   └── grill-me/SKILL.md
│   └── personal/         ← exclude from plugin.json
│       └── my-setup/SKILL.md
├── .claude-plugin/
│   └── plugin.json
└── README.md
```

The CLI walks `skills/` up to **2 levels deep** (`skills/<name>/SKILL.md` or `skills/<category>/<name>/SKILL.md`).

---

## SKILL.md Format

```markdown
---
name: my-skill-name
description: What this skill does and when to invoke it. Use when user says "do X".
---

# My Skill

Instructions the agent follows when this skill is activated.

## When to Use

Describe trigger scenarios.

## Steps

1. Do this
2. Then that
```

### Required frontmatter

| Field | Description |
|-------|-------------|
| `name` | Lowercase, hyphens allowed, unique within the repo |
| `description` | What the agent uses to decide when to invoke the skill |

### Optional frontmatter

```yaml
metadata:
  internal: true   # hidden from normal discovery; needs INSTALL_INTERNAL_SKILLS=1 to install
```

---

## `.claude-plugin/plugin.json`

Enables compatibility with the Claude Code plugin marketplace and ensures the CLI finds skills in non-standard layouts. Only list skills you want public (exclude `personal/`, `in-progress/`, `deprecated/`).

```json
{
  "name": "jd-solanki-skills",
  "skills": [
    "./skills/my-skill-a",
    "./skills/my-skill-b",
    "./skills/engineering/tdd"
  ]
}
```

---

## `skills.sh.json`

Controls layout of your page on skills.sh. Place at repo root.

```json
{
  "$schema": "https://skills.sh/schema/skills.sh.json",
  "notGrouped": "bottom",
  "groupings": [
    {
      "title": "Engineering",
      "description": "Daily coding workflows",
      "skills": ["tdd", "diagnose", "code-review"]
    },
    {
      "title": "Productivity",
      "description": "Non-code workflow tools",
      "skills": ["grill-me", "caveman"]
    }
  ]
}
```

- Max 50 groups, 500 skills per group
- Ungrouped skills appear in an `Other skills` section
- Changes are cached — may not appear immediately

---

## README Badge

```markdown
[![skills.sh](https://skills.sh/b/jd-solanki/skills)](https://skills.sh/jd-solanki/skills)
```

---

## Getting Listed on skills.sh

No registration needed. Once someone runs:

```bash
npx skills@latest add jd-solanki/skills
```

...the CLI telemetry registers the install and your repo appears in the leaderboard at `skills.sh/jd-solanki/skills`.

---

## Install Command Reference (for users)

```bash
# Interactive (prompts for which skills + which agents)
npx skills@latest add jd-solanki/skills

# List available skills without installing
npx skills@latest add jd-solanki/skills --list

# Install specific skills to claude-code only
npx skills@latest add jd-solanki/skills --skill my-skill -a claude-code

# Install all, globally, skip prompts
npx skills@latest add jd-solanki/skills --all -g -y
```

### Source formats supported

```bash
npx skills add jd-solanki/skills                                        # GitHub shorthand
npx skills add https://github.com/jd-solanki/skills                    # Full GitHub URL
npx skills add https://github.com/jd-solanki/skills/tree/main/skills/tdd  # Single skill
npx skills add ./my-local-skills                                        # Local path
```

### Install scope

| Scope | Flag | Location | Use Case |
|-------|------|----------|----------|
| Project | (default) | `./<agent>/skills/` | Committed with project, shared with team |
| Global | `-g` | `~/<agent>/skills/` | Available across all projects |

---

## Supported Agents (install targets)

| Agent | `--agent` flag | Project Path |
|-------|---------------|--------------|
| Claude Code | `claude-code` | `.claude/skills/` |
| Cursor | `cursor` | `.agents/skills/` |
| Codex | `codex` | `.agents/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` |
| Roo Code | `roo` | `.roo/skills/` |
| OpenCode | `opencode` | `.agents/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` |

Full list: 50+ agents supported. See [vercel-labs/skills README](https://github.com/vercel-labs/skills#supported-agents).

---

## Compatibility Notes

| Feature | Claude Code | Cursor | Codex | Copilot |
|---------|-------------|--------|-------|---------|
| Basic skills | Yes | Yes | Yes | Yes |
| `allowed-tools` | Yes | Yes | Yes | Yes |
| `context: fork` | Yes | No | No | No |
| Hooks | Yes | No | No | No |

---

## Shipping Commands, Agents, Hooks & MCP Config

The `npx skills` CLI **only distributes `SKILL.md` files**. Everything else (custom commands, sub-agents, hooks, MCP config) must be shipped separately and installed manually by the user.

### What the CLI distributes vs. what it doesn't

| Asset | CLI distributes? | Pattern |
|-------|----------------|---------|
| `SKILL.md` files | **Yes** | Core distribution unit |
| Custom commands (`.claude/commands/`) | **No** | Ship in `resources/commands/`; users copy manually |
| Sub-agents (`.claude/agents/`) | **No** | Ship in `resources/agents/`; users copy manually |
| Hooks (`settings.json`) | **No** | Document examples; users add manually |
| MCP config | **No** | Document examples; users add manually |

### Recommended layout for a full-featured repo

```
jd-solanki/skills/
├── skills/
│   ├── setup-jd-solanki-skills/
│   │   └── SKILL.md            ← one-time setup guide (run first)
│   ├── engineering/
│   │   └── my-skill/SKILL.md
│   └── productivity/
│       └── my-skill/SKILL.md
├── resources/                  ← extras the setup skill points to
│   ├── commands/
│   │   └── my-command.md       ← users copy to .claude/commands/
│   ├── agents/
│   │   └── my-agent.md         ← users copy to .claude/agents/
│   └── hook-examples.md        ← reference snippets for settings.json
├── .claude-plugin/
│   └── plugin.json
├── skills.sh.json
└── README.md
```

### The Setup Skill Pattern

Both `mattpocock/skills` and `onmax/skills` use a `setup-<author>-skills` skill that runs **once** to guide first-time configuration. It doesn't auto-write config — it's an interactive guide that:

1. Explores the repo (reads existing `AGENTS.md`, labels, issue tracker, etc.)
2. Asks the user configuration questions
3. Writes lightweight config files (e.g. `docs/agents/issue-tracker.md`) read by other skills
4. Points users to `resources/` for commands/agents/hooks to copy manually

```markdown
---
name: setup-jd-solanki-skills
description: One-time setup for jd-solanki skills. Run this first to configure project memory, custom commands, and hooks.
---

# Setup

## Step 1 — Custom Commands
Copy any commands you want from `resources/commands/` into `.claude/commands/`.

## Step 2 — Sub-Agents
Copy any agents you want from `resources/agents/` into `.claude/agents/`.

## Step 3 — Hooks (Claude Code only)
Add hook snippets from `resources/hook-examples.md` to `.claude/settings.json`.

## Step 4 — Project Memory
...
```

### `allowed-tools` frontmatter (Claude Code + most agents)

Declare tools a skill needs upfront to reduce permission prompts:

```yaml
---
name: my-skill
description: Does X. Use when user says "do X".
allowed-tools:
  - Bash(git log*)
  - WebFetch(domain:github.com)
---
```

Supported by Claude Code, Cursor, Codex, Copilot, and most others. Not supported by Kiro CLI and Zencoder.

---

## Quick-Start Checklist

- [ ] Create `skills/<name>/SKILL.md` for each skill (required: `name` + `description` frontmatter)
- [ ] Create a `setup-jd-solanki-skills` skill as the entry point
- [ ] Add `resources/commands/`, `resources/agents/`, `resources/hook-examples.md` for extras
- [ ] Add `.claude-plugin/plugin.json` listing public skills
- [ ] Add `skills.sh.json` to organize your skills.sh page (optional)
- [ ] Add the badge to your README
- [ ] Push to GitHub as `jd-solanki/skills`
- [ ] Share `npx skills@latest add jd-solanki/skills`

---

## References

- [vercel-labs/skills — CLI source + full docs](https://github.com/vercel-labs/skills)
- [skills.sh](https://www.skills.sh)
- [skills.sh Customize Docs](https://www.skills.sh/docs/customize)
- [Agent Skills Specification](https://agentskills.io)
- [mattpocock/skills — example repo](https://github.com/mattpocock/skills)
- [onmax/skills — example repo](https://github.com/onmax/skills)
