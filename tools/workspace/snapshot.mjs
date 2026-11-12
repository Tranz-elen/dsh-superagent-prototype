/**
 * Snapshot a local workspace into `<workspace>/.work/<id>/` for a superagent task.
 *
 * The snapshot lives on the Windows-accessible workspace drive so PowerShell scripts can
 * run against it; the worker edits only the snapshot. `snapshot.json` records the sha256
 * of every file at snapshot time, which `diff.mjs` and `apply.mjs` use as the baseline.
 *
 * Usage: node snapshot.mjs --workspace <dir> --id <ticket> [--exclude <name>]...
 */
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const workspace = resolve(arg('workspace', ''))
const id = arg('id', '')
if (!workspace || !id) { console.error('usage: snapshot.mjs --workspace <dir> --id <ticket>'); process.exit(2) }
const extra = args.flatMap((value, index) => value === '--exclude' ? [args[index + 1]] : []).filter(Boolean)
const EXCLUDE = new Set(['.work', '.git', 'node_modules', '.artifacts', '英语听力音频', ...extra])
const sensitive = name => name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'))
let ignoreText = ''
try { ignoreText = await readFile(join(workspace, '.gitignore'), 'utf8') } catch { /* no ignore file */ }
const ignoreRules = ignoreText.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
const escapeRegex = value => value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
const ignoreMatchers = ignoreRules.filter(rule => !rule.startsWith('!')).map(rule => {
  const dirOnly = rule.endsWith('/')
  const pattern = rule.replace(/\/+$/, '')
  const hasSlash = pattern.includes('/')
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}${dirOnly ? '(/|$)' : '$'}`)
  return (rel, name, isDir) => (!dirOnly || isDir) && (hasSlash ? regex.test(rel) : regex.test(name))
})
const ignored = (rel, name, isDir) => ignoreMatchers.some(match => match(rel, name, isDir))
const MAX_BYTES = 5 * 1024 * 1024

const files = {}
const skipped = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const rel = relative(workspace, path).split(sep).join('/')
    if (EXCLUDE.has(entry.name) || sensitive(entry.name) || ignored(rel, entry.name, entry.isDirectory())) continue
    if (entry.isDirectory()) { await walk(path); continue }
    if (!entry.isFile()) continue
    const size = (await stat(path)).size
    if (size > MAX_BYTES) { skipped.push(rel); continue }
    files[rel] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
}
await walk(workspace)

const snapshotRoot = join(workspace, '.work', id)
await mkdir(snapshotRoot, { recursive: true })
for (const [path] of Object.entries(files)) {
  const target = join(snapshotRoot, path)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(workspace, path), target, { recursive: false })
}
const manifest = { workspace, id, createdAt: new Date().toISOString(), files, skipped }
await writeFile(join(snapshotRoot, 'snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ snapshot: snapshotRoot, files: Object.keys(files).length, skipped }))
