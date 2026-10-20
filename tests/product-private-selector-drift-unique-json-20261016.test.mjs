import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { main } from '../scripts/retailer-private-selector-drift.mjs'

const html = '<article class="product-card"><span class="price-value">not-real</span></article>'
function saved(when) {
  return proposeOfflineRetailerSelectors({
    html,
    origin: {
      retailerId: 'plus',
      url: 'https://www.plus.nl/producten',
      capturedAt: when,
    },
  })
}
const refusal = /Private selector drift comparison refused/
async function withPrivateFiles(fn) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-unique-selector-archive-'))
  try {
    const before = join(folder, 'before.json')
    const after = join(folder, 'after.json')
    const original = JSON.stringify(saved('2024-02-29T10:00:00Z'))
    const latest = JSON.stringify(saved('2026-10-14T10:00:00Z'))
    await writeFile(before, original, { mode: 0o600 })
    await writeFile(after, latest, { mode: 0o600 })
    return await fn({ before, after, original, latest })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

test('private selector CLI rejects duplicate top-level review flags even when last value looks valid', () =>
  withPrivateFiles(async ({ before, after, latest }) => {
    for (const injection of [
      '"mode":"offline-selector-proposals-only",',
      '"permissionVerified":false,',
      '"publicSavingsClaimEligible":false,',
    ]) {
      const altered = latest.replace('{', '{' + injection)
      await writeFile(after, altered, { mode: 0o600 })
      let output = ''
      await assert.rejects(main(['--before', before, '--after', after], x => { output += x }), refusal)
      assert.equal(output, '')
    }
  }))

test('duplicate nested retailer/timestamp and selector identities cannot masquerade as reviewed source', () =>
  withPrivateFiles(async ({ before, after, latest }) => {
    const one = saved('2026-10-14T10:00:00Z')
    const selector = one.selectors[0]
    assert.ok(selector)
    const cases = [
      latest.replace('"source":{', '"source":{"retailerId":"plus",'),
      latest.replace('"source":{', '"source":{"capturedAt":"2026-10-14T10:00:00Z",'),
      latest.replace('"structuredSignals":{', '"structuredSignals":{"jsonLd":false,'),
      latest.replace('"selectors":[{', '"selectors":[{"field":"' + selector.field + '",'),
      latest.replace('"source":{', '"source":{"\\u0072etailerId":"plus",'),
    ]
    for (const raw of cases) {
      await writeFile(after, raw, { mode: 0o600 })
      let output = ''
      await assert.rejects(main(['--before', before, '--after', after], x => { output += x }), refusal)
      assert.equal(output, '')
    }
  }))

test('malformed UTF-8 private archives refuse before any aggregate output', () =>
  withPrivateFiles(async ({ before, after, latest }) => {
    const original = Buffer.from(latest, 'utf8')
    const position = original.indexOf(Buffer.from('plus', 'utf8'))
    assert.ok(position > 0)
    const corrupted = Buffer.concat([original.subarray(0, position + 2),
      Buffer.from([0xff]), original.subarray(position + 2)])
    await writeFile(after, corrupted, { mode: 0o600 })
    let output = ''
    await assert.rejects(main(['--before', before, '--after', after], x => { output += x }), refusal)
    assert.equal(output, '')
  }))

test('ordinary pretty-printed private 0600 JSON remains valid, aggregate-only and rights off', () =>
  withPrivateFiles(async ({ before, after }) => {
    await writeFile(before, JSON.stringify(saved('2024-02-29T10:00:00Z'), null, 2) + '\n', { mode: 0o600 })
    await writeFile(after, JSON.stringify(saved('2026-10-14T10:00:00Z'), null, 2) + '\n', { mode: 0o600 })
    let output = ''
    const report = await main(['--before', before, '--after', after], x => { output += x })
    assert.equal(report.mode, 'private-offline-selector-drift-alert')
    assert.equal(report.externalRequests, 0)
    assert.equal(report.automatedSelectorPromotion, false)
    assert.equal(report.permissionVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.productionEnabled, false)
    assert.deepEqual(JSON.parse(output), report)
    assert.doesNotMatch(output, /plus\.nl|sha256|capturedAt|price-value|not-real/)
  }))
