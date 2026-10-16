import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent #3436 QA against frozen product #3437: missing legal permission
// must refuse before emitting caller-controlled retailer selectors or making
// a DB, HTTP request, or browser. All labels below are synthetic markers.
const cli = fileURLToPath(new URL('../scraper/cli.mjs', import.meta.url))

async function isolated(t) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-cli-opaque-deny-'))
  t.after(async () => rm(folder, { recursive: true, force: true }))
  return join(folder, 'NEVER-CREATED.sqlite')
}

function invoke(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      SUPA_SCRAPER_POLICY: '',
      SUPA_SOURCE_PERMISSION_GATE: '',
    },
  })
}

async function assertNoSideEffects(result, dbPath) {
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '', 'denied scrape must never return product data')
  await assert.rejects(stat(dbPath), { code: 'ENOENT' },
    'source-denied CLI created a SQLite file')
}

test('unapproved unknown retailer text is never echoed before source admission', async t => {
  const dbPath = await isolated(t)
  const marker = 'PRIVATE_SYNTHETIC_SELECTOR_CREDENTIAL_NOT_FOR_LOGS'
  const result = invoke(['scrape', '--retailer', 'dirk,' + marker, '--db', dbPath])
  await assertNoSideEffects(result, dbPath)
  assert.match(result.stderr, /Direct retailer scrape refused/u)
  assert.doesNotMatch(result.stderr, new RegExp(marker, 'u'),
    'retailer identifier should not leak an accidental pasted secret')
})

test('denied retailer input cannot inject ANSI/bidi controls into CLI diagnostics', async t => {
  const dbPath = await isolated(t)
  const marker = 'INERT_PRIVACY_MARKER'
  const result = invoke(['scrape', '--retailer',
    'dirk,' + marker + '\u001b[31m\u202e', '--db', dbPath])
  await assertNoSideEffects(result, dbPath)
  assert.match(result.stderr, /Direct retailer scrape refused/u)
  assert.doesNotMatch(result.stderr, /\u001b|\u202e|INERT_PRIVACY_MARKER/u)
})

test('known retailer still fails before DB open without a reviewed source policy', async t => {
  const dbPath = await isolated(t)
  const result = invoke(['scrape', '--retailer', 'dirk', '--db', dbPath])
  await assertNoSideEffects(result, dbPath)
  assert.match(result.stderr, /Direct retailer scrape refused: reviewed policy required/u)
  assert.doesNotMatch(result.stderr, /\b€\b|https?:\/\//u)
})
