import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises'
import { renameSync as renameNow, symlinkSync as symlinkNow } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'

// Independent LOCAL fixture only, no network, real retailer or savings claims.
const GOOD = '<!doctype html><html><body>private invented original</body></html>'
const BAD = '<!doctype html><html><body>private invented borrowed</body></html>'
const digest = x => createHash('sha256').update(x).digest('hex')
const ID = 'fictitious-sample'
const STORE = 'fictitious-store'

async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-store-pin-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function capture(root, source) {
  const directory = join(root, 'capture')
  const store = join(directory, STORE)
  await mkdir(store, { recursive: true })
  await writeFile(join(store, ID + '.html'), GOOD)
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [source],
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, store, manifest }
}
function record() {
  return { id: ID, supermarket: STORE, kind: 'product', success: true,
    requestedUrl: 'https://example.invalid/no-http',
    capturedAt: '2026-10-14T00:00:00.000Z', sha256: digest(GOOD) }
}
test('independent parent ancestry positive: verified ordinary store uses original canonical M1 inspector', async () => {
  await sandbox(async root => {
    const now = await capture(root, record())
    const result = await inspectFrozenCaptureDirectory(now.directory, now.manifest,
      inspectCaptureDirectory)
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0].integrity, 'verified')
    assert.equal(result.sources[0].manifestSha256, digest(GOOD))
    assert.equal(result.sources[0].id, ID)
  })
})
test('independent parent ancestry race: swap store exactly after verified original dir and before child HTML open', async () => {
  await sandbox(async root => {
    const externalStore = join(root, 'outside-store')
    await mkdir(externalStore)
    await writeFile(join(externalStore, ID + '.html'), BAD)
    const source = record()
    const now = await capture(root, source)
    const relocated = join(root, 'original-owned-store')
    let reads = 0
    let rebound = false

    // The original owner #2220 validates raw row.id three times, then
    // serializes its already-vetted manifest (fourth access), then reads
    // row.id to form the HTML child path (fifth access). This synchronous
    // access hook triggers only at the last step, after awaited lstat/realpath
    // of the ORIGINAL store. No timers, sleep, poll loops or OS race luck.
    Object.defineProperty(source, 'id', {
      enumerable: true, configurable: true,
      get() {
        reads += 1
        if (reads === 5) {
          renameNow(now.store, relocated)
          symlinkNow(externalStore, now.store, 'dir')
          rebound = true
        }
        return ID
      },
    })

    const result = await inspectFrozenCaptureDirectory(now.directory, now.manifest,
      inspectCaptureDirectory)

    assert.equal(rebound, true, 'the deliberate parent rebind must occur')
    assert.ok(reads >= 5)
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0].integrity, 'verified')
    assert.equal(result.sources[0].manifestSha256, digest(GOOD),
      'inspect the pinned original store, never external replacement')
    assert.equal(await readFile(join(relocated, ID + '.html'), 'utf8'), GOOD)
    assert.equal(await readFile(join(externalStore, ID + '.html'), 'utf8'), BAD)
  })
})
