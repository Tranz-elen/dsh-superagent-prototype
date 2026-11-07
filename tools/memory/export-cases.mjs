/**
 * Phase 0 — export dsh-superagent tickets into case records (JSONL).
 *
 * Reads the superagent SQLite store (read-only) plus each Executor work directory,
 * and emits one self-contained case per ticket: what was asked, how it was decided,
 * what the worker did, how it ended, and what it cost.
 *
 * Usage:
 *   node export-cases.mjs [--db <path>] [--out <path>]
 * Defaults: /root/.dsh/state/superagent/orchestrator.sqlite, ./cases.jsonl
 */
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const STATE = process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const DB = arg('db', join(STATE, 'orchestrator.sqlite'))
const OUT = arg('out', join(STATE, 'cases.jsonl'))
const SESSIONS = arg('sessions', join(DSH_HOME, 'sessions'))

const db = new DatabaseSync(DB, { readOnly: true })
const rows = table => db.prepare(`SELECT value FROM "${table}"`).all().map(r => JSON.parse(r.value))

const tickets = rows('ticket')
const decisions = rows('decision')
const triggers = rows('trigger')
const threads = rows('thread')
const dispositions = rows('disposition')

const byId = (list, pick) => new Map(list.map(item => [pick(item), item]))
const triggerById = byId(triggers, t => t.id)
const threadByKey = byId(threads, t => t.key)
const decisionByTicket = byId(decisions.filter(d => d.ticketId), d => d.ticketId)
const dispositionByTrigger = byId(dispositions, d => d.id)

/** Files a worker's assignment changed relative to the base branch, from its work directory. */
function changedFiles(ticket) {
  const dir = ticket.execution?.directory
  if (!dir || !existsSync(dir)) return []
  try {
    const base = execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'origin/main'], { encoding: 'utf8' }).trim()
    if (!base) return []
    return execFileSync('git', ['-C', dir, 'diff', '--name-only', base], { encoding: 'utf8' })
      .split('\n').map(l => l.trim()).filter(Boolean)
  } catch { return [] }
}

const AREA = file => file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)'
function intentOf(title, text, files) {
  // A conventional prefix names the work; the rest of the title names its subject.
  const prefix = /^\s*(bugfix|hotfix|fix|docs?|documentation|tests?|refactor|perf|chore|ci|build|feat|feature)\b\s*[:\-—]/i.exec(title)?.[1]?.toLowerCase()
  if (prefix) {
    if (['bugfix', 'hotfix', 'fix'].includes(prefix)) return 'bugfix'
    if (['doc', 'docs', 'documentation'].includes(prefix)) return 'docs'
    if (['test', 'tests'].includes(prefix)) return 'test'
    if (['refactor', 'perf', 'chore'].includes(prefix)) return 'refactor'
    if (['ci', 'build'].includes(prefix)) return 'ci'
    if (['feat', 'feature'].includes(prefix)) return 'feature'
  }
  const s = `${title}\n${text}`
  if (/文档|README|docs|说明/i.test(s)) return 'docs'
  if (/重构|refactor|rename|move/i.test(s)) return 'refactor'
  if (/修复|bug|fix|错误|报错/i.test(s)) return 'bugfix'
  if (/\.github\/workflows|CI|workflow/i.test(s)) return 'ci'
  if (files.some(f => /\.(test|spec)\./.test(f))) return 'test'
  if (files.length > 0 && files.every(f => /\.(md|mdx|txt)$/.test(f))) return 'docs'
  return 'feature'
}

/** Worker session transcript directory (zstd JSONL), for the later lesson-extraction stage. */
function sessionOf(ticket) {
  // A worker Session directory is named after the ticket id, under the work directory named after the Execution.
  const home = SESSIONS
  const match = ticket.execution?.name && readdirSync(home).find(name => name.endsWith(`work-${ticket.execution.name}--`))
  if (!match) return undefined
  for (const dir of [`worker-${ticket.id}`, ...readdirSync(join(home, match))]) {
    const candidate = join(home, match, dir)
    if (!existsSync(candidate)) continue
    const file = readdirSync(candidate).find(name => name.startsWith('session.') && name.endsWith('.zstd'))
    if (file) return join(candidate, file)
  }
  return undefined
}

/** The repository a Trigger came from, from its GitHub URL when the Source meta does not carry it. */
function repoOf(trigger) {
  const fromMeta = trigger?.meta?.repository ?? trigger?.meta?.repo
  if (fromMeta) return fromMeta
  const match = /github\.com\/([^/]+\/[^/#?]+)/.exec(trigger?.url ?? '')
  return match ? match[1] : undefined
}
/** Why a ticket ended, from the executor or a person, normalized into one reason string. */
const endReason = ticket => ticket.ended?.reason ?? ticket.ended?.by ?? 'open'

const cases = tickets.map(ticket => {
  const trigger = triggerById.get(ticket.origin?.triggerId)
  const decision = decisionByTicket.get(ticket.id)
  const files = changedFiles(ticket)
  const assignments = ticket.assignments ?? []
  const reports = assignments.flatMap(a => a.report ? [{ state: a.report.state, summary: a.report.summary }] : [])
  const humanFollowUps = (ticket.inputs ?? []).filter(i => i.kind === 'trigger' && i.human).length
  const disposition = trigger ? dispositionByTrigger.get(trigger.id) : undefined
  const follows = (ticket.follows ?? []).map(f => f.closed ? f.closed.outcome : 'open')
  const parts = new Set(files.map(AREA))
  return {
    id: ticket.id,
    repo: repoOf(trigger),
    source: trigger?.source,
    kind: ticket.mandate?.basis?.scope?.kind ?? trigger?.meta?.kind,
    title: ticket.title,
    request: trigger?.text,
    requester: trigger?.actor?.id,
    addressed: trigger?.addressed,
    intent: intentOf(ticket.title, trigger?.text ?? '', files),
    areas: [...parts],
    files,
    decision: decision ? { kind: decision.kind, reasons: (decision.reason ?? []).map(r => r.code), strength: decision.strength } : undefined,
    mandate: ticket.mandate ? { scope: ticket.mandate.scope, via: ticket.mandate.basis?.via } : undefined,
    outcome: ticket.ended?.outcome ?? 'open',
    endedBy: ticket.ended?.by,
    endReason: endReason(ticket),
    follows,
    cost: {
      assignments: assignments.length,
      retries: Math.max(0, assignments.length - 1),
      reports: reports.map(r => r.state),
      humanFollowUps,
      handbacks: disposition?.handbacks?.length ?? 0,
      requeued: disposition?.requeued === true,
      attention: ticket.attention ? 1 : 0,
      answers: (ticket.answers ?? []).length,
    },
    reports,
    session: sessionOf(ticket),
    createdAt: ticket.createdAt,
    endedAt: ticket.ended?.at,
  }
})

writeFileSync(OUT, cases.map(c => JSON.stringify(c)).join('\n') + '\n')
console.log(`wrote ${cases.length} cases to ${OUT}`)
for (const c of cases) {
  console.log(`- ${c.id.slice(0, 12)} ${c.outcome.padEnd(8)} ${String(c.intent).padEnd(7)} ${c.areas.join(',') || '-'} :: ${c.title}`)
}
