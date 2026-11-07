/**
 * Phase 0b — export Decisions that never became Tickets.
 *
 * The case corpus only carries Tickets, so an `ignore`, a refused `stop`, or an
 * `unavailable` assessment leaves no trace there — yet those are exactly the
 * "should this be accepted?" boundary samples. This reads them from the store and
 * writes one line each, with the Trigger they judged.
 *
 * Usage: node export-decisions.mjs [--db <path>] [--out <path>]
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const STATE = process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent')
const DB = arg('db', join(STATE, 'orchestrator.sqlite'))
const OUT = arg('out', join(STATE, 'decisions.jsonl'))

const db = new DatabaseSync(DB, { readOnly: true })
const rows = table => db.prepare(`SELECT value FROM "${table}"`).all().map(r => JSON.parse(r.value))
const decisions = rows('decision')
const triggers = new Map(rows('trigger').map(t => [t.id, t]))
const threads = new Map(rows('thread').map(t => [t.key, t]))

const cases = decisions.filter(d => !d.ticketId).map(d => {
  const trigger = d.triggerIds?.map(id => triggers.get(id)).find(Boolean)
  const thread = threads.get(d.threadKey)
  return {
    id: d.id,
    at: d.at,
    kind: d.kind,
    strength: d.strength,
    reasons: (d.reason ?? []).map(r => r.code),
    policyVersion: d.policyVersion,
    thread: d.threadKey,
    ...(thread?.meta?.title ? { threadTitle: thread.meta.title } : {}),
    ...(trigger ? { trigger: {
      text: trigger.text,
      actor: trigger.actor,
      human: trigger.human,
      ...(trigger.addressed ? { addressed: trigger.addressed } : {}),
      ...(trigger.url ? { url: trigger.url } : {}),
      ...(trigger.meta?.kind ? { kind: trigger.meta.kind } : {}),
    } } : {}),
    ...(d.audit ? { audit: d.audit } : {}),
  }
})

writeFileSync(OUT, cases.map(c => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : ''))
console.log(`wrote ${cases.length} decision-only records to ${OUT}`)
const byKind = cases.reduce((m, c) => (m[c.kind] = (m[c.kind] ?? 0) + 1, m), {})
const byReason = cases.reduce((m, c) => { for (const r of c.reasons) m[r] = (m[r] ?? 0) + 1; return m }, {})
console.log('by kind:', JSON.stringify(byKind))
console.log('by reason:', JSON.stringify(byReason))
for (const c of cases) console.log(`- ${c.kind} ${c.reasons.join(',')} :: ${c.threadTitle ?? c.thread} :: ${(c.trigger?.text ?? '').slice(0, 60).replace(/\n/g, ' ')}`)
