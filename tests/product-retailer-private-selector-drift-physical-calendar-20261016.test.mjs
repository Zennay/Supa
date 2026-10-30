import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { compareOfflineSelectorProposals, main } from '../scripts/retailer-private-selector-drift.mjs'

// Historical reviewed-proposal shaped evidence, never live retail data.
// All modifications here are in-memory archive counterfactuals.
const html = '<article class="product-card"><span class="price-value">dummy</span></article>'
const source = (id, time) => proposeOfflineRetailerSelectors({
  html,
  origin: {
    retailerId: id,
    url: id === 'plus' ? 'https://www.plus.nl/producten' : 'https://www.dekamarkt.nl/producten',
    capturedAt: time,
  },
})
const rewriteDate = (record, capturedAt) => ({
  ...record, source: { ...record.source, capturedAt },
})
const before = '2024-02-29T10:00:00Z'
const after = '2026-10-14T10:00:00Z'
const impossible = [
  '2026-02-30T10:00:00Z',
  '2025-02-29T10:00:00.000Z',
  '1900-02-29T10:00:00.1Z',
  '2026-04-31T10:00:00.12Z',
  '2026-10-14T24:00:00Z',
  '2026-10-14T10:60:00Z',
  '2026-10-14T10:00:60Z',
]

test('no impossible capturedAt accepted as archived baseline or subsequent retailer drift', () => {
  for (const id of ['plus', 'dekamarkt']) {
    const a = source(id, before)
    const b = source(id, after)
    for (const bad of impossible) {
      assert.throws(
        () => compareOfflineSelectorProposals(rewriteDate(a, bad), b),
        /Private selector drift comparison refused/,
        id + ' invalid source baseline: ' + bad,
      )
      assert.throws(
        () => compareOfflineSelectorProposals(a, rewriteDate(b, bad)),
        /Private selector drift comparison refused/,
        id + ' invalid next archive: ' + bad,
      )
    }
  }
})

test('true leap-century dates and physically valid 0-3 UTC fractions stay review-only', () => {
  for (const id of ['plus', 'dekamarkt']) {
    const a = source(id, '2000-02-29T10:00:00Z')
    const b = source(id, '2024-02-29T10:00:00.1Z')
    const c = source(id, '2024-02-29T10:00:00.12Z')
    const d = source(id, '2024-02-29T10:00:00.123Z')
    for (const [older, newer] of [[a, b], [b, c], [c, d]]) {
      const report = compareOfflineSelectorProposals(older, newer)
      assert.equal(report.mode, 'private-offline-selector-drift-alert')
      assert.equal(report.permissionVerified, false)
      assert.equal(report.productionEnabled, false)
      assert.equal(report.automatedSelectorPromotion, false)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(report.externalRequests, 0)
      assert.equal(report.htmlBytesDiffer, false)
      assert.equal(report.newSelectorCandidates, 0)
    }
  }
})

test('physically reversed archives and future-dated candidates still refuse', () => {
  const a = source('plus', '2024-02-29T10:00:00.123Z')
  const b = source('plus', '2024-02-29T10:00:00.12Z')
  assert.throws(() => compareOfflineSelectorProposals(a, b), /refused/)
  assert.throws(() => compareOfflineSelectorProposals(
    a,
    rewriteDate(source('plus', after), '2999-10-14T10:00:00Z'),
  ), /refused/)
})

test('private 0600 JSON file comparison refuses false civil capture and emits nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-drift-physical-dates-'))
  try {
    const p1 = join(root, 'baseline.json')
    const p2 = join(root, 'current.json')
    const original = source('plus', before)
    const current = source('plus', after)
    await writeFile(p1, JSON.stringify(original), { mode: 0o600 })
    await writeFile(p2, JSON.stringify(rewriteDate(current, impossible[0])), { mode: 0o600 })
    let printed = ''
    await assert.rejects(
      main(['--before', p1, '--after', p2], x => { printed += x }),
      /Private selector drift comparison refused/,
    )
    assert.equal(printed, '')
    await writeFile(p2, JSON.stringify(current), { mode: 0o600 })
    const report = await main(['--before', p1, '--after', p2], x => { printed += x })
    assert.equal(report.mode, 'private-offline-selector-drift-alert')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.doesNotMatch(printed, /capturedAt|www\.plus\.nl|sha256|product-card|dummy/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
