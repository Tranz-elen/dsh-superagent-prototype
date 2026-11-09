/**
 * Phase 0 — corpus report for exported superagent cases.
 *
 * Reads cases.jsonl (see export-cases.mjs), digests each worker session trace,
 * counts repetition, and decides whether the corpus is large enough to distill
 * rules from. Writes report.md next to the corpus.
 *
 * Usage: node analyze-cases.mjs [--cases cases.jsonl] [--out report.md]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { digestCase } from './session-digest.mjs'
import { buildFailureCandidates, failureCandidatesDocument } from './failure-candidates.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const STATE = process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CASES = arg('cases', join(STATE, 'cases.jsonl'))
const OUT = arg('out', 'report.md')
const FAILURES = arg('failures', join(dirname(OUT), 'failure-candidates.json'))
const SESSIONS = arg('sessions', join(DSH_HOME, 'sessions'))

function intentOf(title, text, files) {
  // A conventional prefix names the work; the rest of the title names its subject.
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
  if (/文档|README|docs|说明/i.test(s)) return 'docs'
  if (/重构|refactor|rename|move/i.test(s)) return 'refactor'
  if (/修复|bug|fix|错误|报错/i.test(s)) return 'bugfix'
  if (/\.github\/workflows|CI|workflow/i.test(s)) return 'ci'
  if (files.some(f => /\.(test|spec)\./.test(f))) return 'test'
  if (files.length > 0 && files.every(f => /\.(md|mdx|txt)$/.test(f))) return 'docs'
  return 'feature'
}

const cases = readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

for (const c of cases) { c.intent = intentOf(c.title, c.request ?? '', c.files ?? []); c.trace = digestCase(c, SESSIONS) }

// ---------------------------------------------------------------- aggregation
const count = (list, pick) => list.reduce((m, x) => (m[pick(x)] = (m[pick(x)] ?? 0) + 1, m), {})
const signature = c => `${c.intent}|${c.outcome}`
const bySignature = count(cases, signature)
const repeatedSignatures = Object.entries(bySignature).filter(([, n]) => n >= 2)
const allBash = cases.flatMap(c => c.trace.bash)
const failedBash = allBash.filter(b => b.exit !== 0)
const bashCount = count(allBash, b => b.command)
const repeatedBash = Object.entries(bashCount).filter(([, n]) => n >= 2)
const failureResult = buildFailureCandidates(cases)
const repeatedFailures = failureResult.candidates.map(candidate => [candidate.signature, candidate.count])
const quarantinedFailures = failureResult.quarantined
const failureEvidence = new Map(failureResult.candidates.map(candidate => [candidate.signature, {
  cases: new Set(candidate.cases), outcomes: new Set(candidate.outcomes), symptom: candidate.symptom,
}]))
const reasonCount = count(cases.flatMap(c => c.decision?.reasons ?? []), r => r)
const reportStates = count(cases.flatMap(c => c.reports), r => r.state)

/** Minimum corpus for a first distillation pass: enough cases, repetition, and outcome spread. */
const NEED = { cases: 20, perSignature: 3, repeatedFailure: 2, outcomes: 2 }
const outcomeSpread = new Set(cases.map(c => c.outcome)).size
const sufficient = cases.length >= NEED.cases && repeatedSignatures.some(([, n]) => n >= NEED.perSignature)
  && repeatedFailures.length >= NEED.repeatedFailure && outcomeSpread >= NEED.outcomes

const table = (rows, head) => ['| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|',
  ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n')

const lines = []
lines.push('# Phase 0 — superagent case corpus report', '')
lines.push(`- generated: ${new Date().toISOString()}`)
lines.push(`- cases: **${cases.length}**`)
lines.push(`- corpus: \`${CASES}\``, '')
lines.push('## 1. Cases', '')
lines.push(table(cases.map(c => [c.id.slice(0, 8), c.intent, c.areas.join(',') || '-', c.outcome, c.decision?.kind ?? '-',
  String(c.cost.retries), String(c.cost.humanFollowUps), c.title]), ['id', 'intent', 'areas', 'outcome', 'decision', 'retries', 'human', 'title']), '')
lines.push('## 2. Distribution', '')
lines.push(`- outcomes: ${JSON.stringify(count(cases, c => c.outcome))}`)
lines.push(`- intents: ${JSON.stringify(count(cases, c => c.intent))}`)
lines.push(`- areas: ${JSON.stringify(count(cases, c => c.areas[0] ?? '(none)'))}`)
lines.push(`- decision reasons: ${JSON.stringify(reasonCount)}`)
lines.push(`- report states: ${JSON.stringify(reportStates)}`)
lines.push(`- retries: ${cases.reduce((n, c) => n + c.cost.retries, 0)}, attention: ${cases.reduce((n, c) => n + c.cost.attention, 0)}`, '')
lines.push('## 3. Repetition (the only thing rules can come from)', '')
lines.push(`- signatures (intent|outcome) with n>=2: ${repeatedSignatures.length ? JSON.stringify(repeatedSignatures) : 'none'}`)
lines.push(`- bash commands run more than once: ${repeatedBash.length ? JSON.stringify(repeatedBash) : 'none'}`)
lines.push(`- repeated failure signatures: ${repeatedFailures.length ? JSON.stringify(repeatedFailures) : 'none'}`)
lines.push(`- quarantined failures with an ability verdict: ${quarantinedFailures}`)
lines.push(`- outcome spread: ${outcomeSpread} kinds`, '')
lines.push('### Failure lesson candidates (review before use)', '')
if (repeatedFailures.length === 0) lines.push('- none; a single failure is not a lesson.', '')
for (const [signature, n] of repeatedFailures) {
  const evidence = failureEvidence.get(signature)
  const candidate = failureResult.candidates.find(item => item.signature === signature)
  lines.push(`- \`${signature}\` ×${n}; scope=${candidate?.suggestedScope ?? 'worker'}; cases: ${[...evidence.cases].join(', ')}; outcomes: ${[...evidence.outcomes].join(', ')}`)
  lines.push(`  - symptom: ${evidence.symptom}`)
  lines.push('  - needs a human-written possible cause, a cheapest falsifying probe, and an action; this is not a rule yet.')
}
lines.push('', '### Trace digests', '')
for (const c of cases) {
  lines.push(`**${c.id.slice(0, 8)} — ${c.title}** (${c.outcome})`, '')
  lines.push(`- steps ${c.trace.steps}, tools ${JSON.stringify(c.trace.tools)}`)
  lines.push(`- bash ${c.trace.bash.length} (failed ${c.trace.bash.filter(b => b.exit !== 0).length})${c.trace.bash.length ? ': ' + c.trace.bash.slice(0, 6).map(b => '`' + b.command.slice(0, 60) + '`' + (b.exit ? ` [${b.exit}]` : '')).join(', ') : ''}`)
  lines.push(`- edits ${c.trace.edits.join(', ') || '-'}`)
  if (c.trace.failures.length) lines.push(`- failures: ${c.trace.failures.slice(0, 5).map(f => f.detail).join(' | ')}`)
  lines.push('')
}
lines.push('## 3b. Decision-only records (no Ticket)', '')
try {
  const decisions = existsSync(arg('decisions', join(STATE, 'decisions.jsonl')))
    ? readFileSync(arg('decisions', join(STATE, 'decisions.jsonl')), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  const byKind = decisions.reduce((m, d) => (m[d.kind] = (m[d.kind] ?? 0) + 1, m), {})
  const byReason = decisions.reduce((m, d) => { for (const r of d.reasons) m[r] = (m[r] ?? 0) + 1; return m }, {})
  lines.push(`- records: ${decisions.length}`)
  lines.push(`- by kind: ${JSON.stringify(byKind)}`)
  lines.push(`- by reason: ${JSON.stringify(byReason)}`)
  for (const d of decisions.slice(0, 5)) lines.push(`- ${d.kind} | ${d.reasons.join(',')} | ${(d.threadTitle ?? d.thread)} | ${(d.trigger?.text ?? '').slice(0, 60).replace(/\n/g, ' ')}`)
} catch { lines.push('- none') }
lines.push('')
lines.push('## 4. Data sufficiency', '')
lines.push(`need: >=${NEED.cases} cases, >=${NEED.perSignature} per signature, >=${NEED.repeatedFailure} repeated failures, >=${NEED.outcomes} outcomes`)
lines.push(`have: ${cases.length} cases, ${repeatedSignatures.filter(([, n]) => n >= NEED.perSignature).length} qualifying signatures, ${repeatedFailures.length} repeated failures, ${outcomeSpread} outcomes`)
lines.push('')
lines.push(`**verdict: ${sufficient ? 'enough for a first distillation pass' : 'NOT enough — do not distill rules yet'}**`)
lines.push('')
writeFileSync(OUT, lines.join('\n') + '\n')
writeFileSync(FAILURES, `${JSON.stringify(failureCandidatesDocument(failureResult, { cases: cases.length }), null, 2)}\n`)
console.log(`wrote ${OUT}`)
console.log(`cases=${cases.length} repeatedSignatures=${repeatedSignatures.length} repeatedFailures=${repeatedFailures.length} sufficient=${sufficient}`)
console.log(`failure candidates: ${FAILURES} (${failureResult.candidates.length})`)
for (const c of cases) console.log(`- ${c.id.slice(0, 8)} ${c.outcome} steps=${c.trace.steps} bash=${c.trace.bash.length} failedBash=${c.trace.bash.filter(b => b.exit !== 0).length} tools=${Object.keys(c.trace.tools).join(',')}`)
