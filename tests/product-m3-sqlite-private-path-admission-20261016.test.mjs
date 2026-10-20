import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildReviewedRetailerSqlite, main } from
  '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const REFUSED = /Historical reviewed retailer import refused/
const failureIsPrivate = (error, attempted) => {
  assert.equal(error instanceof TypeError, false)
  assert.match(String(error), REFUSED)
  for (const marker of ['fictional-', 'ERR_INVALID_ARG_VALUE', '/tmp/']) {
    assert.ok(!String(error).includes(marker))
  }
  assert.ok(!String(error).includes(attempted))
  return true
}

test('new private SQLite builder refuses NUL, control, DEL and unbounded path before IO', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-sqlite-control-path-'))
  try {
    const unsafe = [
      join(dir, 'fictional-archive\u0000.db'),
      join(dir, 'fictional-archive\u000a.db'),
      join(dir, 'fictional-archive\u000d.db'),
      join(dir, 'fictional-archive\u007f.db'),
      join(dir, 'fictional-archive' + 'x'.repeat(4100)),
    ]
    for (const target of unsafe) {
      await assert.rejects(buildReviewedRetailerSqlite(target), e =>
        failureIsPrivate(e, target))
      assert.deepEqual(await readdir(dir), [])
    }
  } finally { await rm(dir, { force: true, recursive: true }) }
})

test('direct exported SQLite CLI refuses invalid paths before console output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-sqlite-control-cli-'))
  const original = console.log
  let printed = 0
  console.log = () => { printed++ }
  try {
    for (const name of ['fictional\u0000-out.sqlite','fictional\u000a-out.sqlite']) {
      const target = join(dir, name)
      await assert.rejects(main(['--out', target]), e => failureIsPrivate(e, target))
    }
    assert.equal(printed, 0)
    assert.deepEqual(await readdir(dir), [])
  } finally { console.log = original; await rm(dir, { force: true, recursive: true }) }
})
