/**
 * Compare a snapshot with its baseline (snapshot.json) and print changed/added/deleted files.
 * Exit code 1 when there is a change, 0 when the snapshot is identical.
 *
 * Usage: node diff.mjs --snapshot <dir>
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const root = arg('snapshot', '')
if (!root) { console.error('usage: diff.mjs --snapshot <dir>'); process.exit(2) }
const manifest = JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8'))
const current = {}
const { readdir } = await import('node:fs/promises')
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'snapshot.json') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await walk(path); continue }
    if (!entry.isFile()) continue
    current[relative(root, path).split(sep).join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
}
await walk(root)
const changed = [], added = [], deleted = []
for (const [path, hash] of Object.entries(current)) {
  if (!(path in manifest.files)) added.push(path)
  else if (manifest.files[path] !== hash) changed.push(path)
}
for (const path of Object.keys(manifest.files)) if (!(path in current)) deleted.push(path)
const result = { changed, added, deleted }
console.log(JSON.stringify(result))
if (changed.length || added.length || deleted.length) process.exit(1)
