import { describe, expect, it } from 'vitest'
import { summarizePromptRevisions } from '../tools/memory/compare-prompt-revisions.mjs'

const row = (id: string, revision: number, steps: number, failed: number) => ({
  id, title: `docs: ${id}`, promptRevision: revision, outcome: 'completed', endedAt: '2026-11-10T00:00:00Z',
  cost: { retries: 0, humanFollowUps: 0 }, reports: [{ state: 'ready', summary: 'done' }],
  trace: { steps, bash: Array.from({ length: failed + 1 }, (_, i) => ({ command: 'x', exit: i === 0 ? 1 : 0 })), failures: [] },
})

describe('prompt revision comparison', () => {
  it('groups pinned cases and excludes A/B titles', () => {
    const result = summarizePromptRevisions([
      row('on1', 5, 8, 1), row('on2', 5, 10, 1),
      row('off1', 4, 15, 2), row('off2', 4, 20, 2),
      { ...row('ab', 5, 1, 0), title: 'docs: A/B ON 1' },
      { ...row('none', 0, 1, 0), promptRevision: undefined },
      { ...row('local', 5, 1, 0), source: 'local' },
    ], { on: 5, off: 4 })
    expect(result.groups[0]).toMatchObject({ label: 'ON', n: 2, meanSteps: 9 })
    expect(result.groups[1]).toMatchObject({ label: 'OFF', n: 2, meanSteps: 17.5 })
    expect(result.totalPinned).toBe(4)
    const local = summarizePromptRevisions([{ ...row('local', 5, 1, 0), source: 'local' }], { on: 5, off: 4, includeLocal: true })
    expect(local.totalPinned).toBe(1)
  })

  it('marks a group below five cases insufficient', () => {
    const result = summarizePromptRevisions([row('on', 5, 8, 0)], { on: 5, off: 4 })
    expect(result.groups[0]?.insufficient).toBe(true)
  })
})
