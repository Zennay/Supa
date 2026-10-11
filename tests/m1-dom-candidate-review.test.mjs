import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  reviewDomProbe, saveDomCandidateReview, main,
} from '../scripts/m1-dom-candidate-review.mjs'
import { RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-halvarine')
const nowMs = Date.parse('2026-10-11T00:00:00.000Z')
const timestamp = new Date(nowMs - 60_000).toISOString()
const secret = 'PRIVATE-NO-EXPORT-PRICE-1999'

function probe(overrides = {}) {
  return {
    version: 1,
    kind: 'rendered-dom-candidate-only',
    originHost: new URL(source.url).hostname,
    capturedAt: timestamp,
    selectors: [
      { role: 'product-name', selector: 'h1', count: 1,
        groundedInCurrentDom: true, semanticVerified: false },
      { role: 'price', selector: '[class*="price" i]', count: 3,
        groundedInCurrentDom: true, semanticVerified: false },
    ],
    actualClassCandidates: [
      { selector: 'span.price-main', observedNodes: 3, semanticVerified: false },
    ],
    note: 'Browser DOM structure only. No product prices.',
    ...overrides,
  }
}

test('all five registered store probes use fixed hosts and stay unverified', () => {
  for (const s of RESEARCH_SOURCES) {
    const result = reviewDomProbe(probe({ originHost: new URL(s.url).hostname }),
      { sourceId: s.id, nowMs })
    assert.equal(result.sourceId, s.id)
    assert.equal(result.selectors[0].selector, 'h1')
    assert.equal(result.selectors[0].semanticVerified, false)
    assert.equal(result.retailerPermissionVerified, false)
    assert.equal(result.livePriceVerified, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.domCaptureIdentityVerified, false)
  }
})

test('candidate sanitizer returns only fixed structural selector vocabulary', () => {
  const value = reviewDomProbe(probe(), { sourceId: source.id, nowMs })
  assert.equal(value.selectors.length, 2)
  assert.equal(value.actualClassCandidates.length, 1)
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE-NO-EXPORT|source URL|note/)
  assert.equal(value.status, 'human-semantic-review-required')
})

test('malformed source, host and timestamp cannot produce trusted candidates', () => {
  for (const id of ['missing', '../dirk', null]) {
    assert.throws(() => reviewDomProbe(probe(), { sourceId: id, nowMs }), /rejected/)
  }
  for (const candidate of [
    { originHost: 'www.dirk.nl.evil.test' },
    { originHost: 'www.ah.nl' },
    { capturedAt: '2099-01-01T00:00:00.000Z' },
    { capturedAt: '2026-10-09T23:59:59.999Z' },
    { capturedAt: '2026-10-11T00:00:00Z' },
  ]) {
    assert.throws(() => reviewDomProbe(probe(candidate), { sourceId: source.id, nowMs }), /rejected/)
  }
})

test('rejects forged semantic verification, extra price data and own getters', () => {
  const forged = probe()
  forged.selectors[0] = { ...forged.selectors[0], semanticVerified: true }
  assert.throws(() => reviewDomProbe(forged, { sourceId: source.id, nowMs }), /rejected/)
  const withRawPrice = probe()
  withRawPrice.selectors[0] = { ...withRawPrice.selectors[0], rawPrice: secret }
  assert.throws(() => reviewDomProbe(withRawPrice, { sourceId: source.id, nowMs }), /rejected/)
  const metadataGetter = probe()
  Object.defineProperty(metadataGetter, 'selectors', {
    get() { throw Error(secret) },
    enumerable: true,
  })
  assert.throws(() => reviewDomProbe(metadataGetter, { sourceId: source.id, nowMs }), /rejected/)
})

test('rejects hostile selector strings, collisions, illegal counts and excessive arrays', () => {
  const good = probe()
  for (const first of [
    { role: 'price', selector: 'a[href^="javascript:"]', count: 1,
      groundedInCurrentDom: true, semanticVerified: false },
    { role: 'price', selector: 'h1', count: 1,
      groundedInCurrentDom: true, semanticVerified: false },
    { ...good.selectors[0], count: -1 },
    { ...good.selectors[0], count: 10_000_000 },
    { ...good.selectors[0], groundedInCurrentDom: false },
  ]) {
    assert.throws(() => reviewDomProbe(probe({ selectors: [first] }),
      { sourceId: source.id, nowMs }), /rejected/)
  }
  assert.throws(() => reviewDomProbe(probe({
    selectors: [good.selectors[0], good.selectors[0]],
  }), { sourceId: source.id, nowMs }), /rejected/)
  assert.throws(() => reviewDomProbe(probe({
    actualClassCandidates: [{ selector: 'span.price-main] > #checkout', observedNodes: 1, semanticVerified: false }],
  }), { sourceId: source.id, nowMs }), /rejected/)
  assert.throws(() => reviewDomProbe(probe({
    actualClassCandidates: Array(26).fill(good.actualClassCandidates[0]),
  }), { sourceId: source.id, nowMs }), /rejected/)
  assert.throws(() => reviewDomProbe(probe({
    selectors: Array(12).fill(good.selectors[0]),
  }), { sourceId: source.id, nowMs }), /rejected/)
})

test('revoked Proxy and non-plain report cannot invoke untrusted toString', () => {
  const { proxy, revoke } = Proxy.revocable(probe(), {})
  revoke()
  assert.throws(() => reviewDomProbe(proxy, { sourceId: source.id, nowMs }), /rejected/)
  assert.throws(() => reviewDomProbe(new Date(), { sourceId: source.id, nowMs }), /rejected/)
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-dom-'))
  const captureDir = join(root, 'captures')
  const outputDir = join(root, 'review')
  const dir = join(captureDir, source.id)
  const stem = 'capture-' + (nowMs - 60_000) + '-1234'
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const body = Buffer.from('<!doctype html><h1>' + secret + '</h1>')
  const metadata = {
    version: 1, type: 'research-only-not-price-proof',
    sourceId: source.id, store: source.store, url: source.url,
    observedAt: timestamp, httpStatus: 200, mediaType: 'text/html',
    bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'),
    proxyMode: 'direct',
  }
  await writeFile(join(dir, stem + '.html'), body, { mode: 0o600 })
  await writeFile(join(dir, stem + '.json'), JSON.stringify(metadata), { mode: 0o600 })
  const probePath = join(root, 'dom-probe.json')
  await writeFile(probePath, JSON.stringify(probe({ note: secret })))
  return { root, captureDir, outputDir, dir, stem, probePath }
}

test('offline integration audits existing private HTML and writes owner-only review without raw data', async () => {
  const f = await fixture()
  try {
    const result = await saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    })
    assert.equal(result.status, 'human-semantic-review-required')
    assert.equal(result.structuralCandidates, 2)
    assert.equal(result.classCandidates, 1)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-NO-EXPORT|price-main|\.html|www\.dirk/)
    const outputPath = join(f.outputDir, source.id, f.stem + '-candidate-review.json')
    const onDisk = await readFile(outputPath, 'utf8')
    const json = JSON.parse(onDisk)
    assert.equal(json.captureStem, f.stem)
    assert.equal(json.captureAuditStatus, 'manual-review')
    assert.equal(json.domCaptureIdentityVerified, false)
    assert.doesNotMatch(onDisk, /PRIVATE-NO-EXPORT-PRICE-1999|<h1>/)
    assert.equal((await lstat(outputPath)).mode & 0o777, 0o600)
    assert.equal((await lstat(join(f.outputDir, source.id))).mode & 0o777, 0o700)
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    }), /EEXIST/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('no review survives tampered captures, stale evidence or symlinked probe', async () => {
  const f = await fixture()
  try {
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs: nowMs + 86_400_001,
    }), /rejected/)
    await writeFile(join(f.dir, f.stem + '.html'), 'changed')
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    }), /rejected/)
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: '../secret', probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    }), /rejected/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('probe file symlinks and private output directory symlinks fail closed', async () => {
  const f = await fixture()
  try {
    const fake = join(f.root, 'probe-link.json')
    await symlink(f.probePath, fake)
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: fake,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    }), /rejected/)
    await symlink(f.dir, f.outputDir)
    await assert.rejects(saveDomCandidateReview({
      sourceId: source.id, stem: f.stem, probePath: f.probePath,
      captureDir: f.captureDir, outputDir: f.outputDir, nowMs,
    }), /rejected/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('CLI rejects missing arguments without attempting a network operation', async () => {
  await assert.rejects(main([], () => {}), /usage/)
})
