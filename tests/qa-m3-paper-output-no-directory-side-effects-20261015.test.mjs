import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, lstat, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { renderM3PaperChecklist } from '../scripts/m3-print-field-checklist.mjs'

// Independent offline safe-publication acceptance. Checks that refused
// untrusted raw output paths have NO mkdir side effects, not just no final HTML.
const GENERATOR = 'scripts/m3-print-field-checklist.mjs'
function run(path) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', GENERATOR, '--output', path,
  ], { encoding: 'utf8', timeout: 8000 })
}
async function absent(path) {
  await assert.rejects(() => lstat(path), error => error?.code === 'ENOENT')
}
function denied(proc) {
  assert.equal(proc.error, undefined, String(proc.error))
  assert.equal(proc.status, 1)
  assert.equal(proc.stdout, '')
  assert.equal(proc.stderr.trim(),
    'Could not create blank M3 field worksheet; no observed prices were generated')
  assert.doesNotMatch(proc.stderr, /supa-paper-mkdir-qa|sheet\.html|outside/)
}
async function fixture(callback) {
  const tmp = await mkdtemp(join(tmpdir(), 'supa-paper-mkdir-qa-'))
  try {
    const selected = join(tmp, 'selected-output')
    const outside = join(tmp, 'outside')
    await mkdir(selected)
    await mkdir(outside)
    const parentAlias = join(selected, 'parent-alias')
    await symlink(outside, parentAlias, 'dir')
    await callback({ tmp, selected, outside, parentAlias })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

test('M3 output safely creates missing regular private directories on approved direct route', async () => {
  await fixture(async ({ selected }) => {
    const intended = join(selected, 'new', 'nested', 'sheet.html')
    const result = run(intended)
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(await readFile(intended, 'utf8'), renderM3PaperChecklist())
    if (process.platform !== 'win32') {
      assert.equal((await lstat(intended)).mode & 0o777, 0o600)
    }
  })
})

test('M3 --output refuses ancestor alias BEFORE creating a new directory outside selected route', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux parent-link regression')
  await fixture(async ({ outside, parentAlias }) => {
    const unexpectedDir = join(outside, 'new-from-alias')
    await absent(unexpectedDir)
    const result = run(join(parentAlias, 'new-from-alias', 'sheet.html'))
    // Inspect physical effects even when exit status is incorrect: otherwise
    // the first assertion would hide an actually created outside directory.
    const observedDir = await lstat(unexpectedDir).then(
      stat => stat.isDirectory(), error => error?.code === 'ENOENT' ? false : Promise.reject(error),
    )
    const observedFile = await lstat(join(unexpectedDir, 'sheet.html')).then(
      stat => stat.isFile(), error => error?.code === 'ENOENT' ? false : Promise.reject(error),
    )
    assert.deepEqual({ exitStatus: result.status, observedDir, observedFile },
      { exitStatus: 1, observedDir: false, observedFile: false })
    denied(result)
  })
})

test('M3 --output rejects link-before-dotdot even when path would auto-create external folder', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux link + dotdot traversal')
  await fixture(async ({ selected, outside, parentAlias }) => {
    const entry = join(outside, 'entry')
    await mkdir(entry)
    const alias = join(selected, 'link-to-entry')
    await symlink(entry, alias, 'dir')
    const unexpected = join(outside, 'new-behind-dotdot')
    await absent(unexpected)
    // Kernel follows link first, .. then escapes into outside directory.
    const result = run(alias + '/../new-behind-dotdot/sheet.html')
    const observedDir = await lstat(unexpected).then(
      stat => stat.isDirectory(), error => error?.code === 'ENOENT' ? false : Promise.reject(error),
    )
    const observedFile = await lstat(join(unexpected, 'sheet.html')).then(
      stat => stat.isFile(), error => error?.code === 'ENOENT' ? false : Promise.reject(error),
    )
    assert.deepEqual({ exitStatus: result.status, observedDir, observedFile },
      { exitStatus: 1, observedDir: false, observedFile: false })
    denied(result)
    // Ordinary link guard remains independent of this dotdot variant.
    assert.equal((await lstat(parentAlias)).isSymbolicLink(), true)
  })
})
