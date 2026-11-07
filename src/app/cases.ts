/**
 * Case export: one JSONL line per ended Ticket, appended next to the state database.
 *
 * This is the durable capture step of the memory pipeline: every Ticket that ends leaves a
 * self-contained case (request, decision, mandate, outcome, cost, reports) so rules can later
 * be distilled from outcomes instead of guessed from prose. It runs in-process so a case is
 * written whenever the Ticket ends, and catches up on startup for Tickets that ended while
 * the host was down.
 *
 * Writing is idempotent per Ticket: the file's existing ids are loaded at start, and a line is
 * appended only once. A malformed or partial last line is ignored on load.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ticketOutcome, type Decision, type Ticket, type Trigger, type TriggerDisposition } from '../core/index.ts'
import { workerSessionId } from '../executor/dsh.ts'
import type { Store } from './store.ts'

const run = promisify(execFile)

/** One ticket, reduced to what a later distillation step needs. Kept in sync with the offline exporter. */
export interface CaseRecord {
  id: string
  repo?: string
  source?: string
  kind?: string
  title: string
  request?: string
  requester?: string
  addressed?: 'mention' | 'direct'
  intent: string
  areas: string[]
  files: string[]
  decision?: { kind: string; reasons: string[]; strength: string }
  mandate?: { scope?: string; via?: string }
  outcome: string
  endedBy?: string
  endReason: string
  follows: string[]
  cost: {
    assignments: number
    retries: number
    reports: string[]
    humanFollowUps: number
    handbacks: number
    requeued: boolean
    attention: number
    answers: number
  }
  reports: { state: string; summary: string }[]
  sessionId: string
  createdAt: string
  endedAt?: string
}

/** Top-level directory a changed file lives under, `(root)` for a file at the repository root. */
const areaOf = (file: string): string => file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)'

/** Classifies a ticket's intent from its title, request and changed files; a conventional title prefix decides first. */
export function intentOf(title: string, text: string, files: readonly string[]): string {
  // "bugfix: 文档类任务…" is a bugfix, not docs: the prefix names the work, the rest names the subject.
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
  // Title first: an issue body may carry a "TEST" marker or quoted logs that must not pick the intent.
  if (/文档|README|docs|说明/i.test(s)) return 'docs'
  if (/重构|refactor|rename|move/i.test(s)) return 'refactor'
  if (/修复|bug|fix|错误|报错/i.test(s)) return 'bugfix'
  if (/\.github\/workflows|CI|workflow/i.test(s)) return 'ci'
  if (files.some(f => /\.(test|spec)\./.test(f))) return 'test'
  if (files.length > 0 && files.every(f => /\.(md|mdx|txt)$/.test(f))) return 'docs'
  return 'feature'
}

/** The repository a Trigger came from, from its GitHub URL when the Source meta does not carry it. */
function repoOf(trigger: Trigger | undefined): string | undefined {
  const meta = trigger?.meta as { repository?: string; repo?: string } | undefined
  if (meta?.repository) return meta.repository
  if (meta?.repo) return meta.repo
  const match = /github\.com\/([^/]+\/[^/#?]+)/.exec(trigger?.url ?? '')
  return match?.[1]
}

/** Reduces a ticket and its sources into a case record. Pure: the caller supplies the changed files. */
export function caseOf(input: {
  ticket: Ticket
  trigger?: Trigger
  decision?: Decision
  disposition?: TriggerDisposition
  files: readonly string[]
}): CaseRecord {
  const { ticket, trigger, decision, disposition, files } = input
  const assignments = ticket.assignments
  const reports = assignments.flatMap(assignment => assignment.report
    ? [{ state: assignment.report.state, summary: assignment.report.summary }] : [])
  const humanFollowUps = ticket.inputs.filter(input => input.kind === 'trigger' && input.human).length
  const areas = [...new Set(files.map(areaOf))]
  const repo = repoOf(trigger)
  const scopeKind = ticket.mandate.basis.scope?.kind
  const kind = typeof scopeKind === 'string' ? scopeKind : undefined
  return {
    id: ticket.id,
    ...(repo ? { repo } : {}),
    ...(trigger?.source ? { source: trigger.source } : {}),
    ...(kind ? { kind } : {}),
    title: ticket.title,
    ...(trigger?.text ? { request: trigger.text } : {}),
    ...(trigger?.actor?.id ? { requester: trigger.actor.id } : {}),
    ...(trigger?.addressed ? { addressed: trigger.addressed } : {}),
    intent: intentOf(ticket.title, trigger?.text ?? '', files),
    areas,
    files: [...files],
    ...(decision ? { decision: { kind: decision.kind, reasons: decision.reason.map(reason => reason.code), strength: decision.strength } } : {}),
    ...(ticket.mandate ? { mandate: { scope: ticket.mandate.scope, via: ticket.mandate.basis.via } } : {}),
    outcome: ticketOutcome(ticket) ?? 'open',
    ...(ticket.ended?.by ? { endedBy: ticket.ended.by } : {}),
    endReason: ticket.ended?.reason ?? ticket.ended?.by ?? 'open',
    follows: ticket.follows?.map(follow => follow.closed?.outcome ?? 'open') ?? [],
    cost: {
      assignments: assignments.length,
      retries: Math.max(0, assignments.length - 1),
      reports: reports.map(report => report.state),
      humanFollowUps,
      handbacks: disposition?.handbacks?.length ?? 0,
      requeued: disposition?.requeued === true,
      attention: ticket.attention ? 1 : 0,
      answers: ticket.answers?.length ?? 0,
    },
    reports,
    sessionId: workerSessionId(ticket.id),
    createdAt: ticket.createdAt,
    ...(ticket.ended?.at ? { endedAt: ticket.ended.at } : {}),
  }
}

/** Changed files of a ticket's work directory against the base branch; empty when unavailable. */
async function changedFiles(directory: string | undefined): Promise<string[]> {
  if (!directory) return []
  for (const base of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      const { stdout: sha } = await run('git', ['-C', directory, 'rev-parse', '--verify', '--quiet', base], { timeout: 5_000 })
      if (!sha.trim()) continue
      const { stdout } = await run('git', ['-C', directory, 'diff', '--name-only', sha.trim()], { timeout: 5_000 })
      return stdout.split('\n').map(line => line.trim()).filter(Boolean)
    } catch { /* try the next base branch */ }
  }
  return []
}

export interface CaseExportOptions {
  store: Store
  stateDir: string
  report?: (error: unknown) => void
}

/** Appends one case per ended ticket to `<stateDir>/cases.jsonl`, once each. */
export class CaseExport {
  readonly file: string
  private readonly exported = new Set<string>()
  private readonly store: Store
  private readonly report: (error: unknown) => void
  private started = false
  /** Serializes flushes so a request during a running flush runs after it, and lets shutdown wait for both. */
  private chain: Promise<void> = Promise.resolve()

  constructor(options: CaseExportOptions) {
    this.store = options.store
    this.file = join(options.stateDir, 'cases.jsonl')
    this.report = options.report ?? (() => {})
  }

  /** Loads the ids already on disk, then catches up on tickets that ended earlier. */
  async start(): Promise<void> {
    this.load()
    this.started = true
    this.chain = this.chain.then(() => this.flush())
    await this.chain
  }

  /** Stops accepting new work; `idle()` still waits for a flush already running so the store can close safely. */
  stop(): void { this.started = false }

  /** Asks for a flush after a ticket ended; safe to call inside the Engine's transaction because the write is deferred. */
  request(): void {
    if (!this.started) return
    this.chain = this.chain.then(() => this.flush())
  }

  /** Resolves once every requested flush has run. */
  idle(): Promise<void> { return this.chain }

  /** Exported count, for tests and status reads. */
  get size(): number { return this.exported.size }

  private load(): void {
    if (!existsSync(this.file)) return
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { this.exported.add((JSON.parse(line) as { id: string }).id) } catch { /* a partial trailing line is ignored */ }
    }
  }

  private async flush(): Promise<void> {
    if (!this.started) return
    try {
      for (const ticket of this.store.tickets.list()) {
        if (!ticket.ended || this.exported.has(ticket.id)) continue
        const trigger = this.store.triggers.get(ticket.origin.triggerId)
        const decision = this.store.decisions.get(ticket.decisionId)
        const disposition = trigger ? this.store.triggers.disposition(trigger.id) : undefined
        const record = caseOf({
          ticket,
          ...(trigger ? { trigger } : {}),
          ...(decision ? { decision } : {}),
          ...(disposition ? { disposition } : {}),
          files: await changedFiles(ticket.execution?.directory),
        })
        appendFileSync(this.file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
        this.exported.add(ticket.id)
      }
    } catch (error) {
      this.report(error)
    }
  }
}
