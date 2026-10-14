import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareCaptureDirectories, main,
} from '../scripts/m5-compare-capture-signatures.mjs'

const cli = fileURLToPath(new URL('../scripts/m5-compare-capture-signatures.mjs', import.meta.url))
const privateMarker = 'private-unpublished-supplier-name'
const rawHtml = '<!doctype html><body>fictional product fixture, no retailer</body>'
const sha = createHash('sha256').update(rawHtml).digest('hex')

const source = (id, extra = {}) => ({
  id, supermarket: 'imaginary-supermarket', kind: 'product',
  success: true, sha256: sha,
  capturedAt: '2026-10-13T12:00:00.000Z',
  requestedUrl: 'https://example.invalid/' + privateMarker, ...extra,
})

async function inTemp(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-private-comparison-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function makeCapture(root, name, rows, { manifestRaw = null, html = rawHtml, withHtml = true } = {}) {
  const directory = join(root, name)
  await mkdir(directory)
  if (withHtml && rows?.some((row) => row.success)) {
    await mkdir(join(directory, 'imaginary-supermarket'))
    for (const row of rows) {
      if (row.success) {
        await writeFile(join(directory, 'imaginary-supermarket', row.id + '.html'), html)
      }
    }
  }
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows?.length ?? 0, results: rows ?? [],
  }
  const original = manifestRaw ?? JSON.stringify(manifest)
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(manifestPath, original)
  return { directory, manifestPath, original }
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1_048_576,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return result
}

function assertPrivateFailure(result, pathRoot) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline comparison failed: invalid capture or report\n')
  assert.doesNotMatch(result.stderr,
    /Error:|at file:|node:internal|manifest\.json|imaginary-supermarket|private-unpublished-supplier-name|example\.invalid|supa-product-private-comparison-/)
  assert.equal(result.stderr.includes(pathRoot), false)
}

test('product direct CLI privacy: missing original capture path never leaks it', async () => {
  await inTemp(async (root) => {
    const absent = join(root, privateMarker)
    assertPrivateFailure(runCli(absent), root)
  })
})

test('product direct CLI privacy: missing original manifest never leaks path', async () => {
  await inTemp(async (root) => {
    const directory = join(root, privateMarker)
    await mkdir(directory)
    assertPrivateFailure(runCli(directory), root)
  })
})

test('product direct CLI privacy: invalid current JSON refused with no stdout', async () => {
  await inTemp(async (root) => {
    const capture = await makeCapture(root, 'current', [], {
      manifestRaw: '{"malformed private local content',
    })
    assertPrivateFailure(runCli(capture.directory), root)
    assert.equal(await readFile(capture.manifestPath, 'utf8'), capture.original)
  })
})

test('product direct CLI privacy: malformed historical JSON does not leak a private path', async () => {
  await inTemp(async (root) => {
    const now = await makeCapture(root, 'current', [source('anonymous')])
    const prior = await makeCapture(root, 'historical', [source('anonymous')], {
      manifestRaw: '{"invalid historical private',
      withHtml: false,
    })
    assertPrivateFailure(runCli(now.directory, prior.directory), root)
    assert.equal(await readFile(now.manifestPath, 'utf8'), now.original)
    assert.equal(await readFile(prior.manifestPath, 'utf8'), prior.original)
  })
})

test('product direct CLI privacy: SHA-mismatched HTML fails without original source name', async () => {
  await inTemp(async (root) => {
    const now = await makeCapture(root, 'current', [source('private-capture')], {
      html: '<body>tampered fictional raw input</body>',
    })
    assertPrivateFailure(runCli(now.directory), root)
    assert.equal(await readFile(now.manifestPath, 'utf8'), now.original)
    // Direct JS API must still provide trusted, source-independent diagnostic.
    await assert.rejects(() => compareCaptureDirectories(now.directory),
      /integrity mismatch/)
  })
})

test('product direct CLI privacy: absent successful HTML is generic for current+historical', async () => {
  await inTemp(async (root) => {
    const now = await makeCapture(root, 'current', [source('private-capture')], {
      withHtml: false,
    })
    const old = await makeCapture(root, 'historical', [source('private-capture', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })], { withHtml: false })
    assertPrivateFailure(runCli(now.directory, old.directory), root)
  })
})

test('product direct CLI privacy: invalid CLI arguments emit no private identifiers', async () => {
  await inTemp(async (root) => {
    assertPrivateFailure(runCli(), root)
    assertPrivateFailure(runCli('--private-unpublished-supplier-name'), root)
    assertPrivateFailure(runCli(root, root, privateMarker), root)
  })
})

test('product direct CLI privacy: valid P1 unavailable capture remains manual-only', async () => {
  await inTemp(async (root) => {
    const current = await makeCapture(root, 'current', [{
      id: 'unavailable', supermarket: 'imaginary-supermarket',
      kind: 'product', success: false,
    }], { withHtml: false })
    const result = runCli(current.directory)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.mode, 'offline_capture_signature_review_only')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.changes[0].status, 'unavailable')
  })
})

test('product direct CLI privacy: valid P2 current-only report remains unchanged', async () => {
  await inTemp(async (root) => {
    const current = await makeCapture(root, 'current', [source('first')])
    const cliReport = runCli(current.directory)
    assert.equal(cliReport.status, 0)
    assert.equal(cliReport.stderr, '')
    const result = JSON.parse(cliReport.stdout)
    const apiResult = await main([current.directory])
    assert.equal(result.changes[0].status, 'baseline_missing')
    assert.equal(apiResult.changes[0].status, 'baseline_missing')
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  })
})

test('product direct CLI privacy: independent historical unchanged P3 still emitted', async () => {
  await inTemp(async (root) => {
    const current = await makeCapture(root, 'current', [source('first')])
    const historical = await makeCapture(root, 'historical', [source('first', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })])
    const result = runCli(current.directory, historical.directory)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.baselineProvided, true)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
  })
})
