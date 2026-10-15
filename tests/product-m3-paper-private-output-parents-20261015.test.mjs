import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, lstat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

const entry = new URL('../scripts/m3-print-field-checklist.mjs', import.meta.url).pathname
const invoke = (path) => spawnSync(process.execPath, [
  '--experimental-strip-types', entry, '--output', path,
], { encoding: 'utf8', timeout: 8000 })

test('product M3 paper: existing trusted directory accepts exactly one private deterministic file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-paper-product-'))
  try {
    const output = join(root, 'trusted', 'paper.html')
    const first = invoke(output)
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stdout, '')
    assert.equal(await readFile(output, 'utf8'), renderM3PaperChecklist())
    if (process.platform !== 'win32') assert.equal((await lstat(output)).mode & 0o777, 0o600)
    const second = invoke(output)
    assert.equal(second.status, 1)
    assert.equal(second.stdout, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('product M3 paper: static symlinked output parents never publish through alias', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux symlink parent semantics')
  const root = await mkdtemp(join(tmpdir(), 'supa-paper-product-'))
  try {
    await mkdir(join(root, 'real'))
    await mkdir(join(root, 'operator'))
    await symlink(join(root, 'real'), join(root, 'operator', 'alias'), 'dir')
    for (const suffix of ['paper.html', '../paper.html']) {
      const output = join(root, 'operator', 'alias') + '/' + suffix
      const denied = invoke(output)
      assert.equal(denied.status, 1, suffix)
      assert.equal(denied.stdout, '')
      assert.equal(denied.stderr.trim(),
        'Could not create blank M3 field worksheet; no observed prices were generated')
    }
    await assert.rejects(() => lstat(join(root, 'real', 'paper.html')), /ENOENT/)
    await assert.rejects(() => lstat(join(root, 'paper.html')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('product M3 paper: symlink before literal dot-dot cannot reach unrelated private output', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux raw symlink-before-dotdot semantics')
  const root = await mkdtemp(join(tmpdir(), 'supa-paper-product-'))
  try {
    const operator = join(root, 'operator')
    const foreign = join(root, 'foreign')
    await mkdir(operator)
    await mkdir(join(foreign, 'nested'), { recursive: true })
    await mkdir(join(foreign, 'target'))
    await symlink(join(foreign, 'nested'), join(operator, 'shortcut'), 'dir')
    const path = join(operator, 'shortcut') + '/../target/paper.html'
    const denied = invoke(path)
    assert.equal(denied.status, 1)
    assert.equal(denied.stdout, '')
    assert.equal(denied.stderr.trim(),
      'Could not create blank M3 field worksheet; no observed prices were generated')
    await assert.rejects(() => lstat(join(foreign, 'target', 'paper.html')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
