import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, mkdtemp, rm, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { assessRetailerResearch, loadPrivateRetailerResearch, parseResearchArgs } from '../scripts/m5-assess-retailer-research.mjs'

const durl = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const original = JSON.parse(await readFile(durl, 'utf8'))
const discovery = () => structuredClone(original)
const empty = () => ({ version: 1, purpose: 'manual-research-only', reviews: [] })
const record = (overrides = {}) => ({
  retailerId: 'plus',
  reviewedAt: '2026-10-13',
  sourceKind: 'unassessed',
  sourceUrl: null,
  termsUrl: null,
  robotsUrl: null,
  rightsState: 'unknown',
  rightsEvidenceUrl: null,
  regionScope: 'unknown',
  assortmentScope: 'unknown',
  termsReview: 'unreviewed',
  robotsReview: 'unreviewed',
  ownerContactStatus: 'unassessed',
  freshnessPlan: 'unassessed',
  priority: 'unprioritized',
  ...overrides,
})

test('Empty private ledger never implies any approvals for 17 candidates', () => {
  const report = assessRetailerResearch(discovery(), empty())
  assert.equal(report.reviewedCount, 0)
  assert.equal(report.missingCount, 17)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  assert.ok(report.retailers.every((r) =>
    !r.productionEnabled && !r.rightsVerified && r.rightsState === 'unknown'))
})

test('Human-researched source metadata is not a legal permission or production enablement', () => {
  const ledger = empty()
  ledger.reviews.push(record({
    sourceKind: 'official-feed', sourceUrl: 'https://example.invalid/public/feed',
    termsUrl: 'https://example.invalid/terms',
    robotsUrl: 'https://example.invalid/robots.txt',
    rightsState: 'claimed-written-permission',
    rightsEvidenceUrl: 'https://example.invalid/permission-evidence',
    regionScope: 'regional', assortmentScope: 'products-and-offers',
    termsReview: 'allowance-claimed', robotsReview: 'allowance-claimed',
    ownerContactStatus: 'reply-recorded', freshnessPlan: 'daily-claimed',
    priority: 'P1',
  }))
  const frozen = structuredClone(ledger)
  const report = assessRetailerResearch(discovery(), ledger)
  const plus = report.retailers.find((item) => item.id === 'plus')
  assert.equal(report.reviewedCount, 1)
  assert.equal(report.missingCount, 16)
  assert.equal(plus.rightsState, 'claimed-written-permission')
  assert.equal(plus.claimedRightsEvidenceProvided, true)
  assert.equal(plus.rightsVerified, false)
  assert.equal(plus.termsReview, 'allowance-claimed')
  assert.equal(plus.robotsReview, 'allowance-claimed')
  assert.equal(plus.freshnessPlan, 'daily-claimed')
  assert.equal(plus.priority, 'P1')
  assert.equal(plus.productionEnabled, false)
  assert.equal(report.productionReady, false)
  assert.deepEqual(ledger, frozen, 'review data mutated')
  assert.ok(!JSON.stringify(report).includes('example.invalid'), 'private URLs leaked')
})

test('Duplicate, phantom and inconsistent claims fail closed', () => {
  const changes = [
    (r) => { r.reviews.push(record()); r.reviews.push(record()) },
    (r) => { r.reviews.push(record({ retailerId: 'phantom' })) },
    (r) => { r.reviews.push(record({ reviewedAt: '2999-01-01' })) },
    (r) => { r.reviews.push(record({ reviewedAt: '2026-02-30' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'official-api' })) },
    (r) => { r.reviews.push(record({ rightsState: 'claimed-written-permission' })) },
    (r) => { r.reviews.push(record({ rightsState: 'unknown', rightsEvidenceUrl: 'https://example.invalid/secret' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'unassessed', sourceUrl: 'https://example.invalid/feed' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'public-html', sourceUrl: 'http://example.invalid/' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'public-html', sourceUrl: 'https://example.invalid/@user#hash' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'public-html', sourceUrl: 'https://user:pass@example.invalid/a' })) },
    (r) => { r.reviews.push(record({ sourceKind: 'unverified-feed' })) },
    (r) => { r.reviews.push(record({ rightsState: 'permitted' })) },
    (r) => { r.reviews.push(record({ rightsState: 'denied', rightsEvidenceUrl: 'https://example.invalid/' })) },
    (r) => { r.reviews.push(record({ regionScope: 'everywhere' })) },
    (r) => { r.reviews.push(record({ assortmentScope: 'entire-catalog' })) },
    (r) => { r.reviews.push(record({ termsReview: 'licensed' })) },
    (r) => { r.reviews.push(record({ robotsReview: 'scrape-permitted' })) },
    (r) => { r.reviews.push(record({ ownerContactStatus: 'contact@example.invalid' })) },
    (r) => { r.reviews.push(record({ freshnessPlan: 'continuous' })) },
    (r) => { r.reviews.push(record({ priority: 'P0' })) },
    (r) => { r.reviews.push(record({ reviewerName: 'person@example.invalid' })) },
    (r) => { r.reviews.push(record({ sourceUrl: null, comments: 'contact@example.invalid' })) },
    (r) => { r.productionReady = true; r.reviews.push(record()) },
  ]
  for (const mutate of changes) {
    const sample = empty()
    mutate(sample)
    assert.throws(() => assessRetailerResearch(discovery(), sample), undefined, JSON.stringify(sample).slice(0, 120))
  }
})

test('Malformed ledger containers, oversize entries and missing required keys fail closed', () => {
  for (const doc of [null, [], {}, { version: 1, purpose: 'manual-research-only', reviews: null },
    { version: 2, purpose: 'manual-research-only', reviews: [] },
    { version: 1, purpose: 'permission-granted', reviews: [] }]) {
    assert.throws(() => assessRetailerResearch(discovery(), doc))
  }
  const missing = empty()
  const item = record()
  delete item.robotsUrl
  missing.reviews.push(item)
  assert.throws(() => assessRetailerResearch(discovery(), missing))
  const tooLong = empty()
  tooLong.reviews = Array.from({ length: 18 }, (_, i) => record({ retailerId: 'retailer-' + i }))
  assert.throws(() => assessRetailerResearch(discovery(), tooLong))
})

test('private M5 research object schema rejects hidden rights fields and accessors', () => {
  for (const [where, key] of [
    ['root', 'ingestAuthorized'],
    ['root', 'productionReady'],
    ['record', 'licenseApproved'],
    ['record', 'proxyOverridePermitted'],
  ]) {
    const ledger = empty()
    ledger.reviews.push(record())
    const obj = where === 'root' ? ledger : ledger.reviews[0]
    Object.defineProperty(obj, key, { value: true, enumerable: false })
    assert.throws(() => assessRetailerResearch(discovery(), ledger),
      /schema/, where + ' hidden ' + key + ' must fail')
  }
  for (const where of ['root', 'record']) {
    const ledger = empty()
    ledger.reviews.push(record())
    let called = false
    const obj = where === 'root' ? ledger : ledger.reviews[0]
    const key = where === 'root' ? 'purpose' : 'rightsState'
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() { called = true; return 'claimed-written-permission' },
    })
    assert.throws(() => assessRetailerResearch(discovery(), ledger), /schema/)
    assert.equal(called, false, 'untrusted property accessor must not be invoked')
  }
  const tooFew = empty()
  tooFew.reviews.push(record())
  delete tooFew.reviews[0].priority
  assert.throws(() => assessRetailerResearch(discovery(), tooFew), /schema/)
  assert.equal(assessRetailerResearch(discovery(), empty()).productionReady, false)
})

test('CLI requires explicit local file, emits privacy-redacted report and preserves bytes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'supa-m5-review-'))
  try {
    const input = path.join(dir, 'private-review.json')
    const secret = 'https://example.invalid/secret-evidence-keep-private'
    const ledger = empty()
    ledger.reviews = [record({ rightsState: 'claimed-written-permission',
      rightsEvidenceUrl: secret })]
    const content = JSON.stringify(ledger)
    await writeFile(input, content, { mode: 0o600 })
    const script = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url)
    const run = spawnSync(process.execPath, [script.pathname, input], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, '')
    assert.ok(!run.stdout.includes(secret))
    assert.equal(JSON.parse(run.stdout).reviewedCount, 1)
    assert.equal(await readFile(input, 'utf8'), content)
    const invalid = spawnSync(process.execPath, [script.pathname], { encoding: 'utf8' })
    assert.equal(invalid.status, 2)
    assert.equal(invalid.stdout, '')
    assert.match(invalid.stderr, /Offline M5 research assessment rejected/)
    assert.ok(!invalid.stderr.includes(input), 'private path disclosed in diagnostics')
    const bad = path.join(dir, 'fictional.person@example.invalid')
    await writeFile(bad, JSON.stringify({ secret }), { mode: 0o600 })
    const malformed = spawnSync(process.execPath, [script.pathname, bad],
      { encoding: 'utf8' })
    assert.equal(malformed.status, 2)
    assert.equal(malformed.stdout, '')
    assert.ok(!malformed.stderr.includes(secret))
    assert.ok(!malformed.stderr.includes('fictional.person@example.invalid'))
    assert.equal(await readFile(bad, 'utf8'), JSON.stringify({ secret }))

    // A caller's real research file must not be accidentally world-readable,
    // symlink-followed or unlimited in size before private data is parsed.
    const publicCopy = path.join(dir, 'public-review.json')
    await writeFile(publicCopy, content, { mode: 0o644 })
    const world = spawnSync(process.execPath, [script.pathname, publicCopy],
      { encoding: 'utf8' })
    if (process.platform !== 'win32') {
      assert.equal(world.status, 2)
      assert.equal(world.stdout, '')
      assert.ok(!world.stderr.includes(publicCopy))
    }
    const alias = path.join(dir, 'linked-review.json')
    await symlink(input, alias)
    const linked = spawnSync(process.execPath, [script.pathname, alias],
      { encoding: 'utf8' })
    assert.equal(linked.status, 2)
    assert.equal(linked.stdout, '')
    const oversize = path.join(dir, 'oversize-review.json')
    await writeFile(oversize, ' '.repeat(65537), { mode: 0o600 })
    const huge = spawnSync(process.execPath, [script.pathname, oversize],
      { encoding: 'utf8' })
    assert.equal(huge.status, 2)
    assert.equal(huge.stdout, '')
    assert.ok(!huge.stderr.includes(oversize))
    const malformedUtf8 = path.join(dir, 'malformed-utf8.json')
    await writeFile(malformedUtf8, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]),
      { mode: 0o600 })
    const malformedUtf8Result = spawnSync(process.execPath,
      [script.pathname, malformedUtf8], { encoding: 'utf8' })
    assert.equal(malformedUtf8Result.status, 2)
    assert.equal(malformedUtf8Result.stdout, '')
    assert.ok(!malformedUtf8Result.stderr.includes(malformedUtf8))
    assert.equal(await readFile(malformedUtf8).then(buf => buf.length), 5)

  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('QA #2102: real private ledger rejects symlinked ancestor and nested alias', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'supa-private-ancestor-'))
  try {
    const real = path.join(dir, 'private')
    const nested = path.join(dir, 'nested')
    await mkdir(real, { mode: 0o700 })
    await mkdir(nested, { mode: 0o700 })
    const source = path.join(real, 'research.json')
    const original = JSON.stringify(empty())
    await writeFile(source, original, { mode: 0o600 })
    const immediateAlias = path.join(dir, 'alias')
    const nestedAlias = path.join(nested, 'alias')
    await symlink(real, immediateAlias, 'dir')
    await symlink(real, nestedAlias, 'dir')
    const script = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url)

    assert.deepEqual(await loadPrivateRetailerResearch(source), empty(),
      'regular private file still works')
    const good = spawnSync(process.execPath, [script.pathname, source], {
      encoding: 'utf8', timeout: 15000,
    })
    assert.equal(good.status, 0, good.stderr)
    assert.equal(JSON.parse(good.stdout).productionReady, false)

    for (const bad of [path.join(immediateAlias, 'research.json'),
      path.join(nestedAlias, 'research.json')]) {
      await assert.rejects(loadPrivateRetailerResearch(bad),
        undefined, 'all directory symlink components must fail closed')
      const command = spawnSync(process.execPath, [script.pathname, bad], {
        encoding: 'utf8', timeout: 15000,
      })
      assert.equal(command.status, 2, command.stderr)
      assert.equal(command.stdout, '', 'no private report on refused source')
      assert.match(command.stderr, /Offline M5 research assessment rejected/)
      assert.ok(!command.stderr.includes(dir), 'private folder path leaked')
    }
    assert.equal(await readFile(source, 'utf8'), original)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('QA #2102: priorities CLI inherits private symlink-ancestor refusal', {
  skip: process.platform === 'win32',
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'supa-m5-priority-alias-'))
  try {
    const actual = path.join(dir, 'actual')
    await mkdir(actual, { mode: 0o700 })
    const name = path.join(actual, 'research.json')
    const original = JSON.stringify(empty())
    await writeFile(name, original, { mode: 0o600 })
    const alias = path.join(dir, 'alias')
    await symlink(actual, alias, 'dir')
    const script = new URL('../scripts/m5-build-retailer-priorities.mjs', import.meta.url)
    const rejected = spawnSync(process.execPath,
      [script.pathname, path.join(alias, 'research.json')],
      { encoding: 'utf8', timeout: 15000 })
    assert.equal(rejected.status, 2)
    assert.equal(rejected.stdout, '')
    assert.doesNotMatch(rejected.stderr, /supa-m5-priority-alias|research\.json/)
    assert.equal(await readFile(name, 'utf8'), original)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('No implicit default reviewer input or unsafe CLI switch', () => {
  assert.equal(parseResearchArgs(['reviews.json']), 'reviews.json')
  for (const args of [[], ['--output=public.json'], ['--format=csv'],
    ['file.json', 'second.json'], ['-'], ['--require-production-ready']]) {
    assert.throws(() => parseResearchArgs(args))
  }
})
