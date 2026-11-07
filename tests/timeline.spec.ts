/** Thread timeline pagination, neighbour lookup, and timestamp normalization. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Engine, type ChannelRef, type Trigger } from '../src/core/index.ts'
import { Store } from '../src/app/store.ts'
import { threadDetail } from '../src/app/views/threads.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { githubKind } from '../src/sources/github.ts'
import { githubLink } from '../src/sources/github-channel.ts'
import { SourceRegistry } from '../src/sources/registry.ts'

let directory: string
let store: Store
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dsh-superagent-timeline-'))
  store = new Store(join(directory, 'orchestrator.sqlite'))
})
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }) })
const sources = new SourceRegistry(() => SettingsSchema.parse({}))
sources.register(githubKind)
const host = () => ({ store, sources, links: (channel: ChannelRef) => githubLink(channel.address, {}) })
const engine = () => new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(SettingsSchema.parse({}), sources),
  assessor: { request: () => {} }, executor: { start: async () => {}, deliver: async () => {}, stop: async () => {} },
  outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
const comment = (id: string, at: string): Trigger => ({ id, source: 'github', threads: [{ source: 'github', id: '7' }], actor: { source: 'github', id: 'alice' },
  human: true, at, text: `comment ${id}`, meta: {} })
const saveThread = () => store.threads.save({ key: 'github:7', ref: { source: 'github', id: '7' }, createdAt: '', subscriptions: [], correlated: [], pending: [],
  meta: {} })
const ids = (detail: ReturnType<typeof threadDetail>) => detail!.timeline.map(item => item.id)

it('pages a thread by time and then id, so a Trigger of the same second as a page\'s oldest one shows on the next page', () => {
  saveThread()
  for (const item of [comment('a', '2026-10-01T00:00:00.000Z'), comment('b', '2026-10-01T00:00:01.000Z'), comment('c', '2026-10-01T00:00:01.000Z')]) store.triggers.save(item)
  const first = threadDetail(host(), 'github:7', undefined, 1)!
  const second = threadDetail(host(), 'github:7', first.earlier!, 1)!
  const third = threadDetail(host(), 'github:7', second.earlier!, 1)!
  expect([ids(first), ids(second), ids(third), third.earlier]).toEqual([['c'], ['b'], ['a'], null])
  // Legacy timestamp-only cursors still page before that timestamp.
  expect(ids(threadDetail(host(), 'github:7', '2026-10-01T00:00:01.000Z', 5))).toEqual(['a'])
})

it('shows the page around a GitHub comment with that comment, though GitHub writes its time in whole seconds', () => {
  // Lexicographically, `...:00Z` sorts after `...:00.001Z` unless normalized to milliseconds.
  const taking = engine()
  for (const item of [comment('old', '2026-10-01T00:00:00Z'), comment('new', '2026-10-01T00:00:00.500Z'), comment('newest', '2026-10-01T00:00:01Z')]) {
    taking.receive(item)
  }
  expect(ids(threadDetail(host(), 'github:7', undefined, 50, 'old'))).toEqual(['old'])
  expect(ids(threadDetail(host(), 'github:7', undefined, 50, 'new'))).toEqual(['old', 'new'])
})

it('finds the Triggers before and after one among Triggers of the same time', () => {
  for (const item of [comment('a', '2026-10-01T00:00:01.000Z'), comment('b', '2026-10-01T00:00:01.000Z'), comment('c', '2026-10-01T00:00:01.000Z')]) store.triggers.save(item)
  const around = store.read.neighbours('github:7', '2026-10-01T00:00:01.000Z', 'b')
  expect([around.before?.id, around.after?.id]).toEqual(['a', 'c'])
})

it('stores every received Trigger\'s time in the one form stored times take', () => {
  engine().receive(comment('raw', '2026-10-01T08:00:00+08:00'))
  expect(store.triggers.get('raw')?.at).toBe('2026-10-01T00:00:00.000Z')
  expect(store.read.threadTriggers('github:7').map(item => item.at)).toEqual(['2026-10-01T00:00:00.000Z'])
})

const cursor = (trigger: { at: string; id: string }) => `${trigger.at}|${trigger.id}`
const detail = (before: string | undefined, limit: number, around?: string) => threadDetail(host(), 'github:7', before, limit, around)!
/** Saves the thread `github:7` with comments `a`..`e`, one second apart, and returns them oldest-first. */
function fiveComments() {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id, index) => comment(id, `2026-10-01T00:00:0${index}.000Z`))
  saveThread()
  for (const item of items) store.triggers.save(item)
  return items
}

it('returns an empty timeline and no earlier cursor for a thread without Triggers', () => {
  saveThread()
  expect(detail(undefined, 50)).toMatchObject({ timeline: [], earlier: null })
  // A `before` cursor on an empty thread has nothing to return either.
  expect(detail('2026-10-01T00:00:00.000Z|a', 5)).toMatchObject({ timeline: [], earlier: null })
})

it('pages nothing before the oldest Trigger', () => {
  fiveComments()
  const [oldest, second] = detail(undefined, 50).timeline
  // A page requested before the oldest Trigger is empty and ends the timeline.
  expect([ids(detail(cursor(oldest!), 50)), detail(cursor(oldest!), 50).earlier]).toEqual([[], null])
  // The cursor's own Trigger is excluded, so a page before the second-oldest Trigger starts at the oldest one.
  expect(ids(detail(cursor(second!), 50))).toEqual(['a'])
})

it('anchors around a Trigger near either end of the timeline', () => {
  const items = fiveComments()
  // Near the oldest end the page stops at the anchor instead of padding with newer Triggers.
  expect([ids(detail(undefined, 2, 'b')), detail(undefined, 2, 'b').earlier]).toEqual([['a', 'b'], null])
  // At the oldest Trigger itself only the anchor fits, with nothing earlier to load.
  expect([ids(detail(undefined, 2, 'a')), detail(undefined, 2, 'a').earlier]).toEqual([['a'], null])
  // Near the newest end the page ends on the anchor and leaves the Triggers before it to an earlier page.
  const nearNewest = detail(undefined, 2, 'd')
  expect([ids(nearNewest), nearNewest.earlier]).toEqual([['c', 'd'], cursor(items[2]!)])
})

it('returns every Trigger and no earlier cursor when the limit exceeds the timeline length', () => {
  fiveComments()
  const page = detail(undefined, 50)
  expect([ids(page), page.earlier]).toEqual([['a', 'b', 'c', 'd', 'e'], null])
})

it('walks backwards through the timeline without gaps or repeats', () => {
  fiveComments()
  const pages: string[][] = []
  let page = detail(undefined, 2)
  while (true) {
    pages.unshift(ids(page))
    if (page.earlier === null) break
    page = detail(page.earlier, 2)
  }
  expect(pages).toEqual([['a'], ['b', 'c'], ['d', 'e']])
})
