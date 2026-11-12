import { describe, expect, it } from 'vitest'
import { validateRules } from '../tools/memory/rules.mjs'

const rule = {
  id: 'edit-read-first',
  rule: 'When edit reports file has not been read, read the file and retry once.',
  scope: { roles: ['worker'], intents: [], areas: [] },
  evidence: ['a', 'b', 'c'],
  check: 'Confirm the edit succeeded.',
  confidence: 'high',
  reviewAfter: '2099-01-01T00:00:00.000Z',
  expiresAt: '2099-02-01T00:00:00.000Z',
}
const doc = (overrides = {}) => ({ version: 1, rules: [{ ...rule, ...overrides }] })
const knownCases = new Set(['a', 'b', 'c'])

describe('reviewed rules', () => {
  it('accepts a rule with three known cases', () => {
    expect(validateRules(doc(), { knownCases })).toEqual([])
  })

  it('rejects fewer than three cases, unknown cases and duplicate ids', () => {
    expect(validateRules(doc({ evidence: ['a', 'b'] }), { knownCases })).not.toEqual([])
    expect(validateRules(doc({ evidence: ['a', 'b', 'z'] }), { knownCases })).not.toEqual([])
    expect(validateRules({ version: 1, rules: [rule, rule] }, { knownCases })).toContain('rules[1].id is duplicated: edit-read-first')
  })

  it('rejects an expired rule and an overdue review', () => {
    expect(validateRules(doc({ reviewAfter: '2000-01-01T00:00:00.000Z' }), { knownCases })).not.toEqual([])
    expect(validateRules(doc({ expiresAt: '2000-01-01T00:00:00.000Z' }), { knownCases })).not.toEqual([])
  })

  it('rejects an ability verdict, no action and a missing check', () => {
    expect(validateRules(doc({ rule: 'the tool is broken' }), { knownCases })).not.toEqual([])
    expect(validateRules(doc({ rule: 'Good builds are important.' }), { knownCases })).not.toEqual([])
    expect(validateRules(doc({ check: '' }), { knownCases })).not.toEqual([])
  })
})
