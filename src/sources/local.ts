/** Local Source: operator requests submitted from the panel or the local management API, with no external account. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import type { SourceKind } from './kind.ts'
import { sourceContext } from './host.ts'

export const SOURCE = 'local'
/** The actor every local request carries; the Policy's Local part lists it as an allowed sender. */
export const OPERATOR = 'operator'
const LocalConfigSchema = z.object({}).strict()
const LocalPolicySchema = z.object({
  allowed: z.array(z.object({ id: z.string().min(1), name: z.string().optional() }).loose()).default([{ id: OPERATOR }]),
}).loose()

/** The Local Source's Policy: only listed operators may submit, and their request is always explicit. */
export type LocalPolicy = z.infer<typeof LocalPolicySchema>

export const localKind: SourceKind<Record<string, unknown>> = {
  kind: SOURCE,
  title: { zh: '本地', en: 'Local' },
  description: { zh: '操作者在面板或本机管理接口直接提交的请求，不需要外部账号。',
    en: 'Requests the operator submits from the panel or the local management API, with no external account.' },
  schema: LocalConfigSchema,
  fields: [],
  health: ['local'],
  // A local request is always listened to; it is never an observed unaddressed message.
  scope: () => ({ listened: true, observed: false }),
  policy: {
    schema: LocalPolicySchema,
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '允许提交的操作者', en: 'Operators allowed to submit' },
      columns: [{ key: 'id', type: 'text', label: { zh: '标识', en: 'ID' } }] }],
    explicit: { zh: '操作者通过本地接口提交请求。', en: 'The operator submits a request through the local API.' },
  },
}

/** Builds one operator request as a Trigger on its own Thread, so follow-ups cannot cross requests. */
export function localTrigger(text: string, at = new Date().toISOString(), workspace?: string): Trigger {
  const id = key('local', `${at}:${text}`)
  return {
    id,
    source: SOURCE,
    threads: [{ source: SOURCE, id: `local-${id}` }],
    actor: { source: SOURCE, id: OPERATOR },
    human: true,
    addressed: 'direct',
    at,
    text,
    meta: { kind: 'request', ...workspace ? { workspace } : {} },
  }
}

export const name = 'dsh-superagent-local'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposer = ctx.orchestrator.sources.register(localKind)
    sourceContext(ctx.orchestrator, localKind).report('local', { state: 'ready', detail: 'Accepting local requests' })
    return disposer
  })
}
