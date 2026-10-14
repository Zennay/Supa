import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { withPinnedCaptureTree } from '../scripts/m5-pin-capture-store.mjs'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

const html = '<!doctype html><body>fictional original bytes</body>'
const fake = '<!doctype html><body>unrelated store bytes</body>'
const sha = createHash('sha256').update(html).digest('hex')
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const source = (id, supermarket = 'fake-shop', other = {}) => ({
  id, supermarket, kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/no-retailer',
  capturedAt: '2026-10-13T12:00:00.000Z', sha256: sha, ...other,
})

async function scope(action) {
  const tmp = await mkdtemp(join(tmpdir(), 'supa-product-pinned-cohort-'))
  try { await action(tmp) }
  finally { await rm(tmp, { recursive: true, force: true }) }
}

async function create(root, name, sources, withHtml = true) {
  const dir = join(root, name)
  await mkdir(dir)
  if (withHtml) {
    const stores = new Set()
    for (const row of sources) {
      if (!row.success) continue
      if (!stores.has(row.supermarket)) {
        stores.add(row.supermarket)
        await mkdir(join(dir, row.supermarket))
      }
      await writeFile(join(dir, row.supermarket, row.id + '.html'), html)
    }
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: sources.length, results: sources,
  }))
  return dir
}

test('product cohort: two same-store files stay bound to first opened inode across NORMAL directory replacement', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first'), source('second')])
    const beforeStore = join(dir, 'fake-shop')
    const moved = join(dir, 'moved-first-inode')
    const output = await withPinnedCaptureTree(dir, async (openStore) => {
      const firstStoreFile = await openStore('fake-shop')
      assert.equal(await readFile(firstStoreFile('first'), 'utf8'), html)
      await rename(beforeStore, moved)
      await mkdir(beforeStore)
      await writeFile(join(beforeStore, 'second.html'), fake)
      assert.equal(await readFile(join(beforeStore, 'second.html'), 'utf8'), fake)
      const nextStoreFile = await openStore('fake-shop')
      assert.equal(nextStoreFile('second'), firstStoreFile('second'))
      return readFile(nextStoreFile('second'), 'utf8')
    })
    assert.equal(output, html)
  })
})

test('product cohort: root is held across later first-use store lookup even when name replaced with symlink', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [
      source('first', 'fake-shop'), source('second', 'other-shop'),
    ])
    const moved = join(root, 'original-root-moved')
    const borrowedRoot = join(root, 'borrowed-root')
    await mkdir(borrowedRoot)
    await mkdir(join(borrowedRoot, 'other-shop'))
    await writeFile(join(borrowedRoot, 'other-shop', 'second.html'), fake)
    const result = await withPinnedCaptureTree(dir, async (openStore) => {
      assert.equal(await readFile((await openStore('fake-shop'))('first'), 'utf8'), html)
      await rename(dir, moved)
      await symlink(borrowedRoot, dir)
      assert.equal(await readFile(join(dir, 'other-shop', 'second.html'), 'utf8'), fake)
      return readFile((await openStore('other-shop'))('second'), 'utf8')
    })
    assert.equal(result, html)
  })
})

test('product cohort: cached supermarket inode survives later inserted borrowed symlink', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first'), source('second')])
    const store = join(dir, 'fake-shop')
    const moved = join(dir, 'moved-original')
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'second.html'), fake)
    const out = await withPinnedCaptureTree(dir, async (openStore) => {
      assert.equal(await readFile((await openStore('fake-shop'))('first'), 'utf8'), html)
      await rename(store, moved)
      await symlink(outside, store)
      assert.equal(await readFile(join(store, 'second.html'), 'utf8'), fake)
      return readFile((await openStore('fake-shop'))('second'), 'utf8')
    })
    assert.equal(out, html)
  })
})

test('product cohort: third store symlink initially refused after earlier valid store', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first')])
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(dir, 'aliased'))
    await assert.rejects(
      () => withPinnedCaptureTree(dir, async (openStore) => {
        assert.equal(await readFile((await openStore('fake-shop'))('first'), 'utf8'), html)
        await openStore('aliased')
      }),
      /^Error: Invalid frozen offline capture source$/,
    )
  })
})

test('product cohort: unsafe newly requested store and IDs never yield proc-fd paths', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first')])
    await withPinnedCaptureTree(dir, async (openStore) => {
      for (const store of ['../outside', '', null, 'é', 'a'.repeat(129)]) {
        await assert.rejects(() => openStore(store),
          /^Error: Invalid frozen offline capture source$/)
      }
      const filePath = await openStore('fake-shop')
      for (const id of ['../outside', 'a/b', '', null, 'é', 'x'.repeat(129)]) {
        assert.throws(() => filePath(id),
          /^Error: Invalid frozen offline capture source$/)
      }
    })
  })
})

test('product cohort: callback errors leave the original content untouched', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first')])
    await assert.rejects(
      () => withPinnedCaptureTree(dir, async (openStore) => {
        await openStore('fake-shop')
        throw new Error('controlled-copy-interruption')
      }),
      /^Error: controlled-copy-interruption$/,
    )
    assert.equal(await readFile(join(dir, 'fake-shop', 'first.html'), 'utf8'), html)
  })
})

test('product cohort: P1-only source still needs no store directory or captured HTML', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [{
      id: 'failed', supermarket: 'fake-shop', kind: 'product', success: false,
    }], false)
    const report = await compareCaptureDirectories(dir)
    assert.equal(report.changes[0].status, 'unavailable')
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
  })
})

test('product cohort: two verified sources from one supermarket both remain private P2', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [source('first'), source('second')])
    const report = await compareCaptureDirectories(dir)
    assert.equal(report.captureCount, 2)
    assert.deepEqual(report.changes.map((r) => r.status), ['baseline_missing', 'baseline_missing'])
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
  })
})

test('product cohort: historical second store remains P3 with independent roots', async () => {
  await scope(async (root) => {
    const rows = [source('one'), source('two', 'other-shop')]
    const now = await create(root, 'now', rows)
    const old = await create(root, 'old', rows.map((r) => ({
      ...r, capturedAt: '2026-10-12T12:00:00.000Z',
    })))
    const report = await compareCaptureDirectories(now, old)
    assert.equal(report.captureCount, 2)
    assert.deepEqual(report.changes.map((r) => r.status), ['unchanged', 'unchanged'])
    assert.equal(report.m5Eligible, false)
  })
})

test('product cohort: CLI outputs only anonymous manual review queue for multiple stores', async () => {
  await scope(async (root) => {
    const dir = await create(root, 'current', [
      source('one'), source('two', 'other-shop'),
    ])
    const proc = spawnSync(process.execPath, ['--experimental-strip-types', cli, dir],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    assert.equal(proc.error, undefined)
    assert.equal(proc.status, 0)
    assert.equal(proc.stderr, '')
    assert.doesNotMatch(proc.stdout,
      /supa-product-pinned-cohort-|\/proc\/self\/fd\/|example\.invalid|fake-shop|other-shop/)
    const queue = JSON.parse(proc.stdout)
    assert.equal(queue.actions.length, 2)
    assert.ok(queue.actions.every((a) => a.priority === 'P2'))
    assert.equal(queue.m5Eligible, false)
    assert.equal(queue.productionReady, false)
  })
})
