/** Case export: one line per ended ticket, written once, attributed to the ticket's decision and trigger. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { CaseExport, type CaseRecord } from '../src/app/cases.ts'
import { Engine, type Assessor, type Candidate, type Decision, type Executor, type Outbox, type Policy, type Ticket, type Trigger }
  from '../src/core/index.ts'

let directory: string
let store: Store
const at = '2026-11-07T08:50:43.106Z', endedAt = '2026-11-07T08:56:21.457Z'

const trigger: Trigger = { id: 'trigger-1', source: 'github', threads: [{ source: 'github', id: '7' }],
  actor: { source: 'github', id: 'alice' }, human: true, addressed: 'mention', at,
  text: '@bot 修正 README 第 1 节的错别字', url: 'https://github.com/acme/repo/issues/7', meta: { kind: 'issue', number: 7 } }
const decision: Decision = { id: 'decision-1', evalId: 'eval-1', threadKey: 'github:7', triggerIds: ['trigger-1'],
  policyVersion: 'policy-1', at, kind: 'accept', reason: [{ code: 'explicitRouted' }], strength: 'explicit', ticketId: 'ticket-1' }
const ticket: Ticket = { id: 'ticket-1', title: '修正 README 第 1 节的错别字', decisionId: 'decision-1',
  mandate: { strength: 'explicit', policyVersion: 'policy-1', actor: { source: 'github', id: 'alice' }, scope: '修正 README 错别字',
    basis: { source: 'github', scope: { kind: 'issue' }, row: 'issues', sender: 'alice', via: 'addressed', addressed: 'mention' } },
  channels: [], ended: { at: endedAt, by: 'human', outcome: 'stopped' },
  assignments: [{ id: 'assignment-1', state: 'ended', createdAt: at, report: { state: 'progress', summary: 'reading the file', at } }],
  inputs: [], undelivered: [], createdAt: at, updatedAt: endedAt, origin: { triggerId: 'trigger-1', triggerIds: ['trigger-1'] } }

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-cases-'))
  store = new Store(join(directory, 'orchestrator.sqlite'))
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })

it('writes one case per ended ticket, with its decision, trigger and cost', async () => {
  store.triggers.save(trigger)
  store.decisions.save(decision)
  store.tickets.save(ticket)
  const exporter = new CaseExport({ store, stateDir: directory })
  await exporter.start()
  const lines = readFileSync(exporter.file, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)
  const record = JSON.parse(lines[0]!)
  expect(record).toMatchObject({
    id: 'ticket-1', title: '修正 README 第 1 节的错别字', intent: 'docs', outcome: 'stopped', endedBy: 'human',
    repo: 'acme/repo', requester: 'alice', sessionId: 'worker-ticket-1',
    decision: { kind: 'accept', reasons: ['explicitRouted'], strength: 'explicit' },
    mandate: { scope: '修正 README 错别字', via: 'addressed' },
    cost: { assignments: 1, retries: 0, reports: ['progress'] },
  })
  expect(record.reports).toEqual([{ state: 'progress', summary: 'reading the file' }])
})

it('does not write the same ticket twice, on a later start or after a request', async () => {
  store.triggers.save(trigger)
  store.decisions.save(decision)
  store.tickets.save(ticket)
  const first = new CaseExport({ store, stateDir: directory })
  await first.start()
  first.request()
  await first.idle()
  const second = new CaseExport({ store, stateDir: directory })
  await second.start()
  second.request()
  await second.idle()
  expect(readFileSync(second.file, 'utf8').trim().split('\n')).toHaveLength(1)
})

it('catches up on a ticket that ended before startup', async () => {
  store.triggers.save(trigger)
  store.decisions.save(decision)
  store.tickets.save(ticket)
  const exporter = new CaseExport({ store, stateDir: directory })
  await exporter.start()
  expect(exporter.size).toBe(1)
})

it('exports a Ticket the Engine ended, and a later exporter does not write it again', async () => {
  const requestAt = '2026-11-07T10:24:11.000Z'
  const request: Trigger = { id: 'trigger-lifecycle', source: 'github', threads: [{ source: 'github', id: '42' }],
    actor: { source: 'github', id: 'alice' }, human: true, addressed: 'mention', at: requestAt,
    text: '@bot 给 case 导出补一条集成用例', url: 'https://github.com/acme/repo/issues/42',
    meta: { kind: 'issue', number: 42, repository: 'acme/repo' } }
  let time = Date.parse(requestAt)
  const advance = (minutes: number) => { time += minutes * 60_000 }
  const policy: Policy = {
    version: 'policy-1', paused: false, evalTimeoutMs: 60_000,
    gate: () => ({ admissible: true, strength: 'explicit',
      basis: { source: 'github', scope: { kind: 'issue' }, row: 'issues', sender: 'alice', via: 'addressed', addressed: 'mention' } }),
    revalidate: () => true, admitsInferred: () => true,
  }
  const candidates: Candidate[] = []
  const assessor: Assessor = { request: candidate => { candidates.push(candidate) } }
  const executor: Executor = { start: () => {}, deliver: () => {}, stop: () => {} }
  const outbox: Outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, policy: () => policy, scope: { scope: () => ({ listened: true, observed: false }) },
    assessor, executor, outbox, now: () => new Date(time).toISOString() })

  // The real lifecycle: a person's request is admitted, accepted, worked on, reported ready and ended.
  expect(engine.receive(request)).toBe('stored')
  engine.evaluateDue()
  const candidate = candidates[0]!
  const title = 'test: 给 case 导出补一条集成用例', scope = '补一条 case 导出的集成用例'
  const accepted = engine.decide(request.id, { kind: 'accept', title, scope, reason: { code: 'explicitRouted' },
    acknowledgement: '收到，我会补一条集成用例。', evalId: candidate.evalId })
  const endedTicket = store.tickets.get(accepted.ticketId!)!
  engine.assignmentStarted(endedTicket.id, endedTicket.assignments[0]!.id)
  advance(6)
  const ended = engine.report(endedTicket.id, { state: 'ready', summary: '集成用例已补充并通过测试' })
  expect(ended.ended).toMatchObject({ by: 'executor', outcome: 'completed' })

  const exporter = new CaseExport({ store, stateDir: directory })
  await exporter.start()
  const lines = readFileSync(exporter.file, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)
  const record = JSON.parse(lines[0]!) as CaseRecord
  expect(record).toMatchObject({
    id: endedTicket.id,
    repo: 'acme/repo',
    source: 'github',
    kind: 'issue',
    title,
    request: request.text,
    requester: 'alice',
    addressed: 'mention',
    // The fake executor gives the ticket no work directory, so its changed files stay unknown.
    intent: 'feature',
    areas: [],
    files: [],
    decision: { kind: 'accept', reasons: ['explicitRouted'], strength: 'explicit' },
    mandate: { scope, via: 'addressed' },
    outcome: 'completed',
    endedBy: 'executor',
    // No reason beyond the outcome was recorded, so the export falls back to who ended the ticket.
    endReason: 'executor',
    follows: [],
    cost: { assignments: 1, retries: 0, reports: ['ready'], humanFollowUps: 0, handbacks: 0, requeued: false, attention: 0, answers: 0 },
    reports: [{ state: 'ready', summary: '集成用例已补充并通过测试' }],
    sessionId: `worker-${endedTicket.id}`,
    createdAt: endedTicket.createdAt,
    endedAt: ended.ended!.at,
  })
  expect(Date.parse(record.endedAt!)).toBeGreaterThan(Date.parse(record.createdAt))

  const restarted = new CaseExport({ store, stateDir: directory })
  await restarted.start()
  expect(readFileSync(restarted.file, 'utf8').trim().split('\n')).toHaveLength(1)
  expect(restarted.size).toBe(1)
})
