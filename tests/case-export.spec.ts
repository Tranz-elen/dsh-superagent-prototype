/** Case export: one line per ended ticket, written once, attributed to the ticket's decision and trigger. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Store } from '../src/app/store.ts'
import { CaseExport } from '../src/app/cases.ts'
import type { Decision, Ticket, Trigger } from '../src/core/index.ts'

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
