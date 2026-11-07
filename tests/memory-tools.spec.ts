/** The memory pipeline tools: a fixture corpus goes through analyze and the distill gate, and a fixture store through the decision export. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'memory-tools-')) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const tool = (name: string) => join(process.cwd(), 'tools', 'memory', name)
const run = (name: string, args: string[]): { status: number; output: string } => {
  try {
    return { status: 0, output: execFileSync(process.execPath, [tool(name), ...args], { encoding: 'utf8' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

const caseOf = (id: string, intent: string, outcome: string) => ({
  id, title: `${intent}: ${id}`, request: '@bot do it', intent, areas: [], files: [], outcome, endReason: outcome,
  cost: { assignments: 1, retries: 0, reports: [], humanFollowUps: 0, handbacks: 0, requeued: false, attention: 0, answers: 0 },
  reports: [], sessionId: `worker-${id}`, createdAt: '2026-11-07T00:00:00Z',
})
const writeCases = (cases: object[]): string => {
  const file = join(directory, 'cases.jsonl')
  writeFileSync(file, cases.map(item => JSON.stringify(item)).join('\n') + '\n')
  return file
}

it('analyzes a fixture corpus into a report', () => {
  const cases = writeCases(Array.from({ length: 5 }, (_, i) => caseOf(`c${i}`, 'docs', 'merged')))
  const out = join(directory, 'report.md')
  const result = run('analyze-cases.mjs', ['--cases', cases, '--out', out])
  expect(result.status).toBe(0)
  const report = readFileSync(out, 'utf8')
  expect(report).toContain('cases: **5**')
  expect(report).toContain('docs|merged')
})

it('keeps the distill gate closed below the thresholds', () => {
  const cases = writeCases(Array.from({ length: 5 }, (_, i) => caseOf(`c${i}`, 'docs', 'merged')))
  const out = join(directory, 'dist')
  const result = run('distill.mjs', ['--cases', cases, '--out', out, '--min-cases', '20'])
  expect(result.status).toBe(1)
  expect(readFileSync(join(out, 'status.md'), 'utf8')).toContain('gate: closed')
})

it('opens the gate on 20 cases with a repeated intent|outcome and two outcomes', () => {
  const cases = writeCases([
    ...Array.from({ length: 15 }, (_, i) => caseOf(`d${i}`, 'docs', 'merged')),
    ...Array.from({ length: 4 }, (_, i) => caseOf(`t${i}`, 'test', 'merged')),
    caseOf('s0', 'test', 'stopped'),
  ])
  const out = join(directory, 'dist')
  const result = run('distill.mjs', ['--cases', cases, '--out', out])
  expect(result.status).toBe(0)
  expect(readFileSync(join(out, 'status.md'), 'utf8')).toContain('gate: open')
  const clusters = JSON.parse(readFileSync(join(out, 'clusters.json'), 'utf8')) as { bySignature: Record<string, unknown[]> }
  expect(clusters.bySignature['docs|merged']).toHaveLength(15)
  expect(readFileSync(join(out, 'prompt.md'), 'utf8')).toContain('Never propose a rule from one case')
})

it('exports a decision that never became a ticket', () => {
  const db = new DatabaseSync(join(directory, 'store.sqlite'))
  db.exec(`CREATE TABLE decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE thread (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  db.prepare('INSERT INTO decision VALUES (?,?,?)').run('d1', 'github:11', JSON.stringify({
    id: 'd1', threadKey: 'github:11', triggerIds: ['t1'], policyVersion: 'p1', at: '2026-11-07T00:00:00Z',
    kind: 'ignore', reason: [{ code: 'not_human' }], strength: 'inferred',
  }))
  db.prepare('INSERT INTO trigger VALUES (?,?,?)').run('t1', JSON.stringify({
    id: 't1', source: 'github', text: 'CI passed 0/0', actor: { source: 'github', id: '' }, human: false, meta: { kind: 'ci' },
  }), '2026-11-07T00:00:00Z')
  db.prepare('INSERT INTO thread VALUES (?,?)').run('github:11', JSON.stringify({ key: 'github:11', meta: { title: 'CI on PR 11' } }))
  db.close()
  const out = join(directory, 'decisions.jsonl')
  const result = run('export-decisions.mjs', ['--db', join(directory, 'store.sqlite'), '--out', out])
  expect(result.status).toBe(0)
  const record = JSON.parse(readFileSync(out, 'utf8').trim())
  expect(record).toMatchObject({ id: 'd1', kind: 'ignore', reasons: ['not_human'], threadTitle: 'CI on PR 11',
    trigger: { text: 'CI passed 0/0', human: false, kind: 'ci' } })
})
