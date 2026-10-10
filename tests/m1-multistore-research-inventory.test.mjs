import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'
import { inventoryResearchSnapshots } from '../scripts/m1-research-snapshot-inventory.mjs'

const nowMs = Date.parse('2026-10-10T23:58:00.000Z')
const html = Buffer.from('<html>private synthetic research, not a retailer observation</html>')
const hash = createHash('sha256').update(html).digest('hex')

async function capture(root, source, stamp, overrides = {}, body = html) {
  const dir = join(root, source.id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const stem = `capture-${stamp}-123`
  const metadata = {
    version: 1, type: 'research-only-not-price-proof', sourceId: source.id,
    store: source.store, url: source.url,
    observedAt: new Date(nowMs - 60_000).toISOString(),
    mediaType: 'text/html', httpStatus: 200, proxyMode: 'direct',
    bytes: html.length, sha256: hash, ...overrides,
  }
  await writeFile(join(dir, stem + '.html'), body)
  await writeFile(join(dir, stem + '.json'), JSON.stringify(metadata))
  return { dir, stem }
}

test('empty or missing capture root remains no-captures, never release-ready', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-empty-'))
  try {
    const missing = await inventoryResearchSnapshots({ outputDir: join(dir, 'missing'), nowMs })
    assert.equal(missing.status, 'no-captures')
    assert.equal(missing.totals.manualReview, 0)
    assert.equal(missing.publicSavingsClaimEligible, false)
    const empty = await inventoryResearchSnapshots({ outputDir: dir, nowMs })
    assert.equal(empty.status, 'no-captures')
    assert.equal(empty.sources.length, RESEARCH_SOURCES.length)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('all five sources can be independently enumerated without leaking HTML, URL or values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-five-'))
  try {
    for (let i = 0; i < RESEARCH_SOURCES.length; i++) {
      await capture(dir, RESEARCH_SOURCES[i], 1791676680000 + i)
    }
    const report = await inventoryResearchSnapshots({ outputDir: dir, nowMs })
    assert.equal(report.status, 'manual-review')
    assert.deepEqual(report.totals, { manualReview: 5, rejected: 0, incomplete: 0, unexpected: 0 })
    assert.equal(report.semanticVerified, false)
    assert.equal(report.livePriceVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(JSON.stringify(report), /private synthetic research|https:\/\/|capture-179|sha256|€/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('stale, mismatched, orphan and unexpected capture names are always rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-negative-'))
  try {
    const [a, b, c, d] = RESEARCH_SOURCES
    await capture(dir, a, 1791676680000)
    await capture(dir, b, 1791676680001, { observedAt: new Date(nowMs - 25 * 3600_000).toISOString() })
    await capture(dir, c, 1791676680002, {}, Buffer.from('<html>modified data</html>'))
    const orphan = await capture(dir, d, 1791676680003)
    await rm(join(orphan.dir, orphan.stem + '.json'))
    await writeFile(join(dir, 'unexpected-secret.txt'), 'do-not-echo')
    await writeFile(join(dir, d.id, 'capture-unregistered-token.html'), 'do-not-echo')
    const report = await inventoryResearchSnapshots({ outputDir: dir, nowMs })
    assert.equal(report.status, 'rejected')
    assert.deepEqual(report.totals, { manualReview: 1, rejected: 2, incomplete: 1, unexpected: 2 })
    assert.doesNotMatch(JSON.stringify(report), /do-not-echo|modified data|unregistered-token|secret\.txt/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('symlinked source directory, symlinked root and nonfile capture are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-symlinks-'))
  try {
    const root = join(dir, 'captures')
    await mkdir(root)
    await symlink(dir, join(root, RESEARCH_SOURCES[0].id))
    let report = await inventoryResearchSnapshots({ outputDir: root, nowMs })
    assert.equal(report.status, 'rejected')
    assert.equal(report.totals.unexpected, 1)
    const linkedRoot = join(dir, 'linked')
    await symlink(root, linkedRoot)
    report = await inventoryResearchSnapshots({ outputDir: linkedRoot, nowMs })
    assert.equal(report.status, 'rejected')
    await rm(join(root, RESEARCH_SOURCES[0].id))
    const pair = await capture(root, RESEARCH_SOURCES[0], 1791676680123)
    await rm(join(pair.dir, pair.stem + '.html'))
    await symlink(join(pair.dir, pair.stem + '.json'), join(pair.dir, pair.stem + '.html'))
    report = await inventoryResearchSnapshots({ outputDir: root, nowMs })
    assert.equal(report.status, 'rejected')
    assert.equal(report.totals.unexpected, 1)
    assert.equal(report.totals.manualReview, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('invalid operator clock fails closed and does not scan private content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-clock-'))
  try {
    await capture(dir, RESEARCH_SOURCES[0], 1791676680345)
    const report = await inventoryResearchSnapshots({ outputDir: dir, nowMs: NaN })
    assert.equal(report.status, 'rejected')
    assert.equal(report.totals.manualReview, 0)
    assert.equal(report.publicSavingsClaimEligible, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('operator CLI distinguishes empty (2), accepted (0), and corrupted (1) without printing private data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-cli-'))
  try {
    const program = resolve('scripts/m1-research-snapshot-inventory.mjs')
    const command = () => spawnSync(process.execPath, [program, '--inventory'],
      { cwd: dir, encoding: 'utf8', timeout: 10_000 })
    const noFiles = command()
    assert.equal(noFiles.status, 2)
    assert.equal(JSON.parse(noFiles.stdout).status, 'no-captures')
    const root = join(dir, 'artifacts', 'm1-multistore-research')
    await capture(root, RESEARCH_SOURCES[0], 1791676680789, {
      observedAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const accepted = command()
    assert.equal(accepted.status, 0)
    assert.equal(JSON.parse(accepted.stdout).totals.manualReview, 1)
    await writeFile(join(root, 'unexpected-private.txt'), 'secret payload should not print')
    const rejected = command()
    assert.equal(rejected.status, 1)
    assert.equal(JSON.parse(rejected.stdout).status, 'rejected')
    assert.doesNotMatch(rejected.stdout, /secret payload|unexpected-private|https:\/\//)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('bounded root enumeration fails closed on an unexpected file flood', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-inventory-root-limit-'))
  try {
    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      writeFile(join(dir, `unregistered-${index}`), 'synthetic')))
    const report = await inventoryResearchSnapshots({ outputDir: dir, nowMs })
    assert.equal(report.status, 'rejected')
    assert.equal(report.totals.manualReview, 0)
    assert.equal(report.totals.unexpected, 101)
    assert.equal(report.publicSavingsClaimEligible, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
