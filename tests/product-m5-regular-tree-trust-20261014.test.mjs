import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Owned product-core smoke coverage. Original QA-only #2169 files unchanged.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>fictional local-only</body></html>'
const sha = createHash('sha256').update(html).digest('hex')

async function capture(mode, timestamp = '2026-10-13T12:00:00.000Z') {
  const base = await mkdtemp(join(tmpdir(), 'supa-product-tree-'))
  const realRoot = join(base, 'real-root')
  const outside = join(base, 'external')
  const requested = mode === 'root-link' ? join(base, 'linked-root') : realRoot
  await mkdir(realRoot)
  await mkdir(outside)
  const externalHtml = join(outside, 'invented.html')
  await writeFile(externalHtml, html)
  const manifestData = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'invented', supermarket: 'fictional-shop', kind: 'product',
      success: mode !== 'failed', requestedUrl: 'https://example.invalid/offline',
      ...(mode === 'failed' ? {} : { sha256: sha, capturedAt: timestamp }),
    }],
  })
  const realManifest = join(realRoot, 'manifest.json')
  if (mode === 'manifest-link') {
    await writeFile(join(outside, 'manifest.json'), manifestData)
    await symlink(join(outside, 'manifest.json'), realManifest, 'file')
  } else {
    await writeFile(realManifest, manifestData)
  }
  if (mode !== 'failed') {
    const store = join(realRoot, 'fictional-shop')
    if (mode === 'store-link') {
      await symlink(outside, store, 'dir')
    } else {
      await mkdir(store)
      const target = join(store, 'invented.html')
      if (mode === 'html-link') await symlink(externalHtml, target, 'file')
      else await writeFile(target, html)
    }
  }
  if (mode === 'root-link') await symlink(realRoot, requested, 'dir')
  return { base, realRoot, requested, outside, externalHtml, manifestData, realManifest, mode }
}

function run(current, baseline = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, current.requested,
    ...(baseline ? [baseline.requested] : []),
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-shop|invented|example\.invalid|local-only|supa-product-tree-/)
  return r
}
function denied(r) {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}
function review(r, expected) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const data = JSON.parse(r.stdout)
  assert.equal(data.actions.length, 1)
  assert.equal(data.actions[0].priority, expected)
  assert.equal(data.rightsVerified, false)
  assert.equal(data.selectorVerified, false)
  assert.equal(data.productionReady, false)
  assert.equal(data.m5Eligible, false)
}
async function intact(f) {
  assert.equal(await readFile(f.realManifest, 'utf8'), f.manifestData)
  assert.equal(await readFile(f.externalHtml, 'utf8'), html)
  if (f.mode === 'root-link') assert.equal((await lstat(f.requested)).isSymbolicLink(), true)
  if (f.mode === 'manifest-link') assert.equal((await lstat(f.realManifest)).isSymbolicLink(), true)
  if (f.mode === 'store-link') assert.equal((await lstat(join(f.realRoot, 'fictional-shop'))).isSymbolicLink(), true)
  if (f.mode === 'html-link') assert.equal((await lstat(join(f.realRoot, 'fictional-shop', 'invented.html'))).isSymbolicLink(), true)
}

for (const [mode, priority] of [['regular', 'P2'], ['failed', 'P1']]) {
  test('product M5 offline capture ' + mode + ' stays conservative ' + priority, async () => {
    const f = await capture(mode)
    try { review(run(f), priority); await intact(f) }
    finally { await rm(f.base, { recursive: true, force: true }) }
  })
}

for (const mode of ['root-link', 'manifest-link', 'store-link', 'html-link']) {
  test('product M5 rejects symbolic alias before any human review: ' + mode, async () => {
    const f = await capture(mode)
    try { denied(run(f)); await intact(f) }
    finally { await rm(f.base, { recursive: true, force: true }) }
  })
}

test('product M5 refuses symlinked historical HTML even with a regular current capture', async () => {
  const now = await capture('regular')
  const prior = await capture('html-link', '2026-10-12T12:00:00.000Z')
  try {
    denied(run(now, prior))
    await intact(now)
    await intact(prior)
  } finally {
    await rm(now.base, { recursive: true, force: true })
    await rm(prior.base, { recursive: true, force: true })
  }
})
