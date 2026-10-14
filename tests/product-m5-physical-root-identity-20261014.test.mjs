import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Product-core fixed-source identity smoke proof; independent QA #2171 is
// separately owned and its original test bytes remain untouched.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>fictitious private offline product</body></html>'
const sha = createHash('sha256').update(html).digest('hex')

async function capture(root, folder, time) {
  const directory = join(root, folder)
  const store = join(directory, 'fictional-shop')
  await mkdir(store, { recursive: true })
  const file = join(store, 'fictional-product.html')
  const manifest = join(directory, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'fictional-product', supermarket: 'fictional-shop', kind: 'product',
      success: true, requestedUrl: 'https://example.invalid/fictitious',
      capturedAt: time, sha256: sha,
    }],
  })
  await writeFile(file, html)
  await writeFile(manifest, raw)
  return { directory, file, manifest, raw }
}

async function unchanged(...fixtures) {
  for (const fixture of fixtures) {
    assert.equal(await readFile(fixture.file, 'utf8'), html)
    assert.equal(await readFile(fixture.manifest, 'utf8'), fixture.raw)
  }
}

function command(currentDir, baselineDir = null) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, currentDir,
    ...(baselineDir ? [baselineDir] : []),
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.doesNotMatch(result.stdout + result.stderr,
    /fictional-product|fictional-shop|example\.invalid|fictitious|supa-product-root-identity/)
  return result
}

function assertManualOnly(result, status, priority) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.actions.length, 1)
  assert.equal(report.actions[0].status, status)
  assert.equal(report.actions[0].priority, priority)
  assert.equal(report.actions[0].rightsVerified, false)
  assert.equal(report.actions[0].selectorVerified, false)
  assert.equal(report.actions[0].productionEnabled, false)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.selectorVerified, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
}

function assertRefused(result) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '', 'must not emit a forged historical review queue')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
}

test('product: one current SHA-verified physical root gives private P2 only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-identity-'))
  try {
    const now = await capture(root, 'current', '2026-10-13T12:00:00.000Z')
    assertManualOnly(command(now.directory), 'baseline_missing', 'P2')
    await unchanged(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: independent older physical capture root is eligible for private P3 only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-identity-'))
  try {
    const previous = await capture(root, 'older', '2026-10-12T12:00:00.000Z')
    const now = await capture(root, 'current', '2026-10-13T12:00:00.000Z')
    assertManualOnly(command(now.directory, previous.directory), 'unchanged', 'P3')
    const report = await compareCaptureDirectories(now.directory, previous.directory)
    assert.equal(report.baselineProvided, true)
    assert.equal(report.productionReady, false)
    await unchanged(previous, now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: identical current and historical argv is refused before review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-identity-'))
  try {
    const now = await capture(root, 'current', '2026-10-13T12:00:00.000Z')
    await assert.rejects(
      () => compareCaptureDirectories(now.directory, now.directory),
      /Independent historical capture directory required/,
    )
    assertRefused(command(now.directory, now.directory))
    await unchanged(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: lexical directory-dot alias cannot masquerade as independent history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-identity-'))
  try {
    const now = await capture(root, 'current', '2026-10-13T12:00:00.000Z')
    assertRefused(command(now.directory, now.directory + '/.'))
    await unchanged(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: directory symlink alias of same capture tree cannot masquerade as history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-root-identity-'))
  try {
    const now = await capture(root, 'current', '2026-10-13T12:00:00.000Z')
    const alias = join(root, 'same-physical-root')
    await symlink(now.directory, alias, 'dir')
    assertRefused(command(now.directory, alias))
    await unchanged(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})
