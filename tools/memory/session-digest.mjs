/** Session-transcript reading and trace digest shared by analyze and the A/B comparison. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { hasAbilityVerdict, normalizeFailureSignature } from './failure-signatures.mjs'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Resolves a case's worker transcript: an explicit path, or the session id under the sessions root. */
export function sessionPath(c, sessionsRoot) {
  if (c.session) return c.session
  if (!c.sessionId) return undefined
  try {
    for (const dir of readdirSync(sessionsRoot)) {
      const candidate = join(sessionsRoot, dir, c.sessionId)
      if (!existsSync(candidate)) continue
      const file = readdirSync(candidate).find(name => name.startsWith('session.') && name.endsWith('.zstd'))
      if (file) return join(candidate, file)
    }
  } catch { /* no session store */ }
  return undefined
}

/** Decompresses every zstd frame in a transcript and keeps unique JSON events in sequence order. */
export function readSession(path) {
  if (!path) return []
  let buf
  try { buf = readFileSync(path) } catch { return [] }
  const events = [], seen = new Set()
  for (let i = 0; (i = buf.indexOf(MAGIC, i)) !== -1; i += 4) {
    try {
      const text = zstdDecompressSync(buf.subarray(i)).toString('utf8')
      for (const line of text.split('\n')) {
        if (!line.trim() || seen.has(line)) continue
        seen.add(line)
        try { events.push(JSON.parse(line)) } catch { /* not a JSON event */ }
      }
    } catch { /* false-positive magic */ }
  }
  return events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

const textOf = message => (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')

/** Digests tool calls and results into steps, tools, bash exits and normalized failures. */
export function digest(events) {
  const steps = events.filter(e => e.type === 'step/start').length
  const calls = new Map()
  const results = new Map()
  for (const e of events) {
    if (e.type === 'tool/call') {
      let parsed = {}
      try { parsed = JSON.parse(e.data.arguments ?? '{}') } catch { /* keep {} */ }
      calls.set(e.data.callId, { name: e.data.name, args: parsed })
    } else if (e.type === 'tool/result') {
      results.set(e.data.toolCallId ?? e.data.message?.toolCallId, textOf(e.data.message))
    }
  }
  const tools = {}
  const bash = []
  const failures = []
  const edits = new Set()
  const reads = new Set()
  for (const [callId, call] of calls) {
    tools[call.name] = (tools[call.name] ?? 0) + 1
    const text = results.get(callId) ?? ''
    const exit = /\[exit code: (\d+)\]/.exec(text)
    const failed = (exit && Number(exit[1]) !== 0) || /^(Error|error):/.test(text.trim())
    if (call.name === 'bash') bash.push({ command: (call.args.command ?? '').trim().split('\n')[0], exit: exit ? Number(exit[1]) : 0 })
    if (call.name === 'write' || call.name === 'edit') edits.add(call.args.file_path)
    if (call.name === 'read' || call.name === 'grep' || call.name === 'glob') reads.add(call.args.file_path ?? call.args.path ?? call.args.pattern)
    if (failed) {
      const detail = text.replace(/\s+/g, ' ').trim().slice(0, 240)
      failures.push({ tool: call.name, detail, signature: normalizeFailureSignature(call.name, text), quarantined: hasAbilityVerdict(text) })
    }
  }
  return { steps, tools, bash, edits: [...edits], reads: [...reads].filter(Boolean), failures }
}

/** Digest a case's transcript, using a supplied trace when the caller already has one. */
export function digestCase(c, sessionsRoot) {
  return c.trace ?? digest(readSession(sessionPath(c, sessionsRoot)))
}
