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

import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'
import { withPinnedCaptureStore } from '../scripts/m5-pin-capture-store.mjs'

const html = '<!doctype html><html><body>first fictional snapshot</body></html>'
const borrowed = '<!doctype html><html><body>second fictional snapshot</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const row = (id, extra = {}) => ({
  id, supermarket: 'invented-store', kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/fictional', sha256: sha,
  capturedAt: '2026-10-13T12:00:00.000Z', ...extra,
})

async function scoped(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-pinned-store-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function fixture(root, name, rows, withHtml = true) {
  const directory = join(root, name)
  await mkdir(directory)
  if (withHtml) {
    await mkdir(join(directory, 'invented-store'))
    for (const source of rows) {
      if (source.success) {
        await writeFile(join(directory, 'invented-store', source.id + '.html'), html)
      }
    }
  }
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
  return { directory, manifest }
}

test('product pinned M5 store: renamed original parent and inserted borrowed symlink cannot redirect source read', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    const store = join(original.directory, 'invented-store')
    const moved = join(original.directory, 'moved-original')
    const outside = join(root, 'borrowed-store')
    await mkdir(outside)
    await writeFile(join(outside, 'item.html'), borrowed)
    const bytes = await withPinnedCaptureStore(original.directory, 'invented-store', async (pinned) => {
      await rename(store, moved)
      await symlink(outside, store)
      assert.equal(await readFile(join(store, 'item.html'), 'utf8'), borrowed)
      return readFile(pinned('item'), 'utf8')
    })
    assert.equal(bytes, html)
  })
})

test('product pinned M5 root: original root rename plus borrowed root symlink cannot redirect already pinned store', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    const moved = join(root, 'moved-root')
    const outside = join(root, 'other-root')
    await mkdir(outside)
    await mkdir(join(outside, 'invented-store'))
    await writeFile(join(outside, 'invented-store', 'item.html'), borrowed)
    const bytes = await withPinnedCaptureStore(original.directory, 'invented-store', async (pinned) => {
      await rename(original.directory, moved)
      await symlink(outside, original.directory)
      assert.equal(await readFile(join(original.directory, 'invented-store', 'item.html'), 'utf8'), borrowed)
      return readFile(pinned('item'), 'utf8')
    })
    assert.equal(bytes, html)
  })
})

test('product pinned M5 store: rejects initially symlinked supermarket without callback', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [], false)
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(original.directory, 'invented-store'))
    let called = false
    await assert.rejects(() => withPinnedCaptureStore(
      original.directory, 'invented-store', async () => { called = true },
    ), /^Error: Invalid frozen offline capture source$/)
    assert.equal(called, false)
  })
})

test('product pinned M5 root: rejects original capture-root symlink before callback', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    const link = join(root, 'borrowed-alias')
    await symlink(original.directory, link)
    let called = false
    await assert.rejects(() => withPinnedCaptureStore(
      link, 'invented-store', async () => { called = true },
    ), /^Error: Invalid frozen offline capture source$/)
    assert.equal(called, false)
  })
})

test('product pinned M5 store: never exposes traversal or non-ASCII source IDs as proc-fd paths', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    await withPinnedCaptureStore(original.directory, 'invented-store', async (pinned) => {
      for (const id of ['', null, '../escape', 'a/b', 'é', 'x'.repeat(129)]) {
        assert.throws(() => pinned(id), /^Error: Invalid frozen offline capture source$/)
      }
      assert.match(pinned('item'), /^\/proc\/self\/fd\/\d+\/item\.html$/)
    })
  })
})

test('product pinned M5 store: callback exception is not converted to an origin error', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    await assert.rejects(
      () => withPinnedCaptureStore(original.directory, 'invented-store', async () => {
        throw new Error('synthetic callback stopped')
      }),
      /^Error: synthetic callback stopped$/,
    )
  })
})

test('product pinned M5 snapshot: whole M5 P2 offline report remains private and provisional', async () => {
  await scoped(async (root) => {
    const original = await fixture(root, 'original', [row('item')])
    const output = await compareCaptureDirectories(original.directory)
    assert.equal(output.changes[0].status, 'baseline_missing')
    assert.equal(output.m5Eligible, false)
    assert.equal(output.productionReady, false)
  })
})

test('product pinned M5 snapshot: genuinely separate same-source older capture still classifies P3', async () => {
  await scoped(async (root) => {
    const now = await fixture(root, 'now', [row('item')])
    const old = await fixture(root, 'old', [row('item', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })])
    const result = await compareCaptureDirectories(now.directory, old.directory)
    assert.equal(result.changes[0].status, 'unchanged')
    assert.equal(result.m5Eligible, false)
    assert.equal(result.productionReady, false)
  })
})

test('product pinned M5 snapshot: unavailable/P1 without HTML stays unavailable', async () => {
  await scoped(async (root) => {
    const now = await fixture(root, 'now', [{
      id: 'failed', supermarket: 'invented-store', kind: 'product',
      success: false,
    }], false)
    const result = await compareCaptureDirectories(now.directory)
    assert.equal(result.changes[0].status, 'unavailable')
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  })
})

test('product pinned M5 snapshot: CLI still emits no path or source labels', async () => {
  await scoped(async (root) => {
    const now = await fixture(root, 'now', [row('item')])
    const run = spawnSync(process.execPath, ['--experimental-strip-types', cli, now.directory],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    assert.equal(run.status, 0)
    assert.equal(run.stderr, '')
    assert.doesNotMatch(run.stdout, /supa-product-pinned-store-|\/proc\/self\/fd\/|invented-store|example\.invalid/)
    const queue = JSON.parse(run.stdout)
    assert.equal(queue.actions[0].priority, 'P2')
    assert.equal(queue.productionReady, false)
    assert.equal(queue.m5Eligible, false)
  })
})
