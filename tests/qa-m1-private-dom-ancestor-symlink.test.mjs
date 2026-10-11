import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveDomCandidateReview } from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:22:00.000Z')
const observedAt = new Date(nowMs - 30_000).toISOString()
const stem = 'capture-' + (nowMs - 30_000) + '-83'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-dom-ancestor-'))
  const captureDir = join(root, 'capture')
  const sourceDir = join(captureDir, source.id)
  await mkdir(sourceDir, { recursive: true, mode: 0o700 })
  const html = Buffer.from('<html><h1>controlled local QA-only DOM</h1></html>')
  await writeFile(join(sourceDir, stem + '.html'), html, { mode: 0o600 })
  await writeFile(join(sourceDir, stem + '.json'), JSON.stringify({
    version: 1, type: 'research-only-not-price-proof', sourceId: source.id,
    store: source.store, url: source.url, observedAt, httpStatus: 200,
    mediaType: 'text/html', bytes: html.length,
    sha256: createHash('sha256').update(html).digest('hex'), proxyMode: 'direct',
  }), { mode: 0o600 })
  const probePath = join(root, 'dom.json')
  await writeFile(probePath, JSON.stringify({
    version: 1, kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname, capturedAt: observedAt,
    selectors: [{ role: 'product-name', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false }],
    actualClassCandidates: [],
  }), { mode: 0o600 })
  const options = { sourceId: source.id, stem, probePath, captureDir, nowMs }
  return { root, options }
}

async function noPath(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}

test('real private nested output directories remain usable and produce 0600 no-clobber reviews', async () => {
  const f = await fixture()
  try {
    const outputDir = join(f.root, 'private-new', 'reviews')
    const result = await saveDomCandidateReview({ ...f.options, outputDir })
    assert.equal(result.status, 'human-semantic-review-required')
    const saved = join(outputDir, source.id, stem + '-candidate-review.json')
    const meta = await lstat(saved)
    assert.equal(meta.mode & 0o777, 0o600)
    assert.equal((await lstat(outputDir)).mode & 0o777, 0o700)
    assert.equal((await lstat(join(outputDir, source.id))).mode & 0o777, 0o700)
    assert.equal(JSON.parse(await readFile(saved, 'utf8')).publicSavingsClaimEligible, false)
    await assert.rejects(saveDomCandidateReview({ ...f.options, outputDir }), { code: 'EEXIST' })
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('a symlink in a missing nested private output parent must reject before creating directories elsewhere', async () => {
  const f = await fixture()
  try {
    const external = join(f.root, 'external-private')
    const alias = join(f.root, 'alias')
    await mkdir(external, { mode: 0o700 })
    await symlink(external, alias)
    await assert.rejects(saveDomCandidateReview({
      ...f.options, outputDir: join(alias, 'review', 'nested'),
    }), /rejected/)
    await noPath(join(external, 'review'))
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('an existing 0700 target behind an ancestor symlink must still refuse private writes', async () => {
  const f = await fixture()
  try {
    const external = join(f.root, 'outside')
    const nested = join(external, 'reviews')
    const alias = join(f.root, 'private-link')
    await mkdir(nested, { recursive: true, mode: 0o700 })
    await symlink(external, alias)
    await assert.rejects(saveDomCandidateReview({
      ...f.options, outputDir: join(alias, 'reviews'),
    }), /rejected/)
    await noPath(join(nested, source.id))
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('deep symlinked ancestor under a real private directory cannot silently redirect output', async () => {
  const f = await fixture()
  try {
    const intermediate = join(f.root, 'safe-real')
    const outside = join(f.root, 'outside')
    await mkdir(intermediate, { mode: 0o700 })
    await mkdir(outside, { mode: 0o700 })
    await symlink(outside, join(intermediate, 'alias'))
    await assert.rejects(saveDomCandidateReview({
      ...f.options, outputDir: join(intermediate, 'alias', 'reviews'),
    }), /rejected/)
    await noPath(join(outside, 'reviews'))
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
