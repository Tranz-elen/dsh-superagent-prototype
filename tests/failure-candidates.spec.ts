import { describe, expect, it } from 'vitest'
import { buildFailureCandidates, validateFailureCandidate, validatePlaybookText } from '../tools/memory/failure-candidates.mjs'

const failure = (signature: string, detail = 'Error: cannot modify: file has not been read', tool = 'edit') => ({ signature, detail, tool, quarantined: false })
const cases = [
  { id: 'a', outcome: 'merged', trace: { failures: [failure('edit:error:cannot+modify')] } },
  { id: 'b', outcome: 'completed', trace: { failures: [failure('edit:error:cannot+modify')] } },
  { id: 'c', outcome: 'completed', trace: { failures: [failure('edit:error:other', 'the tool is broken')] } },
  { id: 'd', outcome: 'merged', trace: { failures: [failure('orchestrator_ack:error:acknowledgement+requires', 'Acknowledgement requires an assigned human source message', 'orchestrator_ack')] } },
]

describe('structured failure candidates', () => {
  it('groups repeated failures with case and outcome evidence', () => {
    const result = buildFailureCandidates(cases)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      signature: 'edit:error:cannot+modify', count: 2, cases: ['a', 'b'], outcomes: ['merged', 'completed'], suggestedScope: 'worker',
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


it('suggests orchestrator or environment scope instead of forcing every failure into a worker rule', () => {
  const result = buildFailureCandidates([
    { id: 'o1', outcome: 'merged', trace: { failures: [failure('orchestrator_ack:error:acknowledgement+requires', 'Acknowledgement requires an assigned human source message', 'orchestrator_ack')] } },
    { id: 'o2', outcome: 'completed', trace: { failures: [failure('orchestrator_ack:error:acknowledgement+requires', 'Acknowledgement requires an assigned human source message', 'orchestrator_ack')] } },
    { id: 'e1', outcome: 'merged', trace: { failures: [failure('bash:http-404:docs.github.com+exit-1', 'gh: Not Found (HTTP 404)', 'bash')] } },
    { id: 'e2', outcome: 'completed', trace: { failures: [failure('bash:http-404:docs.github.com+exit-1', 'gh: Not Found (HTTP 404)', 'bash')] } },
  ])
  expect(result.candidates.find(candidate => candidate.suggestedScope === 'orchestrator')).toBeTruthy()
  expect(result.candidates.find(candidate => candidate.suggestedScope === 'environment')).toBeTruthy()
})
