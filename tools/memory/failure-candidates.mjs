/**
 * Structured failure candidates for the offline playbook review.
 *
 * A candidate is evidence, not a rule: repeated tool failures with case ids,
 * outcomes and a symptom. The reviewer must supply a possible cause, a
 * cheapest falsifying probe and an action; nothing here is written to a prompt.
 */
import { hasAbilityVerdict } from './failure-signatures.mjs'

export const FAILURE_MIN_CASES = 2
export const PLAYBOOK_MAX_BYTES = 2 * 1024

/** Build repeated-failure candidates from analyzed cases (each with trace.failures). */
export function buildFailureCandidates(cases, options = {}) {
  const minCount = options.minCount ?? FAILURE_MIN_CASES
  const bySignature = new Map()
  let quarantined = 0
  let failures = 0
  for (const c of cases) {
    for (const f of c.trace?.failures ?? []) {
      if (f.quarantined || hasAbilityVerdict(f.detail)) { quarantined += 1; continue }
      if (!f.signature) continue
      failures += 1
      const entry = bySignature.get(f.signature) ?? { signature: f.signature, count: 0, cases: new Set(), outcomes: new Set(), symptom: f.detail }
      entry.count += 1
      entry.cases.add(c.id)
      entry.outcomes.add(c.outcome)
      if (f.detail.length > entry.symptom.length) entry.symptom = f.detail
      bySignature.set(f.signature, entry)
    }
  }
  const candidates = [...bySignature.values()]
    .filter(entry => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
    .map(entry => ({
      signature: entry.signature,
      count: entry.count,
      cases: [...entry.cases],
      outcomes: [...entry.outcomes],
      symptom: entry.symptom,
      needs: 'a human-written possible cause, a cheapest falsifying probe, and an action',
    }))
  return { candidates, quarantined, failures, minCount }
}

/** Reject a candidate that lacks evidence or smuggles an ability verdict into its symptom. */
export function validateFailureCandidate(candidate) {
  const errors = []
  if (!candidate?.signature) errors.push('signature is required')
  if (!Array.isArray(candidate?.cases) || candidate.cases.length < FAILURE_MIN_CASES) errors.push(`at least ${FAILURE_MIN_CASES} cases are required`)
  if (!candidate?.symptom) errors.push('symptom is required')
  if (hasAbilityVerdict(candidate?.symptom)) errors.push('symptom must not make an ability verdict')
  return errors
}

/** Validate a human-reviewable playbook text before it is pasted into a prompt section. */
export function validatePlaybookText(text, options = {}) {
  const maxBytes = options.maxBytes ?? PLAYBOOK_MAX_BYTES
  const errors = []
  const value = String(text ?? '').trim()
  if (!value) errors.push('playbook is empty')
  if (Buffer.byteLength(value, 'utf8') > maxBytes) errors.push(`playbook exceeds ${maxBytes} bytes`)
  if (hasAbilityVerdict(value)) errors.push('playbook must not make an ability verdict')
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length > 20) errors.push('playbook has more than 20 rule lines')
  if (lines.length && !lines.some(line => /\b(read|retry|rerun|run|check|ask|stop|switch|verify|use|open|write|edit|hand off|move|delete|restore)\b/i.test(line))) {
    errors.push('at least one rule must contain an executable action')
  }
  return errors
}

/** JSON shape written by analyze-cases and consumed by distill. */
export function failureCandidatesDocument(result, options = {}) {
  return { generatedAt: new Date().toISOString(), cases: options.cases ?? null, minCount: result.minCount,
    candidates: result.candidates, quarantined: result.quarantined, failures: result.failures }
}
