import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Product source-side regression; original independent QA is not modified.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>synthetic local-only</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const baseRow = (id, details = {}) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  success: true, requestedUrl: 'https://example.invalid/research',
  sha256: sha, capturedAt: '2026-10-13T12:00:00.000Z', ...details,
})

async function capture(root, label, rows, htmlPresent = false) {
  const directory = join(root, label)
  await mkdir(directory, { recursive: true })
  if (htmlPresent) {
    await mkdir(join(directory, 'fictional-store'), { recursive: true })
    for (const row of rows) {
      if (row.success && row.supermarket === 'fictional-store' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(row.id)) {
        await writeFile(join(directory, 'fictional-store', row.id + '.html'), html)
      }
    }
  }
  const manifest = join(directory, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  })
  await writeFile(manifest, raw)
  return { directory, manifest, raw }
}

function cliRun(now, before = null) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory,
    ...(before ? [before.directory] : []),
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.doesNotMatch(result.stdout + result.stderr,
    /fictional-store|example\.invalid|synthetic local-only|supa-m5-raw-origin/)
  return result
}

async function rejectEarly(now, before = null) {
  await assert.rejects(
    () => compareCaptureDirectories(now.directory, before?.directory),
    /^Error: Invalid or oversized M1 capture manifest$/,
  )
  const response = cliRun(now, before)
  assert.notEqual(response.status, 0)
  assert.equal(response.stdout, '')
  assert.equal(response.stderr, 'Offline review failed: invalid capture or report\n')
  assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  if (before) assert.equal(await readFile(before.manifest, 'utf8'), before.raw)
}

test('product origin: valid fictional source still yields only manual P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [baseRow('good')], true)
    const result = await compareCaptureDirectories(now.directory)
    assert.equal(result.captureCount, 1)
    assert.equal(result.changes[0].status, 'baseline_missing')
    assert.equal(result.m5Eligible, false)
    assert.equal(result.productionReady, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: valid unknown/P1 without HTML remains private unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const row = baseRow('failed', { success: false })
    const now = await capture(root, 'now', [row], false)
    const result = await compareCaptureDirectories(now.directory)
    assert.equal(result.changes[0].status, 'unavailable')
    assert.equal(result.m5Eligible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: legitimate independent older source remains P3 manual only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [baseRow('good')], true)
    const before = await capture(root, 'older', [baseRow('good', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })], true)
    const report = await compareCaptureDirectories(now.directory, before.directory)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: later missing supermarket rejects before earlier source HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [
      baseRow('good'), baseRow('bad', { supermarket: undefined }),
    ])
    await rejectEarly(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: later invalid kind rejects before earlier source HTML', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [
      baseRow('good'), baseRow('bad', { kind: '../outside' }),
    ])
    await rejectEarly(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: unavailable/P1 record with control-only store cannot enter cohort', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [
      baseRow('good'), baseRow('failed', { success: false, supermarket: '\u0000' }),
    ])
    await rejectEarly(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: overlong kind rejects before HTML read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [
      baseRow('good'), baseRow('bad', { kind: 'a'.repeat(129) }),
    ])
    await rejectEarly(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product origin: malformed historical origin refuses before current HTML is present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-raw-origin-'))
  try {
    const now = await capture(root, 'now', [baseRow('good')])
    const before = await capture(root, 'old', [
      baseRow('good', { capturedAt: '2026-10-12T12:00:00.000Z' }),
      baseRow('bad', { kind: null, success: false }),
    ])
    await rejectEarly(now, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
