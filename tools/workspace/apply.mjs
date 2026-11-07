/**
 * Apply a snapshot's changes back to the workspace, after checking that the workspace
 * still matches the snapshot baseline (no concurrent edits). Refuses deletions unless
 * --allow-delete is given.
 *
 * Usage: node apply.mjs --snapshot <dir> [--confirm] [--allow-delete]
 */
import { createHash } from 'node:crypto'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const root = arg('snapshot', '')
if (!root) { console.error('usage: apply.mjs --snapshot <dir> [--confirm] [--allow-delete]'); process.exit(2) }
const manifest = JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8'))
const workspace = manifest.workspace
const confirm = args.includes('--confirm'), allowDelete = args.includes('--allow-delete')

const current = {}
const { readdir } = await import('node:fs/promises')
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'snapshot.json') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await walk(path); continue }
    if (!entry.isFile()) continue
    current[relative(root, path).split('\\').join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
}
await walk(root)
const changed = [], added = [], deleted = []
for (const [path, hash] of Object.entries(current)) {
  if (!(path in manifest.files)) added.push(path)
  else if (manifest.files[path] !== hash) changed.push(path)
}
for (const path of Object.keys(manifest.files)) if (!(path in current)) deleted.push(path)
if (deleted.length && !allowDelete) { console.error(`refusing to delete ${deleted.length} file(s); pass --allow-delete`); process.exit(3) }

// A file changed in the workspace after the snapshot means someone else edited it; refuse to overwrite.
const conflicts = []
for (const path of [...changed, ...added]) {
  const source = join(workspace, path)
  try {
    const hash = createHash('sha256').update(await readFile(source)).digest('hex')
    if (path in manifest.files && hash !== manifest.files[path]) conflicts.push(path)
  } catch { /* added file: absent in the workspace is expected */ }
}
if (conflicts.length) { console.error(`refusing to overwrite files changed since the snapshot: ${conflicts.join(', ')}`); process.exit(3) }
if (!confirm) { console.log(JSON.stringify({ changed, added, deleted, applied: false })); process.exit(0) }

for (const path of [...changed, ...added]) await copyFile(join(root, path), join(workspace, path))
for (const path of deleted) await rm(join(workspace, path), { force: true })
console.log(JSON.stringify({ changed, added, deleted, applied: true }))
