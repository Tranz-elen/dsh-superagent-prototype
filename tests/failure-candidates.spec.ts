import { describe, expect, it } from 'vitest'
import { buildFailureCandidates, validateFailureCandidate, validatePlaybookText } from '../tools/memory/failure-candidates.mjs'

const failure = (signature: string, detail = 'Error: cannot modify: file has not been read') => ({ signature, detail, quarantined: false })
const cases = [
  { id: 'a', outcome: 'merged', trace: { failures: [failure('edit:error:cannot+modify')] } },
  { id: 'b', outcome: 'completed', trace: { failures: [failure('edit:error:cannot+modify')] } },
  { id: 'c', outcome: 'completed', trace: { failures: [failure('edit:error:other', 'the tool is broken')] } },
]

describe('structured failure candidates', () => {
  it('groups repeated failures with case and outcome evidence', () => {
    const result = buildFailureCandidates(cases)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      signature: 'edit:error:cannot+modify', count: 2, cases: ['a', 'b'], outcomes: ['merged', 'completed'],
    })
    expect(validateFailureCandidate(result.candidates[0])).toEqual([])
  })

  it('quarantines an ability verdict instead of storing it as a symptom', () => {
    const result = buildFailureCandidates(cases)
    expect(result.quarantined).toBe(1)
    expect(result.candidates.some(candidate => candidate.signature === 'edit:error:other')).toBe(false)
  })

  it('validates playbook text: bounded, no ability verdict, at least one action', () => {
    expect(validatePlaybookText('When edit reports file has not been read, read it and retry once.')).toEqual([])
    expect(validatePlaybookText('the tool is broken')).not.toEqual([])
    expect(validatePlaybookText('Good builds are important.')).not.toEqual([])
    expect(validatePlaybookText('read '.repeat(1000))).not.toEqual([])
  })
})
