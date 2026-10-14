import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, lstat, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'

// Separate, invented offline capture. No retailer, user data or HTTP.
const STORE = 'pretend-store'
const ID = 'pretend-html'
const HTML = '<!doctype html><html><body>invented exact original bytes</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const loc = (dir) => join(dir, STORE, ID + '.html')
const row = () => ({
  id: ID, supermarket: STORE, kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/offline',
  capturedAt: '2026-10-14T00:00:00.000Z', sha256: SHA,
})
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-preflight-inode-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function capture(root) {
  const dir = join(root, 'current')
  await mkdir(join(dir, STORE), { recursive: true })
  const manifest = { milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: 1, results: [row()] }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(loc(dir), HTML)
  return { dir, manifest }
}
const identity = info => ({ dev: info.dev, ino: info.ino })
async function proof(dir) {
  return {
    root: identity(await lstat(dir)),
    stores: new Map([[STORE, identity(await lstat(join(dir, STORE)))]]),
    files: new Map([[STORE + '\0' + ID, identity(await lstat(loc(dir)))]]),
  }
}
async function originalResult(dir, manifest, attest) {
  return inspectFrozenCaptureDirectory(dir, manifest, inspectCaptureDirectory, attest)
}
test('independent preflight inode positive: original physical root/store/HTML remain verifiable', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    const inspected = await originalResult(now.dir, now.manifest, attest)
    assert.equal(inspected.sources.length, 1)
    assert.equal(inspected.sources[0].integrity, 'verified')
    assert.equal(inspected.sources[0].manifestSha256, SHA)
  })
})
test('independent preflight inode positive: legacy direct no-proof synthetic inspector remains usable', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const inspected = await inspectFrozenCaptureDirectory(
      now.dir, now.manifest, inspectCaptureDirectory)
    assert.equal(inspected.sources[0].integrity, 'verified')
  })
})
test('independent preflight inode: identical-byte root replacement must be rejected after lstat', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    await rename(now.dir, join(root, 'original-root'))
    await mkdir(join(now.dir, STORE), { recursive: true })
    await writeFile(join(now.dir, 'manifest.json'), JSON.stringify(now.manifest))
    await writeFile(loc(now.dir), HTML)
    assert.notDeepEqual(identity(await lstat(now.dir)), attest.root)
    await assert.rejects(originalResult(now.dir, now.manifest, attest),
      /Invalid frozen offline capture source/)
  })
})
test('independent preflight inode: identical-byte store replacement must be rejected after lstat', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    await rename(join(now.dir, STORE), join(root, 'original-store'))
    await mkdir(join(now.dir, STORE))
    await writeFile(loc(now.dir), HTML)
    assert.notDeepEqual(identity(await lstat(join(now.dir, STORE))), attest.stores.get(STORE))
    await assert.rejects(originalResult(now.dir, now.manifest, attest),
      /Invalid frozen offline capture source/)
  })
})
test('independent preflight inode: identical-byte HTML replacement must reject new inode with same SHA', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    await rename(loc(now.dir), join(root, 'original.html'))
    await writeFile(loc(now.dir), HTML)
    assert.notDeepEqual(identity(await lstat(loc(now.dir))), attest.files.get(STORE + '\0' + ID))
    await assert.rejects(originalResult(now.dir, now.manifest, attest),
      /Invalid frozen offline capture source/)
  })
})
test('independent preflight inode: missing HTML proof key must fail closed', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    attest.files.clear()
    await assert.rejects(originalResult(now.dir, now.manifest, attest),
      /Invalid frozen offline capture source/)
  })
})
test('independent preflight inode: missing supermarket proof key must fail closed', async () => {
  await isolated(async root => {
    const now = await capture(root)
    const attest = await proof(now.dir)
    attest.stores.clear()
    await assert.rejects(originalResult(now.dir, now.manifest, attest),
      /Invalid frozen offline capture source/)
  })
})
