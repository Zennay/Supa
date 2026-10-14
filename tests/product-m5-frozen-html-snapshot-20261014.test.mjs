import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  access, link, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'

const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><body>only invented offline HTML</body>'
const sha256 = (input) => createHash('sha256').update(input).digest('hex')
const row = (id, extra = {}) => ({
  id, supermarket: 'invented-store', kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/never-request',
  capturedAt: '2026-10-13T12:00:00.000Z', sha256: sha256(html), ...extra,
})

async function scoped(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-frozen-html-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function capture(root, name, rows, { writeHtml = true, htmlById = {} } = {}) {
  const dir = join(root, name)
  await mkdir(dir)
  if (writeHtml) {
    const stores = new Set()
    for (const source of rows) {
      if (!source.success) continue
      if (!stores.has(source.supermarket)) {
        await mkdir(join(dir, source.supermarket))
        stores.add(source.supermarket)
      }
      await writeFile(join(dir, source.supermarket, source.id + '.html'),
        htmlById[source.id] ?? html)
    }
  }
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  }
  const manifestPath = join(dir, 'manifest.json')
  const raw = JSON.stringify(manifest)
  await writeFile(manifestPath, raw)
  return { dir, manifest, manifestPath, raw }
}

test('product frozen capture: SHA verified normal P2 is still manual-only', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('good')])
    const report = await compareCaptureDirectories(now.dir)
    assert.equal(report.captureCount, 1)
    assert.equal(report.changes[0].status, 'baseline_missing')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(await readFile(now.manifestPath, 'utf8'), now.raw)
  })
})

test('product frozen capture: real independent older matched HTML remains P3', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('good')])
    const old = await capture(root, 'old', [row('good', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })])
    const report = await compareCaptureDirectories(now.dir, old.dir)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.m5Eligible, false)
    assert.equal(await readFile(old.manifestPath, 'utf8'), old.raw)
  })
})

test('product frozen capture: P1 source needs neither HTML nor digest', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('failed', {
      success: false, sha256: undefined,
    })], { writeHtml: false })
    const report = await compareCaptureDirectories(now.dir)
    assert.equal(report.changes[0].status, 'unavailable')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
  })
})

test('product frozen capture: original source can change AFTER private copy without changing inspection', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('pinned')])
    const sourcePath = join(now.dir, 'invented-store', 'pinned.html')
    let privateDir
    const result = await inspectFrozenCaptureDirectory(now.dir, now.manifest, async (snapshot) => {
      privateDir = snapshot
      await writeFile(sourcePath, 'MODIFIED AFTER SNAPSHOT')
      return inspectCaptureDirectory(snapshot)
    })
    assert.equal(result.sources[0].integrity, 'verified')
    assert.equal(result.sources[0].manifestSha256, sha256(html))
    assert.equal(await readFile(sourcePath, 'utf8'), 'MODIFIED AFTER SNAPSHOT')
    assert.equal(await readFile(now.manifestPath, 'utf8'), now.raw)
    await assert.rejects(access(privateDir), { code: 'ENOENT' })
  })
})

test('product frozen capture: temp root, manifest and source permissions are private then cleaned', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('private')])
    let snapshot
    await inspectFrozenCaptureDirectory(now.dir, now.manifest, async (dir) => {
      snapshot = dir
      assert.equal((await stat(dir)).mode & 0o777, 0o700)
      assert.equal((await stat(join(dir, 'manifest.json'))).mode & 0o777, 0o600)
      assert.equal((await stat(join(dir, 'invented-store', 'private.html'))).mode & 0o777, 0o600)
      assert.equal(await readFile(join(dir, 'invented-store', 'private.html'), 'utf8'), html)
      return inspectCaptureDirectory(dir)
    })
    await assert.rejects(access(snapshot), { code: 'ENOENT' })
  })
})

test('product frozen capture: inspector error still removes private snapshot', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('cleanup')])
    let privateDir
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(now.dir, now.manifest, async (snapshot) => {
        privateDir = snapshot
        throw new Error('synthetic inspector error')
      }),
      /synthetic inspector error/,
    )
    await assert.rejects(access(privateDir), { code: 'ENOENT' })
    assert.equal(await readFile(now.manifestPath, 'utf8'), now.raw)
  })
})

test('product frozen capture: mismatched original HTML bytes refused before M1 inspector', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('corrupt')], {
      htmlById: { corrupt: '<html>different bytes</html>' },
    })
    let inspected = false
    await assert.rejects(
      () => inspectFrozenCaptureDirectory(now.dir, now.manifest, async () => {
        inspected = true
        return null
      }),
      /^Error: Capture integrity mismatch$/,
    )
    assert.equal(inspected, false)
  })
})

test('product frozen capture: symbolic-link HTML cannot become private source', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('borrowed')], { writeHtml: false })
    const store = join(now.dir, 'invented-store')
    await mkdir(store)
    const outside = join(root, 'outside.html')
    await writeFile(outside, html)
    await symlink(outside, join(store, 'borrowed.html'))
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: multiply linked HTML source is rejected by opened descriptor', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('borrowed')])
    await link(join(now.dir, 'invented-store', 'borrowed.html'), join(root, 'borrowed.html'))
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: symlinked store folder cannot borrow outside HTML', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('borrowed', {
      supermarket: 'alias-store',
    })], { writeHtml: false })
    const outside = join(root, 'real-store')
    await mkdir(outside)
    await writeFile(join(outside, 'borrowed.html'), html)
    await symlink(outside, join(now.dir, 'alias-store'))
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: 8MiB+1 HTML original cannot be inspected', async () => {
  await scoped(async (root) => {
    const oversized = 'x'.repeat(8 * 1024 * 1024 + 1)
    const now = await capture(root, 'now', [row('oversized', {
      sha256: sha256(oversized),
    })], { htmlById: { oversized } })
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: unreadable malformed UTF-8 HTML cannot become M1 verified', async () => {
  await scoped(async (root) => {
    const malformed = Buffer.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0xff])
    const now = await capture(root, 'now', [row('invalid-encoding', {
      sha256: sha256(malformed),
    })], { htmlById: { 'invalid-encoding': malformed } })
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: raw malformed metadata cannot path-escape snapshot', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('failed', {
      success: false, id: '../forged', sha256: undefined,
    })], { writeHtml: false })
    await assert.rejects(() => inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /^Error: Invalid frozen offline capture source$/)
  })
})

test('product frozen capture: unchanged manual review CLI never emits temp/original private paths', async () => {
  await scoped(async (root) => {
    const now = await capture(root, 'now', [row('private-source')])
    const run = spawnSync(process.execPath, [
      '--experimental-strip-types', cli, now.dir,
    ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
    assert.equal(run.error, undefined)
    assert.equal(run.signal, null)
    assert.equal(run.status, 0)
    assert.equal(run.stderr, '')
    assert.doesNotMatch(run.stdout, /supa-m5-private-inspection-|supa-product-frozen-html-|example\.invalid|invented-store/)
    const report = JSON.parse(run.stdout)
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.actions.length, 1)
    assert.equal(report.actions[0].priority, 'P2')
  })
})
