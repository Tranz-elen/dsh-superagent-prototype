/** End-to-end offline pipeline: session trace → analyze candidates → distill review artifact. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it } from 'vitest'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'memory-pipeline-')) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const tool = (name: string) => join(process.cwd(), 'tools', 'memory', name)
const run = (name: string, args: string[]): void => {
  execFileSync(process.execPath, [tool(name), ...args], { encoding: 'utf8' })
}

const session = (path: string): void => {
  const events = [
    { type: 'step/start', seq: 1 },
    { type: 'tool/call', seq: 2, data: { callId: 'c1', name: 'edit', arguments: JSON.stringify({ file_path: '/tmp/sample.md' }) } },
    { type: 'tool/result', seq: 3, data: { toolCallId: 'c1', message: { content: [{ type: 'text',
      text: 'Error: cannot modify "/tmp/sample.md": file has not been read — read the file, then retry' }] } } },
  ]
  writeFileSync(path, zstdCompressSync(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n')))
}

const caseOf = (id: string, outcome: string, sessionPath?: string) => ({
  id, title: `docs: ${id}`, request: '@bot do it', intent: 'docs', areas: [], files: [], outcome,
  endReason: outcome, cost: { assignments: 1, retries: 0, reports: ['ready'], humanFollowUps: 0, handbacks: 0, requeued: false, attention: 0, answers: 0 },
  reports: [], ...(sessionPath ? { session: sessionPath } : {}), createdAt: '2026-11-08T00:00:00Z', endedAt: '2026-11-08T00:10:00Z',
})

it('turns a repeated edit failure into a reviewed candidate through analyze and distill', () => {
  const s1 = join(directory, 'session1.zstd'), s2 = join(directory, 'session2.zstd')
  session(s1); session(s2)
  const cases = [
    ...Array.from({ length: 17 }, (_, i) => caseOf(`d${i}`, 'merged')),
    caseOf('f1', 'merged', s1), caseOf('f2', 'completed', s2), caseOf('s0', 'stopped'),
  ]
  const casesFile = join(directory, 'cases.jsonl')
  writeFileSync(casesFile, cases.map(item => JSON.stringify(item)).join('\n') + '\n')
  const report = join(directory, 'report.md'), candidates = join(directory, 'failure-candidates.json'), dist = join(directory, 'dist')
  run('analyze-cases.mjs', ['--cases', casesFile, '--out', report, '--failures', candidates])
  const document = JSON.parse(readFileSync(candidates, 'utf8')) as { candidates: Array<{ signature: string; cases: string[] }> }
  const edit = document.candidates.find(candidate => candidate.signature.includes('cannot+modify'))
  expect(edit).toMatchObject({ cases: expect.arrayContaining(['f1', 'f2']) })
  expect(readFileSync(report, 'utf8')).toContain('Failure lesson candidates')
  run('distill.mjs', ['--cases', casesFile, '--failures', candidates, '--out', dist])
  expect(readFileSync(join(dist, 'status.md'), 'utf8')).toContain('gate: open')
  const reviewed = JSON.parse(readFileSync(join(dist, 'failure-candidates.json'), 'utf8')) as { candidates: Array<{ signature: string }> }
  expect(reviewed.candidates.some(candidate => candidate.signature.includes('cannot+modify'))).toBe(true)
  expect(readFileSync(join(dist, 'prompt.md'), 'utf8')).toContain('## Failure candidates')
})
