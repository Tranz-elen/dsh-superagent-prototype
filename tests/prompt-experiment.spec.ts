import { describe, expect, it } from 'vitest'
import { assignedPromptRevision } from '../src/app/prompt-experiment.ts'

describe('prompt experiment assignment', () => {
  it('is deterministic and balances two revisions across ticket ids', () => {
    const revisions = [5, 4]
    const assigned = Array.from({ length: 100 }, (_, i) => assignedPromptRevision(`ticket-${i}`, { enabled: true, revisions }))
    expect(new Set(assigned)).toEqual(new Set([5, 4]))
    expect(assigned.slice(0, 20).every((revision, i) => revision === assignedPromptRevision(`ticket-${i}`, { enabled: true, revisions }))).toBe(true)
  })

  it('returns undefined when the experiment is off or malformed', () => {
    expect(assignedPromptRevision('ticket', { enabled: false, revisions: [5, 4] })).toBeUndefined()
    expect(assignedPromptRevision('ticket', { enabled: true, revisions: [5] })).toBeUndefined()
    expect(assignedPromptRevision('ticket', { enabled: true, revisions: [5, -1] })).toBeUndefined()
  })
})
