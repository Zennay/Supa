/**
 * Pure synthetic private output-target admission tests for #3243.
 * All controls must refuse before any DB/proxy/store/retailer requests.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewedRetailerSqlite, main } from '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const refused = /Historical reviewed retailer import refused; no live prices or public claims generated/
async function sandbox(run) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-nul-importer-'))
  try { await run(dir) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
for (const illegal of ['\u0000', '\u0001', '\u001f', '\u007f']) {
  test('direct SQLite path refuses control byte U+' + illegal.charCodeAt(0).toString(16), () =>
    sandbox(async dir => {
      const target = join(dir, 'private' + illegal + '.sqlite')
      await assert.rejects(buildReviewedRetailerSqlite(target), refused)
      assert.deepEqual(await readdir(dir), [])
    }))
}
test('exported argv refuses embedded NUL before stdout or private destination creation', () =>
  sandbox(async dir => {
    const target = join(dir, 'private\u0000.sqlite')
    const old = console.log
    const emitted = []
    console.log = (...args) => emitted.push(args)
    try {
      await assert.rejects(main(['--out', target]), refused)
      assert.deepEqual(emitted, [])
      assert.deepEqual(await readdir(dir), [])
    } finally { console.log = old }
  }))
test('existing private destination still refuses overwrite without modifying contents', () =>
  sandbox(async dir => {
    const target = join(dir, 'existing.sqlite')
    const sentinel = Buffer.from('synthetic private archived prior record')
    await writeFile(target, sentinel, { mode: 0o600, flag: 'wx' })
    await assert.rejects(buildReviewedRetailerSqlite(target), refused)
    assert.deepEqual(await readFile(target), sentinel)
    assert.deepEqual(await readdir(dir), ['existing.sqlite'])
  }))
test('symlink ancestor remains refused without following it', () =>
  sandbox(async dir => {
    const real = join(dir, 'real')
    const link = join(dir, 'alias')
    await mkdir(real)
    await symlink(real, link, 'dir')
    await assert.rejects(buildReviewedRetailerSqlite(join(link, 'private.sqlite')), refused)
    assert.deepEqual(await readdir(real), [])
  }))
