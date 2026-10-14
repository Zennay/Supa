import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Product-core synthetic acceptance: no supermarket connections or real prices.
// Independent QA #2174 owns the original chronology regression suites.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>invented-source</body></html>'
const sha = createHash('sha256').update(html).digest('hex')

async function capture(root, folder, at, success = true) {
  const dir = join(root, folder)
  await mkdir(join(dir, 'invented-store'), { recursive: true })
  if (success) await writeFile(join(dir, 'invented-store', 'invented-item.html'), html)
  const record = {
    id: 'invented-item', supermarket: 'invented-store', kind: 'product',
    success, requestedUrl: 'https://example.invalid/item',
    ...(success ? { sha256: sha } : { error: 'not-captured' }),
    ...(at ? { capturedAt: at } : {}),
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: 1, results: [record],
  }))
  return dir
}

async function check({ currentTime, baselineTime, currentSuccess = true, expectedStatus, expectedPriority, refused = false }) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-product-chronology-'))
  try {
    const current = await capture(root, 'current', currentTime, currentSuccess)
    const baseline = baselineTime ? await capture(root, 'baseline', baselineTime) : null
    const child = spawnSync(process.execPath, [
      '--experimental-strip-types', cli, current, ...(baseline ? [baseline] : []),
    ], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(child.error, undefined)
    assert.equal(child.signal, null)
    assert.doesNotMatch(child.stdout + child.stderr, /invented-item|invented-store|example\.invalid|supa-m5-product-chronology/)
    if (refused) {
      assert.notEqual(child.status, 0)
      assert.equal(child.stdout, '')
      assert.equal(child.stderr, 'Offline review failed: invalid capture or report\n')
    } else {
      assert.equal(child.status, 0, child.stderr)
      assert.equal(child.stderr, '')
      const report = JSON.parse(child.stdout)
      assert.equal(report.actions.length, 1)
      assert.equal(report.actions[0].status, expectedStatus)
      assert.equal(report.actions[0].priority, expectedPriority)
      assert.equal(report.m5Eligible, false)
      assert.equal(report.productionReady, false)
      assert.equal(report.rightsVerified, false)
      assert.equal(report.selectorVerified, false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('product: real leap day and independently earlier offset timestamp remain manual P3', async () => {
  await check({
    currentTime: '2024-02-29T09:00:00.001Z',
    baselineTime: '2024-02-29T10:00:00+01:00',
    expectedStatus: 'unchanged', expectedPriority: 'P3',
  })
})

test('product: failed first observation without capturedAt remains P1 unavailable', async () => {
  await check({ currentTime: null, currentSuccess: false,
    expectedStatus: 'unavailable', expectedPriority: 'P1' })
})

for (const value of [
  '2026-02-29T10:00:00Z',
  '2026-04-31T10:00:00Z',
  '2026-10-13T10:00:00.0000Z',
  '2026-10-13T10:00:00+14:30',
  '2026-10-13 10:00:00Z',
]) {
  test('product: noncanonical observation time fails before review: ' + value, async () => {
    await check({ currentTime: value, refused: true })
  })
}

test('product: same instant is not historical, even with different offset', async () => {
  await check({
    currentTime: '2026-10-13T10:00:00.000Z',
    baselineTime: '2026-10-13T11:00:00+01:00',
    refused: true,
  })
})
