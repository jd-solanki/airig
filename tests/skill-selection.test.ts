import { describe, expect, it } from 'vitest'
import { Separator } from '@inquirer/prompts'
import { buildSelectionChoices } from '../src/lib/skill-selection'

describe('buildSelectionChoices', () => {
  it('keeps non-skill and ungrouped-skill artifacts flat and first, in order', () => {
    const choices = buildSelectionChoices(['AGENTS.md', 'skills/tdd'], true)

    expect(choices).toEqual([
      { value: 'AGENTS.md', name: 'AGENTS.md', checked: true },
      { value: 'skills/tdd', name: 'skills/tdd', checked: true },
    ])
  })

  it('groups nested catalog skills under a category separator, showing leaf names', () => {
    const choices = buildSelectionChoices(
      ['skills/coding/clean-code', 'skills/coding/comment-code', 'skills/tdd'],
      false,
    )

    expect(choices[0]).toEqual({ value: 'skills/tdd', name: 'skills/tdd', checked: false })
    expect(choices[1]).toBeInstanceOf(Separator)
    expect((choices[1] as Separator).separator).toContain('skills/coding')
    expect(choices.slice(2)).toEqual([
      { value: 'skills/coding/clean-code', name: 'clean-code', checked: false },
      { value: 'skills/coding/comment-code', name: 'comment-code', checked: false },
    ])
  })

  it('sorts multiple groups and keeps the full label as the selectable value', () => {
    const choices = buildSelectionChoices(['skills/python/fastapi', 'skills/js/react'], true)

    const separators = choices.filter(c => c instanceof Separator) as Separator[]
    expect(separators[0].separator).toContain('skills/js')
    expect(separators[1].separator).toContain('skills/python')
    const values = choices.filter(c => !(c instanceof Separator)).map(c => (c as { value: string }).value)
    expect(values).toEqual(['skills/js/react', 'skills/python/fastapi'])
  })
})
