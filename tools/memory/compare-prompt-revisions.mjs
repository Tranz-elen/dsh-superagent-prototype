/**
 * Descriptive ON/OFF comparison for the prompt-revision experiment.
 *
 * It reads cases with a pinned `promptRevision`, digests their worker traces, and
 * reports counts. It does not run a significance test or claim causality; small
 * groups are explicitly marked insufficient.
 *
 * Usage: node compare-prompt-revisions.mjs [--cases ...] [--sessions ...] [--since ISO] [--on 5] [--off 4] [--include-local] [--json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { digestCase } from './session-digest.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const STATE = process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CASES = arg('cases', join(STATE, 'cases.jsonl'))
const SESSIONS = arg('sessions', join(DSH_HOME, 'sessions'))
const SINCE = arg('since', '')
const ON = Number(arg('on', '5'))
const OFF = Number(arg('off', '4'))
const OUT = arg('out', '')
const AS_JSON = args.includes('--json')
const INCLUDE_LOCAL = args.includes('--include-local')

const mean = values => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null
const summarize = (rows, label) => ({
  label,
  n: rows.length,
  outcomes: rows.reduce((map, row) => (map[row.outcome] = (map[row.outcome] ?? 0) + 1, map), {}),
  retries: rows.reduce((sum, row) => sum + (row.cost?.retries ?? 0), 0),
  humanFollowUps: rows.reduce((sum, row) => sum + (row.cost?.humanFollowUps ?? 0), 0),
  meanSteps: mean(rows.map(row => row.trace?.steps ?? 0)),
  meanBash: mean(rows.map(row => (row.trace?.bash ?? []).length)),
  failedBash: rows.reduce((sum, row) => sum + (row.trace?.bash ?? []).filter(command => command.exit !== 0).length, 0),
  editErrorTickets: rows.filter(row => (row.trace?.failures ?? []).some(failure => failure.tool === 'edit' && failure.signature.includes('cannot+modify'))).length,
  blockedReports: rows.filter(row => (row.reports ?? []).some(report => report.state === 'blocked' || report.state === 'failed')).length,
  insufficient: rows.length < 5,
})

export function summarizePromptRevisions(cases, options = {}) {
  const on = options.on ?? 5, off = options.off ?? 4
  const since = options.since ? Date.parse(options.since) : undefined
  const rows = cases.filter(c => typeof c.promptRevision === 'number'
    && !String(c.title ?? '').includes('A/B')
    && (options.includeLocal === true || c.source !== 'local')
    && (!since || (c.endedAt && Date.parse(c.endedAt) >= since)))
  for (const row of rows) if (!row.trace) row.trace = digestCase(row, options.sessionsRoot ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions'))
  const groups = [summarize(rows.filter(c => c.promptRevision === on), 'ON'), summarize(rows.filter(c => c.promptRevision === off), 'OFF')]
  return { on, off, since: options.since ?? null, groups, totalPinned: rows.length }
}

const cases = readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const result = summarizePromptRevisions(cases, { on: ON, off: OFF, since: SINCE || undefined, sessionsRoot: SESSIONS, includeLocal: INCLUDE_LOCAL })
if (AS_JSON) {
  const text = `${JSON.stringify(result, null, 2)}\n`
  if (OUT) writeFileSync(OUT, text)
  process.stdout.write(text)
} else {
  const lines = ['| group | revision | n | outcomes | retries | human | mean steps | mean bash | failed bash | edit errors | blocked reports |', '|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|']
  for (const group of result.groups) lines.push(`| ${group.label} | ${group.label === 'ON' ? result.on : result.off} | ${group.n} | ${JSON.stringify(group.outcomes)} | ${group.retries} | ${group.humanFollowUps} | ${group.meanSteps ?? '—'} | ${group.meanBash ?? '—'} | ${group.failedBash} | ${group.editErrorTickets} | ${group.blockedReports} |`)
  lines.push('', result.totalPinned === 0 ? 'No pinned cases yet; the experiment has not produced data.' : 'Small groups are insufficient for a causal claim; require at least 20/arm for the final decision.')
  const text = `${lines.join('\n')}\n`
  if (OUT) writeFileSync(OUT, text)
  process.stdout.write(text)
}
