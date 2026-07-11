import { Separator } from '@inquirer/prompts'
import path from 'node:path'

export interface ArtifactChoice {
  value: string
  name: string
  checked: boolean
}

export type SelectionChoice = ArtifactChoice | Separator

const SKILLS_PREFIX = 'skills/'

/**
 * Build interactive-selection choices from artifact labels, grouping skills that
 * come from the same source category under a labeled separator so a User can
 * scan and select a whole category at once instead of hunting through a flat
 * list (see #43). Non-skill artifacts and top-level (ungrouped) skills keep
 * their original order and appear before the grouped categories.
 *
 * `checked` is applied to every artifact choice as its default selection state.
 * A choice's `value` is always the full artifact label — the identity written to
 * `ai.json` — while grouped skills display only their leaf name, since the
 * separator already names the category.
 */
export function buildSelectionChoices(labels: string[], checked: boolean): SelectionChoice[] {
  const ungrouped: ArtifactChoice[] = []
  const byGroup = new Map<string, ArtifactChoice[]>()

  for (const label of labels) {
    const group = skillGroup(label)
    if (group === undefined) {
      ungrouped.push({ value: label, name: label, checked })
      continue
    }
    const choices = byGroup.get(group) ?? []
    choices.push({ value: label, name: path.posix.basename(label), checked })
    byGroup.set(group, choices)
  }

  const choices: SelectionChoice[] = [...ungrouped]
  for (const group of [...byGroup.keys()].sort()) {
    choices.push(new Separator(`── ${SKILLS_PREFIX}${group} ──`))
    choices.push(...byGroup.get(group) ?? [])
  }
  return choices
}

/**
 * The source category of a skill artifact, or `undefined` when the label is not
 * a nested skill (a non-skill artifact, or a top-level `skills/<name>`). For a
 * catalog label `skills/coding/clean-code` this is `coding`.
 */
function skillGroup(label: string): string | undefined {
  if (!label.startsWith(SKILLS_PREFIX)) return undefined
  const rest = label.slice(SKILLS_PREFIX.length)
  const parent = path.posix.dirname(rest)
  return parent === '.' ? undefined : parent
}
