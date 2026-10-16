import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Product regression for read-only denied CLI. Tests never grant access,
// initialize SQLite or invoke a retailer HTTP request.
const cli = fileURLToPath(new URL('../scraper/cli.mjs', import.meta.url))

async function denied(t, retailer) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-private-selector-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const dbPath = join(folder, 'never-created.sqlite')
  const run = spawnSync(process.execPath,
    [cli, 'scrape', '--retailer', retailer, '--db', dbPath], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env,
        SUPA_SCRAPER_POLICY: '',
        SUPA_SOURCE_PERMISSION_GATE: '',
      },
    })
  assert.ifError(run.error)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  await assert.rejects(stat(dbPath), { code: 'ENOENT' })
  return run.stderr
}

test('missing permission rejects synthetic retailer credentials without echoing the label', async t => {
  const marker = 'SYNTHETIC_SUPA_PRIVATE_SELECTOR'
  const stderr = await denied(t, 'dirk,' + marker)
  assert.match(stderr, /Direct retailer scrape refused: reviewed policy required/u)
  assert.doesNotMatch(stderr, new RegExp(marker, 'u'))
})

test('source-denied scrape logs neither control sequences nor bidi characters', async t => {
  const stderr = await denied(t, 'dirk,BLOCKED_MARKER\u001b[31m\u202e')
  assert.match(stderr, /Direct retailer scrape refused/u)
  assert.doesNotMatch(stderr, /BLOCKED_MARKER|\u001b|\u202e/u)
})

test('known retailer is also denied before opening any store without policy', async t => {
  const stderr = await denied(t, 'dirk')
  assert.match(stderr, /Direct retailer scrape refused: reviewed policy required/u)
})

test('offline help stays accessible without any reviewed retailer policy', () => {
  const result = spawnSync(process.execPath, [cli, 'help'], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SUPA_SCRAPER_POLICY: '' },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /SUPA retailer scraper CLI/u)
})
