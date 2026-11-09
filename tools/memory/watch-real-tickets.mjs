/**
 * One-shot watch for new real super-agent cases.
 *
 * It does not run a daemon: a recurring reminder (or an operator) calls it. The
 * first call records the current high-water mark; later calls analyze only cases
 * that ended after it. A/B fixtures are excluded.
 *
 * Usage: node watch-real-tickets.mjs [--state-dir DIR] [--state FILE] [--out-dir DIR] [--no-analyze]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const STATE_DIR = arg('state-dir', process.env.DSH_SUPERAGENT_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'superagent'))
const CASES = join(STATE_DIR, 'cases.jsonl')
const STATE = arg('state', join(STATE_DIR, 'memory-watch.json'))
const OUT_DIR = arg('out-dir', join(STATE_DIR, 'memory-watch'))
const analyze = !args.includes('--no-analyze')

/** Cases that are not local A/B fixtures. */
export function realCases(cases) {
  return cases.filter(c => !String(c.title ?? '').includes('A/B'))
}

/** The largest endedAt among the cases, or undefined when none carry one. */
export function latestEndedAt(cases) {
  return cases.map(c => c.endedAt).filter(Boolean).sort().at(-1)
}

/** Real cases that ended strictly after the high-water mark. */
export function newRealCases(cases, lastEndedAt) {
  if (!lastEndedAt) return []
  return realCases(cases).filter(c => c.endedAt && c.endedAt > lastEndedAt)
}

function readCases() {
  return readFileSync(CASES, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function main() {
  const cases = readCases()
  const real = realCases(cases)
  const latest = latestEndedAt(real)
  let state = {}
  try { state = JSON.parse(readFileSync(STATE, 'utf8')) } catch { /* first run */ }

  if (!state.lastEndedAt) {
    mkdirSync(dirname(STATE), { recursive: true })
    writeFileSync(STATE, `${JSON.stringify({ lastEndedAt: latest ?? new Date().toISOString(), initializedAt: new Date().toISOString() }, null, 2)}\n`)
    console.log(`[watch] baseline recorded; real cases=${real.length}, lastEndedAt=${latest ?? 'none'}`)
    process.exit(0)
  }

  const fresh = newRealCases(real, state.lastEndedAt).filter(c => !String(c.origin?.triggerId ?? '').startsWith('local-'))
  if (fresh.length === 0) {
    console.log(`[watch] no new real cases since ${state.lastEndedAt}; real cases=${real.length}`)
    process.exit(0)
  }

  console.log(`[watch] ${fresh.length} new real case(s) since ${state.lastEndedAt}`)
  if (analyze) {
    mkdirSync(OUT_DIR, { recursive: true })
    execFileSync(process.execPath, [join(HERE, 'analyze-cases.mjs'), '--cases', CASES,
      '--out', join(OUT_DIR, 'report.md'), '--failures', join(OUT_DIR, 'failure-candidates.json')], { stdio: 'inherit' })
  }
  writeFileSync(STATE, `${JSON.stringify({ lastEndedAt: latest ?? state.lastEndedAt, analyzedAt: new Date().toISOString(), analyzed: fresh.length }, null, 2)}\n`)
  console.log(`[watch] analyzed ${fresh.length} case(s) -> ${OUT_DIR}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
