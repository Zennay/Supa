import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const HTML = '<!doctype html><html><body>invented local-only source</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')

async function fixture(root, label, mode, capturedAt = '2026-10-13T12:00:00.000Z') {
  const folder = join(root, label)
  const market = join(folder, 'invented-store')
  const external = join(folder, 'external')
  await mkdir(market, { recursive: true })
  await mkdir(external)
  const html = join(market, 'invented-product.html')
  const outerHtml = join(external, 'source.html')
  await writeFile(outerHtml, HTML)
  if (mode !== 'failed') {
    if (mode === 'html-hardlink') await link(outerHtml, html)
    else await writeFile(html, HTML)
  }
  const body = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'invented-product', supermarket: 'invented-store', kind: 'product',
      requestedUrl: 'https://example.invalid/fiction',
      success: mode !== 'failed',
      ...(mode === 'failed' ? {} : { sha256: SHA, capturedAt }),
    }],
  })
  const manifest = join(folder, 'manifest.json')
  const outsideManifest = join(external, 'manifest.json')
  await writeFile(outsideManifest, body)
  if (mode === 'manifest-hardlink') await link(outsideManifest, manifest)
  else await writeFile(manifest, body)
  return { folder, market, external, manifest, outsideManifest, html, outerHtml, body, mode }
}

function run(now, before = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.folder,
    ...(before ? [before.folder] : []),
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /invented-product|invented-store|example\.invalid|local-only|supa-m5-hardlink-/)
  return r
}

async function unchanged(...inputs) {
  for (const f of inputs) {
    assert.equal(await readFile(f.manifest, 'utf8'), f.body)
    assert.equal(await readFile(f.outsideManifest, 'utf8'), f.body)
    assert.equal(await readFile(f.outerHtml, 'utf8'), HTML)
    if (f.mode !== 'failed') assert.equal(await readFile(f.html, 'utf8'), HTML)
    if (f.mode === 'manifest-hardlink') assert.equal((await lstat(f.manifest)).nlink, 2)
    if (f.mode === 'html-hardlink') assert.equal((await lstat(f.html)).nlink, 2)
  }
}
function refused(r) {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}
function manual(r, status, priority) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const q = JSON.parse(r.stdout)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].status, status)
  assert.equal(q.actions[0].priority, priority)
  assert.equal(q.productionReady, false)
  assert.equal(q.m5Eligible, false)
  assert.equal(q.selectorVerified, false)
  assert.equal(q.rightsVerified, false)
}

test('product: standalone SHA-valid HTML and manifest retain private P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const f = await fixture(root, 'now', 'regular')
    manual(run(f), 'baseline_missing', 'P2')
    await unchanged(f)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: genuine unavailable source still needs no HTML and is P1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const f = await fixture(root, 'now', 'failed')
    manual(run(f), 'unavailable', 'P1')
    await unchanged(f)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: SHA-identical hardlinked HTML file cannot masquerade as captured source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const f = await fixture(root, 'now', 'html-hardlink')
    refused(run(f))
    await unchanged(f)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: multiply-linked M1 manifest cannot establish source provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const f = await fixture(root, 'now', 'manifest-hardlink')
    refused(run(f))
    await unchanged(f)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: hardlinked historical HTML invalidates the whole reviewer comparison', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const now = await fixture(root, 'now', 'regular')
    const before = await fixture(root, 'before', 'html-hardlink', '2026-10-12T12:00:00.000Z')
    refused(run(now, before))
    await unchanged(now, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: separate normal historical HTML remains private P3 with no rights', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-hardlink-'))
  try {
    const now = await fixture(root, 'now', 'regular')
    const before = await fixture(root, 'before', 'regular', '2026-10-12T12:00:00.000Z')
    manual(run(now, before), 'unchanged', 'P3')
    await unchanged(now, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
