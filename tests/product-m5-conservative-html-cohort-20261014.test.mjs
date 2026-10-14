import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Product-core acceptance for the conservative *aggregate* 8 MiB offline
// input envelope. Independent original QA #2187 stays byte-identical.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const MiB = 1024 * 1024
const html = (bytes) => '<!doctype html>' + 'x'.repeat(bytes - 15)

async function capture(root, label, bytes, stamp = '2026-10-13T12:00:00.000Z') {
  const directory = join(root, label)
  const store = join(directory, 'invented-store')
  await mkdir(store, { recursive: true })
  const records = []
  const written = []
  for (let i = 0; i < bytes.length; i += 1) {
    const id = 'invented-' + i
    if (bytes[i] === null) {
      records.push({ id, supermarket: 'invented-store', kind: 'product', success: false })
      continue
    }
    const file = join(store, id + '.html')
    const raw = html(bytes[i])
    const digest = createHash('sha256').update(raw).digest('hex')
    await writeFile(file, raw)
    written.push({ file, digest, size: bytes[i] })
    records.push({
      id, supermarket: 'invented-store', kind: 'product', success: true,
      capturedAt: stamp, requestedUrl: 'https://example.invalid/product',
      sha256: digest,
    })
  }
  const manifest = join(directory, 'manifest.json')
  const rawManifest = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records,
  })
  await writeFile(manifest, rawManifest)
  return { directory, manifest, rawManifest, written }
}

function cliResult(current, previous) {
  const run = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, current.directory,
    ...(previous ? [previous.directory] : []),
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 25000 })
  assert.equal(run.error, undefined)
  assert.equal(run.signal, null)
  assert.doesNotMatch(run.stdout + run.stderr,
    /invented-|invented-store|example\.invalid|supa-m5-cohort-limit/)
  return run
}

async function unchanged(...samples) {
  for (const sample of samples) {
    assert.equal(await readFile(sample.manifest, 'utf8'), sample.rawManifest)
    for (const file of sample.written) {
      const bytes = await readFile(file.file)
      assert.equal(bytes.length, file.size)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.digest)
    }
  }
}

function expectRefused(result) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
}

function expectManual(result, count, priority) {
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.actions.length, count)
  assert.equal(data.actions.every(row => row.priority === priority), true)
  assert.equal(data.m5Eligible, false)
  assert.equal(data.productionReady, false)
  assert.equal(data.rightsVerified, false)
  assert.equal(data.selectorVerified, false)
}

test('product: multiple independent small captures totalling exactly 8 MiB remain manual P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-cohort-limit-'))
  try {
    const current = await capture(root, 'now', [3 * MiB, 5 * MiB])
    expectManual(cliResult(current), 2, 'P2')
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: two individually valid 5 MiB files cannot bypass aggregate 8 MiB ceiling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-cohort-limit-'))
  try {
    const current = await capture(root, 'now', [5 * MiB, 5 * MiB])
    expectRefused(cliResult(current))
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: aggregate overflow in historical reference with safe current also refuses all output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-cohort-limit-'))
  try {
    const current = await capture(root, 'now', [64])
    const baseline = await capture(root, 'older', [5 * MiB, 5 * MiB], '2026-10-12T12:00:00.000Z')
    expectRefused(cliResult(current, baseline))
    await unchanged(current, baseline)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: failed capture contributes zero bytes and remains P1 beside bounded P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-cohort-limit-'))
  try {
    const current = await capture(root, 'now', [8 * MiB, null])
    const result = cliResult(current)
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(result.stdout)
    assert.deepEqual(data.actions.map(x => x.priority).sort(), ['P1','P2'])
    assert.equal(data.m5Eligible, false)
    assert.equal(data.productionReady, false)
    await unchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})
