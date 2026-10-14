import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Product-owner byte-budget proof. Independent QA #2166 remains unchanged.
// All files are invented local HTML and no network/retailer is contacted.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const MiB = 1024 * 1024

function fakeHtml(bytes) {
  const prefix = '<!doctype html><body>'
  const suffix = '</body>'
  assert.ok(bytes >= prefix.length + suffix.length)
  return prefix + 'x'.repeat(bytes - prefix.length - suffix.length) + suffix
}
async function capture(root, folder, sizes, timestamp = '2026-10-13T10:00:00.000Z') {
  const directory = join(root, folder)
  const store = join(directory, 'pretend-store')
  await mkdir(store, { recursive: true })
  const records = []
  const files = []
  for (let i = 0; i < sizes.length; i++) {
    const name = 'fictional-' + i
    const failure = sizes[i] === null
    if (!failure) {
      const html = fakeHtml(sizes[i])
      const file = join(store, name + '.html')
      await writeFile(file, html)
      files.push({ file, size: sizes[i], sha: createHash('sha256').update(html).digest('hex') })
    }
    records.push({
      id: name, supermarket: 'pretend-store', kind: 'product',
      success: !failure, requestedUrl: 'https://example.invalid/local',
      ...(failure ? { error: 'offline' } : { sha256: files.at(-1).sha, capturedAt: timestamp }),
    })
  }
  const manifest = join(directory, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records,
  })
  await writeFile(manifest, raw)
  return { directory, files, manifest, raw }
}
async function unchanged(...captures) {
  for (const input of captures) {
    assert.equal(await readFile(input.manifest, 'utf8'), input.raw)
    for (const file of input.files) {
      assert.equal((await stat(file.file)).size, file.size)
      assert.equal(createHash('sha256').update(await readFile(file.file)).digest('hex'), file.sha)
    }
  }
}
function review(now, previous = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory,
    ...(previous ? [previous.directory] : []),
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-|pretend-store|example\.invalid|supa-product-byte-budget/)
  return r
}
function denied(r) {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}
function manual(r, priority) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const body = JSON.parse(r.stdout)
  assert.equal(body.actions.length, 1)
  assert.equal(body.actions[0].priority, priority)
  assert.equal(body.productionReady, false)
  assert.equal(body.m5Eligible, false)
  assert.equal(body.rightsVerified, false)
  assert.equal(body.selectorVerified, false)
}
test('product: tiny SHA-verified HTML remains P2 only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const c = await capture(root, 'current', [96])
    manual(review(c), 'P2')
    await unchanged(c)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: failed M1 capture needs no HTML and remains P1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const c = await capture(root, 'current', [null])
    manual(review(c), 'P1')
    await unchanged(c)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: exact per-HTML 8 MiB boundary remains bounded and manual P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const c = await capture(root, 'current', [8 * MiB])
    manual(review(c), 'P2')
    await unchanged(c)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: SHA-matching oversized current HTML refuses any private queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const c = await capture(root, 'current', [8 * MiB + 1])
    denied(review(c))
    await unchanged(c)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: SHA-matching oversized historical HTML also fails whole queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const now = await capture(root, 'current', [96])
    const before = await capture(root, 'baseline', [8 * MiB + 1], '2026-10-12T10:00:00.000Z')
    denied(review(now, before))
    await unchanged(now, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: five individually valid 7 MiB files exceed aggregate 32 MiB budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-byte-budget-'))
  try {
    const c = await capture(root, 'current', Array(5).fill(7 * MiB))
    denied(review(c))
    await unchanged(c)
  } finally { await rm(root, { recursive: true, force: true }) }
})
