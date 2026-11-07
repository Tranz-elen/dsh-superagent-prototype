/**
 * Case export: one JSONL line per ended Ticket, appended next to the state database.
 *
 * This is the durable capture step of the memory pipeline: every Ticket that ends leaves a
 * self-contained case (request, decision, mandate, outcome, cost, reports) so rules can later
 * be distilled from outcomes instead of guessed from prose. It runs in-process so a case is
 * written whenever the Ticket ends, and catches up on startup for Tickets that ended while
 * the host was down.
 *
 * Decisions that never became Tickets (an ignore, a refused stop, an unavailable assessment) are
 * written to `<stateDir>/decisions.jsonl` by the same mechanism, because they are the boundary
 * samples for "should this be accepted?".
 *
 * Writing is idempotent per record: the files' existing ids are loaded at start, and a line is
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

/** A Decision that never became a Ticket: the boundary sample an ignore, stop or unavailable leaves. */
export interface DecisionRecord {
  id: string
  at: string
  kind: string
  strength: string
  reasons: string[]
  policyVersion: string
  thread: string
  threadTitle?: string
  trigger?: {
    text: string
    actor: { source: string; id: string }
    human: boolean
    addressed?: 'mention' | 'direct'
    url?: string
    kind?: string
  }
  audit?: Record<string, unknown>
}

/** Reduces a Decision and the Trigger it judged into a decision-only record. */
export function decisionOf(input: { decision: Decision; trigger?: Trigger; threadTitle?: string }): DecisionRecord {
  const { decision, trigger, threadTitle } = input
  const kind = trigger?.meta?.kind
  return {
    id: decision.id,
    at: decision.at,
    kind: decision.kind,
    strength: decision.strength,
    reasons: decision.reason.map(reason => reason.code),
    policyVersion: decision.policyVersion,
    thread: decision.threadKey,
    ...(threadTitle ? { threadTitle } : {}),
    ...(trigger ? { trigger: {
      text: trigger.text,
      actor: trigger.actor,
      human: trigger.human,
      ...(trigger.addressed ? { addressed: trigger.addressed } : {}),
      ...(trigger.url ? { url: trigger.url } : {}),
      ...(typeof kind === 'string' ? { kind } : {}),
    } } : {}),
    ...(decision.audit ? { audit: decision.audit } : {}),
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

/** Appends one case per ended ticket and one record per ticket-less decision, once each. */
export class CaseExport {
  readonly file: string
  /** Decisions that never became Tickets: ignore, refused stop, unavailable. */
  readonly decisionsFile: string
  private readonly exported = new Set<string>()
  private readonly exportedDecisions = new Set<string>()
  private readonly store: Store
  private readonly report: (error: unknown) => void
  private started = false
  /** Serializes flushes so a request during a running flush runs after it, and lets shutdown wait for both. */
  private chain: Promise<void> = Promise.resolve()

  constructor(options: CaseExportOptions) {
    this.store = options.store
    this.file = join(options.stateDir, 'cases.jsonl')
    this.decisionsFile = join(options.stateDir, 'decisions.jsonl')
    this.report = options.report ?? (() => {})
  }

  /** Loads the ids already on disk, then catches up on tickets that ended and decisions that were made earlier. */
  async start(): Promise<void> {
    this.load()
    this.started = true
    this.chain = this.chain.then(async () => { await this.flush(); await this.flushDecisions() })
    await this.chain
  }

  /** Stops accepting new work; `idle()` still waits for a flush already running so the store can close safely. */
  stop(): void { this.started = false }

  /** Asks for a flush after a ticket ended; safe to call inside the Engine's transaction because the write is deferred. */
  request(): void {
    if (!this.started) return
    this.chain = this.chain.then(() => this.flush())
  }

  /** Asks for the record of a Decision that ended without a Ticket; deferred like `request`. */
  requestDecision(decisionId: string): void {
    if (!this.started) return
    this.chain = this.chain.then(() => this.flushDecisions(decisionId))
  }

  /** Resolves once every requested flush has run. */
  idle(): Promise<void> { return this.chain }

  /** Exported ticket-case count, for tests and status reads. */
  get size(): number { return this.exported.size }

  /** Exported decision-only count, for tests and status reads. */
  get decisionSize(): number { return this.exportedDecisions.size }

  private load(): void {
    this.loadIds(this.file, this.exported)
    this.loadIds(this.decisionsFile, this.exportedDecisions)
  }

  private loadIds(file: string, into: Set<string>): void {
    if (!existsSync(file)) return
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { into.add((JSON.parse(line) as { id: string }).id) } catch { /* a partial trailing line is ignored */ }
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

  private async flushDecisions(only?: string): Promise<void> {
    if (!this.started) return
    try {
      for (const decision of this.store.decisions.list()) {
        if (decision.ticketId || this.exportedDecisions.has(decision.id)) continue
        if (only !== undefined && decision.id !== only) continue
        const triggerId = decision.triggerIds[0]
        const trigger = triggerId ? this.store.triggers.get(triggerId) : undefined
        const title = this.store.threads.get(decision.threadKey)?.meta?.title
        const record = decisionOf({ decision, ...(trigger ? { trigger } : {}), ...(typeof title === 'string' ? { threadTitle: title } : {}) })
        appendFileSync(this.decisionsFile, `${JSON.stringify(record)}\n`, { mode: 0o600 })
        this.exportedDecisions.add(decision.id)
      }
    } catch (error) {
      this.report(error)
    }
  }
}
