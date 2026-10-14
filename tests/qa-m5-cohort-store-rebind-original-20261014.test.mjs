import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renameSync as renameNow } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'

// Fictional local-only M5 ancestry trust; no real retailers or HTTP.
const MARKET = 'fictional-market'
const ONE = '<!doctype html><body>fictional original first</body>'
const TWO = '<!doctype html><body>fictional original second</body>'
const BORROWED = '<!doctype html><body>fictional unrelated second</body>'
const sha = value => createHash('sha256').update(value).digest('hex')
function row(id, html) {
  return { id, supermarket: MARKET, kind: 'product', success: true,
    requestedUrl: 'https://example.invalid/offline',
    capturedAt: '2026-10-14T00:00:00.000Z', sha256: sha(html) }
}
async function isolated(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-cohort-pin-'))
  try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}
async function setup(root) {
  const directory = join(root, 'current')
  const store = join(directory, MARKET)
  await mkdir(store, { recursive: true })
  await writeFile(join(store, 'one.html'), ONE)
  await writeFile(join(store, 'two.html'), TWO)
  const records = [row('one', ONE), row('two', TWO)]
  const manifest = { milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, store, records, manifest }
}
test('independent cohort pin control: two normal products retain original SHA-verified source status', async () => {
  await isolated(async root => {
    const now = await setup(root)
    const inspected = await inspectFrozenCaptureDirectory(
      now.directory, now.manifest, inspectCaptureDirectory)
    assert.equal(inspected.sources.length, 2)
    assert.deepEqual(inspected.sources.map(x => x.integrity), ['verified', 'verified'])
    assert.deepEqual(inspected.sources.map(x => x.manifestSha256), [sha(ONE), sha(TWO)])
  })
})
test('independent cohort pin race: second product must not reopen changed supermarket directory', async () => {
  await isolated(async root => {
    const now = await setup(root)
    const movedOriginal = join(root, 'retained-original-store')
    const external = join(root, 'unrelated-store')
    await mkdir(external)
    await writeFile(join(external, 'one.html'), ONE)
    await writeFile(join(external, 'two.html'), BORROWED)
    let reads = 0
    let rebound = false
    const second = now.records[1]

    // On original product #2223 row2.supermarket is read (1) during
    // validation, (2) while serializing preflight manifest, then (3) just
    // before per-row withPinnedCaptureStore call. No timing or sleeps:
    // after first row was fully read, synchronously swap the ORIGINAL
    // store for an ordinary, unrelated store directory (no symlink).
    Object.defineProperty(second, 'supermarket', {
      enumerable: true, configurable: true,
      get() {
        reads += 1
        if (reads === 3) {
          renameNow(now.store, movedOriginal)
          renameNow(external, now.store)
          rebound = true
        }
        return MARKET
      },
    })
    const inspected = await inspectFrozenCaptureDirectory(
      now.directory, now.manifest, inspectCaptureDirectory)

    assert.equal(rebound, true, 'must trigger controlled between-row parent swap')
    assert.ok(reads >= 3)
    assert.equal(inspected.sources.length, 2)
    assert.deepEqual(inspected.sources.map(x => x.integrity), ['verified', 'verified'])
    assert.equal(inspected.sources[0].manifestSha256, sha(ONE))
    assert.equal(inspected.sources[1].manifestSha256, sha(TWO),
      'second source must still resolve beneath FIRST opened physical supermarket inode')
    assert.equal(await readFile(join(movedOriginal, 'two.html'), 'utf8'), TWO)
    assert.equal(await readFile(join(now.store, 'two.html'), 'utf8'), BORROWED)
  })
})
