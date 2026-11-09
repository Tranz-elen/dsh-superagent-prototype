/**
 * Validate tools/memory/rules.json against cases.jsonl.
 *
 * Usage: node check-rules.mjs [--rules tools/memory/rules.json] [--cases <stateDir>/cases.jsonl]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateRules } from './rules.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const stateDir = process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent')
const RULES = arg('rules', join(process.cwd(), 'tools', 'memory', 'rules.json'))
const CASES = arg('cases', join(stateDir, 'cases.jsonl'))
const document = JSON.parse(readFileSync(RULES, 'utf8'))
const cases = readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const errors = validateRules(document, { knownCases: new Set(cases.map(c => c.id)) })
if (errors.length) {
  console.error(`rules invalid (${errors.length}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`rules valid: ${document.rules.length} rule(s), ${document.rules.reduce((n, rule) => n + rule.evidence.length, 0)} evidence case(s)`)
}
