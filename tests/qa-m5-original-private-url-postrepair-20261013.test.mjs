import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assessRetailerResearch } from '../scripts/m5-assess-retailer-research.mjs'

const DISCOVERY = JSON.parse(await readFile(new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const SCRIPT = new URL('../scripts/m5-assess-retailer-research.mjs', import.meta.url).pathname
const clone = value => structuredClone(value)
const PRIVATE_LITERAL_EXAMPLES = [
  ['official source loopback', 'sourceUrl', 'https://127.0.0.1/fictional-feed'],
  ['official source RFC1918', 'sourceUrl', 'https://10.0.0.7/fictional-feed'],
  ['terms RFC1918', 'termsUrl', 'https://192.168.1.10/terms'],
  ['claimed rights evidence link-local', 'rightsEvidenceUrl', 'https://169.254.169.254/metadata'],
]

function fictionalLedger() {
  return {
    version: 1,
    purpose: 'manual-research-only',
    reviews: [{
      retailerId: 'plus',
      reviewedAt: '2026-10-13',
      sourceKind: 'official-feed',
      sourceUrl: 'https://example.invalid/fictional-public-feed',
      termsUrl: 'https://example.invalid/fictional-terms',
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
    }],
  }
}
function reportIsOnlyResearch(report) {
  assert.equal(report.reviewedCount, 1)
  assert.equal(report.m5Eligible, false)
  assert.equal(report.productionReady, false)
  const selected = report.retailers.find(x => x.id === 'plus')
  assert.equal(selected.rightsVerified, false)
  assert.equal(selected.productionEnabled, false)
  assert.equal(selected.sourceEvidenceProvided, true)
  assert.doesNotMatch(JSON.stringify(report), /https:\/\//)
}

async function withLocalLedger(ledger, run) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m5-private-ip-qa-'))
  try {
    const input = join(directory, 'private-ledger.json')
    const source = JSON.stringify(ledger, null, 2)
    await writeFile(input, source, { mode: 0o600 })
    await run(input)
    assert.equal(await readFile(input, 'utf8'), source, 'private source must remain immutable')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
function invoke(file) {
  return spawnSync(process.execPath, [SCRIPT, file], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15000,
  })
}

test('M5 QA normal HTTPS manual source remains evidence-unverified and output omits supplied URLs', () => {
  const ledger = fictionalLedger()
  const original = JSON.stringify(ledger)
  reportIsOnlyResearch(assessRetailerResearch(clone(DISCOVERY), ledger))
  assert.equal(JSON.stringify(ledger), original)
})

test('M5 QA normal manual-source record is read via actual CLI with private 0600 input and no URL echo', async () => {
  await withLocalLedger(fictionalLedger(), async (input) => {
    const result = invoke(input)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    reportIsOnlyResearch(JSON.parse(result.stdout))
  })
})

for (const [label, field, value] of PRIVATE_LITERAL_EXAMPLES) {
  test(`M5 QA expected RED: refuse ${label} private-network literal evidence`, () => {
    const ledger = fictionalLedger()
    const record = ledger.reviews[0]
    if (field === 'rightsEvidenceUrl') record.rightsState = 'claimed-written-permission'
    record[field] = value
    const original = JSON.stringify(ledger)
    assert.throws(() => assessRetailerResearch(clone(DISCOVERY), ledger),
      /url|private|local|loopback|network|evidence|host|invalid/i,
      'private/loopback/link-local addresses are not public retailer source proof')
    assert.equal(JSON.stringify(ledger), original, 'bad evidence must remain unmodified')
  })
}

test('M5 QA expected RED: real CLI refuses loopback source URL without publishing report or private diagnostics', async () => {
  const ledger = fictionalLedger()
  ledger.reviews[0].sourceUrl = 'https://127.0.0.1/fictional-feed'
  await withLocalLedger(ledger, async (input) => {
    const result = invoke(input)
    assert.equal(result.status, 2, 'loopback-source research evidence must fail closed')
    assert.equal(result.stdout, '', 'never print a misleading reviewed-source completeness report')
    assert.match(result.stderr, /Offline M5 research assessment rejected the supplied file/)
    assert.doesNotMatch(result.stderr, /127\.0\.0\.1|supa-m5-private-ip-qa|private-ledger\.json/)
  })
})
