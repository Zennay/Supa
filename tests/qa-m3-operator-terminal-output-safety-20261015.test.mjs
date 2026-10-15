import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'

// QA-only, all invented labels and offline local HTML. A human-readable
// operator terminal must not execute hostile formatting supplied as a
// freeform ingredient query in an otherwise valid local capture manifest.
const fakeRow = () => ({
  status: 'unknown', packs: null, packPriceCents: null,
  totalCents: null, sourceUrl: 'https://www.plus.nl/product/never-output',
})
const report = ingredient => ({
  format: 'supa-local-snapshot-comparison-v1',
  captureSummary: [
    { supermarket: 'plus', parsedProducts: 0 },
    { supermarket: 'dekamarkt', parsedProducts: 0 },
  ],
  comparison: {
    provenance: 'offline-snapshot-preview', claimable: false,
    comparable: false, cheaperStore: null, savingsCents: null,
    stores: {
      plus: { subtotalCents: null, complete: false },
      dekamarkt: { subtotalCents: null, complete: false },
    },
    lines: [{ ingredient, plus: fakeRow(), dekamarkt: fakeRow(),
      differenceCents: null }],
  },
})
const hostile = [
  ['ANSI clear-screen', 'melk\u001b[2J\u001b[1;1HGEVERIFIEERD'],
  ['ANSI color and status disguise', 'melk\u001b[32mLIVE PRIJS'],
  ['terminal backspace', 'melk\b\b\bBESP'],
  ['terminal bell', 'melk\u0007'],
  ['NUL separator', 'melk\u0000'],
  ['DEL and C1', 'melk\u007f\u009b'],
  ['right-to-left override', 'melk\u202e€999 BESPAARD\u202c'],
  ['left-to-right override', 'melk\u202dLIVE WINKEL'],
  ['bidi isolates', 'melk\u2067schijnprijs\u2069'],
  ['Unicode line and paragraph separators', 'melk\u2028GEVERIFIEERD\u2029'],
]
const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

for (const [name, label] of hostile) {
  test('QA M3 operator output neutralises ' + name + ' in freeform demand labels', () => {
    const before = JSON.stringify(report(label))
    const text = renderPrivateComparison(report(label))
    assert.doesNotMatch(text, forbidden)
    assert.match(text, /GEEN LIVE PRIJZEN/)
    assert.match(text, /GEEN VOLLEDIGE MANDVERGELIJKING/)
    assert.doesNotMatch(text, /ALLEEN OFFLINE MANDVERSCHIL/)
    assert.equal(JSON.stringify(report(label)), before, 'formatter must not mutate input')
  })
}

test('QA M3 real local manifest preserves safe terminal output for untrusted ingredient query', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'supa-qa-terminal-safety-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'plus.html'), '<html>Fictional, no quoted prices</html>')
  await writeFile(join(folder, 'deka.html'), '<html>Fictional, no quoted prices</html>')
  const manifest = join(folder, 'manifest.json')
  const at = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  await writeFile(manifest, JSON.stringify({
    version: 1,
    requirements: [{ id: 'fictional', query: 'rijst\u001b[2J\u202e€99\u202c\u2028FAKE LIVE', amount: 1000, unit: 'g' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt: at },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt: at },
    ],
  }))
  const data = await compareLocalRetailerSnapshots(manifest)
  const text = renderPrivateComparison(data)
  assert.doesNotMatch(text, forbidden)
  assert.equal(data.comparison.claimable, false)
  assert.equal(data.comparison.savingsCents, null)
  assert.match(text, /GEEN LIVE PRIJZEN/)
})

test('QA M3 ordinary Dutch ingredient labels, emoji and accents remain readable', () => {
  const text = renderPrivateComparison(report('Crème fraîche 🥛 en courgette'))
  assert.match(text, /Crème fraîche 🥛 en courgette/)
  assert.match(text, /GEEN VOLLEDIGE MANDVERGELIJKING/)
  assert.doesNotMatch(text, forbidden)
})

test('QA M3 ordinary whitespace is still flattened into one safe ingredient line', () => {
  const text = renderPrivateComparison(report('bloemkool\nrijst\tmet\rroom'))
  assert.match(text, /bloemkool rijst met room/)
  assert.doesNotMatch(text, forbidden)
})
