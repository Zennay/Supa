/**
 * Independent M3 QA 2/2: private SQLite destination admission on frozen
 * product owner #3235 (a2ea75ca6046de9257cf66937b9d56655b497fc4).
 * Uses only temporary synthetic paths. No retailer/network calls, real
 * credentials, customer records, or public price/stock/savings evidence.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReviewedRetailerSqlite, main } from
  '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const REFUSED = /Historical reviewed retailer import refused/
async function inSandbox(run) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-m3-sqlite-path-'))
  try { return await run(dir) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

test('private SQLite builder must refuse embedded NUL with domain error and no file [EXPECTED RED]', async () =>
  inSandbox(async dir => {
    const unsafe = join(dir, 'fictional-archive\u0000.db')
    await assert.rejects(buildReviewedRetailerSqlite(unsafe), REFUSED,
      'filesystem native TypeError must never escape the exported domain boundary')
    assert.deepEqual(await readdir(dir), [],
      'refusal must happen before creating a DB or temporary file in destination')
  }))

test('private SQLite exported argv must refuse NUL path with domain error and no stdout [EXPECTED RED]', async () =>
  inSandbox(async dir => {
    const unsafe = join(dir, 'fictional\u0000-export.sqlite')
    const original = console.log
    const captured = []
    console.log = value => captured.push(value)
    try {
      await assert.rejects(main(['--out', unsafe]), REFUSED,
        'programmatic CLI must not leak ERR_INVALID_ARG_VALUE')
      assert.deepEqual(captured, [])
      assert.deepEqual(await readdir(dir), [])
    } finally { console.log = original }
  }))

test('existing destination remains byte-identical and refuses overwrite', async () =>
  inSandbox(async dir => {
    const existing = join(dir, 'already-owned.db')
    const sentinel = Buffer.from('QA ONLY - prior private document, not a real database')
    await writeFile(existing, sentinel, { mode: 0o600, flag: 'wx' })
    await assert.rejects(buildReviewedRetailerSqlite(existing), REFUSED)
    assert.deepEqual(await readFile(existing), sentinel)
    assert.deepEqual(await readdir(dir), ['already-owned.db'])
  }))

test('pre-existing symlink parent is rejected without following into private location', async () =>
  inSandbox(async dir => {
    const original = join(dir, 'private')
    const alias = join(dir, 'alias')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(original)
    await symlink(original, alias, 'dir')
    await assert.rejects(buildReviewedRetailerSqlite(join(alias, 'must-not-create.db')), REFUSED)
    assert.deepEqual(await readdir(original), [])
  }))
