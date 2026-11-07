/** Workspace tools: snapshot a local directory, diff the worker's copy, and apply only when the original is unchanged. */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'workspace-tools-')) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const tool = (name: string) => join(process.cwd(), 'tools', 'workspace', name)
const run = (name: string, args: string[]): { status: number; output: string } => {
  try {
    return { status: 0, output: execFileSync(process.execPath, [tool(name), ...args], { encoding: 'utf8' }) }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}
const workspace = () => join(directory, 'ws')
const seed = () => {
  mkdirSync(join(workspace(), 'sub'), { recursive: true })
  mkdirSync(join(workspace(), '练习'), { recursive: true })
  writeFileSync(join(workspace(), 'a.md'), 'one\n')
  writeFileSync(join(workspace(), 'sub/b.md'), 'two\n')
  writeFileSync(join(workspace(), '练习/page.html'), '<html>1</html>\n')
}

it('snapshots, diffs and applies a change when the workspace is untouched', () => {
  seed()
  const snap = run('snapshot.mjs', ['--workspace', workspace(), '--id', 't1'])
  expect(snap.status).toBe(0)
  const root = join(workspace(), '.work', 't1')
  expect(existsSync(join(root, 'snapshot.json'))).toBe(true)
  expect(existsSync(join(root, 'sub/b.md'))).toBe(true)
  writeFileSync(join(root, 'a.md'), 'one changed\n')
  writeFileSync(join(root, 'c.md'), 'new\n')
  const diff = run('diff.mjs', ['--snapshot', root])
  expect(diff.status).toBe(1)
  expect(JSON.parse(diff.output.trim())).toMatchObject({ changed: ['a.md'], added: ['c.md'], deleted: [] })
  expect(JSON.parse(run('apply.mjs', ['--snapshot', root]).output.trim())).toMatchObject({ applied: false })
  const applied = run('apply.mjs', ['--snapshot', root, '--confirm'])
  expect(JSON.parse(applied.output.trim())).toMatchObject({ applied: true })
  expect(readFileSync(join(workspace(), 'a.md'), 'utf8')).toBe('one changed\n')
  expect(readFileSync(join(workspace(), 'c.md'), 'utf8')).toBe('new\n')
})

it('refuses to overwrite a workspace file changed after the snapshot', () => {
  seed()
  run('snapshot.mjs', ['--workspace', workspace(), '--id', 't2'])
  const root = join(workspace(), '.work', 't2')
  writeFileSync(join(root, 'a.md'), 'from snapshot\n')
  writeFileSync(join(workspace(), 'a.md'), 'concurrent edit\n')
  const result = run('apply.mjs', ['--snapshot', root, '--confirm'])
  expect(result.status).toBe(3)
  expect(result.output).toContain('changed since the snapshot')
  expect(readFileSync(join(workspace(), 'a.md'), 'utf8')).toBe('concurrent edit\n')
})

it('refuses a deletion without --allow-delete', () => {
  seed()
  run('snapshot.mjs', ['--workspace', workspace(), '--id', 't3'])
  const root = join(workspace(), '.work', 't3')
  rmSync(join(root, 'sub/b.md'))
  expect(run('apply.mjs', ['--snapshot', root, '--confirm']).status).toBe(3)
  expect(run('apply.mjs', ['--snapshot', root, '--confirm', '--allow-delete']).status).toBe(0)
  expect(existsSync(join(workspace(), 'sub/b.md'))).toBe(false)
})
