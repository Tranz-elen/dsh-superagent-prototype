/** The Local Source: a human direct request on its own Thread, admitted as explicit for a listed operator. */
import { expect, it } from 'vitest'
import { localKind, localTrigger } from '../src/sources/local.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { threadKey, type SourceScope, type Thread } from '../src/core/index.ts'

it('builds a human direct request on its own thread', () => {
  const trigger = localTrigger('改一下 README 的措辞', '2026-11-07T00:00:00.000Z')
  expect(trigger).toMatchObject({ source: 'local', human: true, addressed: 'direct', actor: { source: 'local', id: 'operator' },
    text: '改一下 README 的措辞' })
  expect(trigger.threads[0]!.source).toBe('local')
  expect(localTrigger('另一件事').threads[0]!.id).not.toBe(trigger.threads[0]!.id)
})

it('defaults the Local Policy to the operator and admits a direct request as explicit', () => {
  expect(localKind.policy!.schema.parse({})).toMatchObject({ allowed: [{ id: 'operator' }] })
  const settings = SettingsSchema.parse({ policy: { sources: { local: { allowed: [{ id: 'operator' }], admission: {} } } } })
  const scope: SourceScope = { scope: () => ({ listened: true, observed: false }) }
  const trigger = localTrigger('做这件事', '2026-11-07T00:00:00.000Z')
  const thread: Thread = { key: threadKey(trigger.threads[0]!), ref: trigger.threads[0]!, createdAt: '', subscriptions: [],
    correlated: [], pending: [], meta: {} }
  expect(settingsPolicy(settings, scope).gate(trigger, thread, [])).toMatchObject({
    admissible: true, strength: 'explicit', basis: { via: 'addressed', sender: 'operator' },
  })
})
