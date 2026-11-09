import { describe, expect, it } from 'vitest'
import { latestEndedAt, newRealCases, realCases } from '../tools/memory/watch-real-tickets.mjs'

const cases = [
  { id: 'real1', title: 'docs: real', endedAt: '2026-11-08T10:00:00Z' },
  { id: 'ab', title: 'docs: docs/ab-sample.md A/B ON 1', endedAt: '2026-11-09T12:00:00Z' },
  { id: 'real2', title: 'fix: real', endedAt: '2026-11-09T13:00:00Z' },
]

describe('real-ticket watch', () => {
  it('excludes A/B fixtures and reports only cases after the high-water mark', () => {
    expect(realCases(cases).map(c => c.id)).toEqual(['real1', 'real2'])
    expect(latestEndedAt(realCases(cases))).toBe('2026-11-09T13:00:00Z')
    expect(newRealCases(cases, '2026-11-09T12:30:00Z').map(c => c.id)).toEqual(['real2'])
    expect(newRealCases(cases, '2026-11-09T13:00:00Z')).toEqual([])
  })
})
