import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Controlled product-side proof of pre-manifest alias refusal. Original
// independent #2168 QA remains unmodified. All files are fictional and local.
const html = '<!doctype html><body>fictitious source</body>'
const hash = createHash('sha256').update(html).digest('hex')
const manifest = (capturedAt) => JSON.stringify({
  milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
  results: [{
    id: 'invented', supermarket: 'invented-shop', kind: 'product',
    requestedUrl: 'https://example.invalid/private',
    capturedAt, sha256: hash, success: true,
  }],
})

async function canonical(folder, capturedAt = '2026-10-13T12:00:00.000Z') {
  await mkdir(join(folder, 'invented-shop'), { recursive: true })
  await writeFile(join(folder, 'invented-shop', 'invented.html'), html)
  const data = manifest(capturedAt)
  await writeFile(join(folder, 'manifest.json'), data)
  return data
}

test('product: regular capture root with valid manifest still gives manual P2 only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-pre-manifest-'))
  try {
    const folder = join(root, 'capture')
    const data = await canonical(folder)
    const report = await compareCaptureDirectories(folder)
    assert.equal(report.changes[0].status, 'baseline_missing')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(await readFile(join(folder, 'manifest.json'), 'utf8'), data)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: symlink root must be denied before parsing intentionally invalid borrowed manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-pre-manifest-'))
  try {
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    await mkdir(real)
    await writeFile(join(real, 'manifest.json'), '{invalid JSON private source}')
    await symlink(real, alias, 'dir')
    await assert.rejects(() => compareCaptureDirectories(alias),
      /^Error: Invalid offline capture tree origin$/)
    assert.equal(await readFile(join(real, 'manifest.json'), 'utf8'),
      '{invalid JSON private source}')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: symlink ancestor must be refused before manifest parsing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-pre-manifest-'))
  try {
    const realParent = join(root, 'actual')
    const real = join(realParent, 'capture')
    const aliasParent = join(root, 'alias-parent')
    await mkdir(real, { recursive: true })
    await writeFile(join(real, 'manifest.json'), 'not JSON and must not be parsed')
    await symlink(realParent, aliasParent, 'dir')
    await assert.rejects(() => compareCaptureDirectories(join(aliasParent, 'capture')),
      /^Error: Invalid offline capture tree origin$/)
    assert.equal(await readFile(join(real, 'manifest.json'), 'utf8'),
      'not JSON and must not be parsed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: historical symlink root is rejected before either manifest is opened', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-pre-manifest-'))
  try {
    const now = join(root, 'current')
    const historical = join(root, 'historical')
    const alias = join(root, 'historical-alias')
    await mkdir(now)
    await mkdir(historical)
    await writeFile(join(now, 'manifest.json'), 'invalid current manifest')
    await writeFile(join(historical, 'manifest.json'), 'invalid historical manifest')
    await symlink(historical, alias, 'dir')
    await assert.rejects(() => compareCaptureDirectories(now, alias),
      /^Error: Invalid offline capture tree origin$/)
    assert.equal(await readFile(join(now, 'manifest.json'), 'utf8'),
      'invalid current manifest')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: distinct regular current/history roots remain valid manual P3', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-pre-manifest-'))
  try {
    const now = join(root, 'current')
    const older = join(root, 'older')
    await canonical(now)
    await canonical(older, '2026-10-12T12:00:00.000Z')
    const report = await compareCaptureDirectories(now, older)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
