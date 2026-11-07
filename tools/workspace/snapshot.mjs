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
const EXCLUDE = new Set(['.work', '.git', 'node_modules', '英语听力音频', ...extra])
const MAX_BYTES = 5 * 1024 * 1024

const files = {}
const skipped = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await walk(path); continue }
    if (!entry.isFile()) continue
    const size = (await stat(path)).size
    if (size > MAX_BYTES) { skipped.push(relative(workspace, path)); continue }
    files[relative(workspace, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
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
