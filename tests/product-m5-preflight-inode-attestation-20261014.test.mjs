import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'
import { withPinnedCaptureTree } from '../scripts/m5-pin-capture-store.mjs'

const html = '<!doctype html><body>invented SHA-identical HTML</body>'
const sha256 = createHash('sha256').update(html).digest('hex')
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const source = (id, extra = {}) => ({
  id, supermarket: 'madeup-store', kind: 'product', success: true,
  capturedAt: '2026-10-13T12:00:00.000Z', sha256,
  requestedUrl: 'https://example.invalid/fictional', ...extra,
})

async function scoped(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-inode-admission-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function capture(root, name, rows, htmlPresent = true) {
  const dir = join(root, name)
  await mkdir(dir)
  if (htmlPresent) {
    await mkdir(join(dir, 'madeup-store'))
    for (const row of rows) {
      if (row.success) await writeFile(join(dir, 'madeup-store', row.id + '.html'), html)
    }
  }
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  return { dir, manifest }
}

// Deterministic source-owner seam for the identity already discovered during
// preflight. Replacing originals after this does not mutate the attestation.
async function attest(dir, manifest) {
  const root = await lstat(dir)
  const stores = new Map()
  const files = new Map()
  for (const row of manifest.results) {
    if (!row.success) continue
    const store = await lstat(join(dir, row.supermarket))
    const file = await lstat(join(dir, row.supermarket, row.id + '.html'))
    stores.set(row.supermarket, { dev: store.dev, ino: store.ino })
    files.set(row.supermarket + '\0' + row.id, { dev: file.dev, ino: file.ino })
  }
  return { root: { dev: root.dev, ino: root.ino }, stores, files }
}

test('product preflight inode: valid admitted P2 survives M1 immutable snapshot review', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    const inspection = await inspectFrozenCaptureDirectory(c.dir, c.manifest, undefined, evidence)
    assert.equal(inspection.sources[0].integrity, 'verified')
    const report = await compareCaptureDirectories(c.dir)
    assert.equal(report.changes[0].status, 'baseline_missing')
    assert.equal(report.m5Eligible, false)
  })
})

test('product preflight inode: same-byte replacement HTML inode refused before inspector', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    await rename(join(c.dir, 'madeup-store', 'first.html'),
      join(c.dir, 'madeup-store', 'old-first.html'))
    await writeFile(join(c.dir, 'madeup-store', 'first.html'), html)
    let inspected = false
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(c.dir, c.manifest, async () => {
        inspected = true
      }, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
    assert.equal(inspected, false)
    assert.equal(await readFile(join(c.dir, 'madeup-store', 'first.html'), 'utf8'), html)
  })
})

test('product preflight inode: same-byte ordinary replacement supermarket directory refused', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    await rename(join(c.dir, 'madeup-store'), join(c.dir, 'old-store'))
    await mkdir(join(c.dir, 'madeup-store'))
    await writeFile(join(c.dir, 'madeup-store', 'first.html'), html)
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(c.dir, c.manifest, undefined, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
  })
})

test('product preflight inode: same-byte ordinary replacement root refused', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    await rename(c.dir, join(root, 'original-root'))
    await mkdir(c.dir)
    await mkdir(join(c.dir, 'madeup-store'))
    await writeFile(join(c.dir, 'madeup-store', 'first.html'), html)
    await writeFile(join(c.dir, 'manifest.json'), JSON.stringify(c.manifest))
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(c.dir, c.manifest, undefined, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
  })
})

test('product preflight inode: forged or missing source identity never starts HTML inspector', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    evidence.files.delete('madeup-store\0first')
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(c.dir, c.manifest, undefined, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
  })
})

test('product preflight inode: forged root proof is rejected before callback', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    evidence.root.ino += 1
    let called = false
    await assert.rejects(
      () => withPinnedCaptureTree(c.dir, async () => { called = true }, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
    assert.equal(called, false)
  })
})

test('product preflight inode: forged store proof is rejected before callback store read', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const evidence = await attest(c.dir, c.manifest)
    evidence.stores.set('madeup-store', { ...evidence.stores.get('madeup-store'), ino: -1 })
    await assert.rejects(
      () => withPinnedCaptureTree(c.dir, async (getStore) => {
        await getStore('madeup-store')
      }, evidence),
      /^Error: Invalid frozen offline capture source$/,
    )
  })
})

test('product preflight inode: independent baseline with 2 successful sources stays P3', async () => {
  await scoped(async (root) => {
    const current = await capture(root, 'current', [source('one'), source('two')])
    const previous = await capture(root, 'older', [
      source('one', { capturedAt: '2026-10-12T12:00:00.000Z' }),
      source('two', { capturedAt: '2026-10-12T12:00:00.000Z' }),
    ])
    const review = await compareCaptureDirectories(current.dir, previous.dir)
    assert.deepEqual(review.changes.map((x) => x.status), ['unchanged', 'unchanged'])
    assert.equal(review.productionReady, false)
    assert.equal(review.m5Eligible, false)
  })
})

test('product preflight inode: unavailable P1 works without store or HTML inode', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('failed', {
      success: false, sha256: undefined,
    })], false)
    const review = await compareCaptureDirectories(c.dir)
    assert.equal(review.changes[0].status, 'unavailable')
    assert.equal(review.m5Eligible, false)
  })
})

test('product preflight inode: anonymous CLI P2 still keeps original filenames private', async () => {
  await scoped(async (root) => {
    const c = await capture(root, 'current', [source('first')])
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', cli, c.dir,
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.doesNotMatch(result.stdout + result.stderr,
      /supa-product-inode-admission-|madeup-store|example\.invalid|\/proc\/self\/fd\//)
    const report = JSON.parse(result.stdout)
    assert.equal(report.actions[0].priority, 'P2')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
  })
})
