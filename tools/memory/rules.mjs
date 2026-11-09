/**
 * Reviewed playbook rules with mandatory evidence.
 *
 * A prompt line without cited cases is not a rule. This validator is used by
 * check-rules.mjs and tests; it never edits a prompt.
 */
import { validatePlaybookText } from './failure-candidates.mjs'

const CONFIDENCE = new Set(['high', 'medium'])
const ROLES = new Set(['worker', 'orchestrator'])

/** Validate a rules.json document; when knownCases is provided every case id must exist. */
export function validateRules(document, options = {}) {
  const errors = []
  if (document?.version !== 1) errors.push('rules version must be 1')
  if (!Array.isArray(document?.rules)) return [...errors, 'rules must be an array']
  const ids = new Set()
  const knownCases = options.knownCases
  for (const [index, rule] of document.rules.entries()) {
    const where = `rules[${index}]`
    if (!rule?.id || typeof rule.id !== 'string') errors.push(`${where}.id is required`)
    else if (ids.has(rule.id)) errors.push(`${where}.id is duplicated: ${rule.id}`)
    else ids.add(rule.id)
    if (!rule?.rule || typeof rule.rule !== 'string') errors.push(`${where}.rule is required`)
    else for (const problem of validatePlaybookText(rule.rule)) errors.push(`${where}.rule: ${problem}`)
    if (!Array.isArray(rule?.evidence) || rule.evidence.length < 3) errors.push(`${where}.evidence needs at least 3 case ids`)
    else {
      if (new Set(rule.evidence).size !== rule.evidence.length) errors.push(`${where}.evidence has duplicate ids`)
      if (knownCases) for (const id of rule.evidence) if (!knownCases.has(id)) errors.push(`${where}.evidence references an unknown case: ${id}`)
    }
    if (!rule?.check || typeof rule.check !== 'string') errors.push(`${where}.check is required`)
    for (const field of ['reviewAfter', 'expiresAt']) {
      if (rule?.[field] === undefined) continue
      const time = Date.parse(rule[field])
      if (!Number.isFinite(time)) errors.push(`${where}.${field} must be an ISO date`)
      else if (field === 'expiresAt' && time <= Date.now()) errors.push(`${where}.expiresAt is in the past`)
      else if (field === 'reviewAfter' && time <= Date.now()) errors.push(`${where}.reviewAfter is overdue`)
    }
    if (!CONFIDENCE.has(rule?.confidence)) errors.push(`${where}.confidence must be high or medium`)
    const roles = rule?.scope?.roles
    if (!Array.isArray(roles) || roles.length === 0) errors.push(`${where}.scope.roles needs at least one role`)
    else for (const role of roles) if (!ROLES.has(role)) errors.push(`${where}.scope.roles has an unknown role: ${role}`)
  }
  return errors
}
