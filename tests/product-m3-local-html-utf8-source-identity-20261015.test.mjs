import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

const when = '2026-10-15T10:00:00Z'
const now = Date.parse('2026-10-15T11:00:00Z')
const html = (name = 'Fictional milk') => '<!doctype html><script type="application/ld+json">' +
  JSON.stringify({ '@type': 'Product', sku: 'fictional-milk', name,
    weight: { value: '1000 ml' }, offers: { '@type': 'Offer', price: '1.29',
      priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } }) +
  '</script>'

async function make(t, plusBytes, dekaBytes) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-product-raw-sha-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'plus.html'), plusBytes)
  await writeFile(join(dir, 'deka.html'), dekaBytes)
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ version: 1,
    requirements: [{ id: 'milk', query: 'Fictional milk', amount: 1000, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt: when },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt: when },
    ],
  }))
  return manifest
}

const base = Buffer.from(html(), 'utf8')
const noProduct = Buffer.from('<html>Fictional local fixture only</html>', 'utf8')
for (const malformed of [
  [0xff], [0xfe], [0x80], [0xe2, 0x82], [0xc0, 0xaf], [0xed, 0xa0, 0x80],
]) {
  for (const slot of [0, 1]) {
    test('M3 refuses lossy UTF-8 bytes ' + malformed.join('-') + ' in slot ' + slot, async t => {
      const bad = Buffer.concat([base, Buffer.from(malformed)])
      const path = await make(t, slot === 0 ? bad : noProduct, slot === 1 ? bad : noProduct)
      await assert.rejects(compareLocalRetailerSnapshots(path, now), /Invalid UTF-8/)
    })
  }
}

for (const [description, bytes] of [
  ['plain ASCII', base],
  ['valid multi-byte emoji', Buffer.from(html('Fictional melk 🥛'), 'utf8')],
  // A strict decoder normally strips UTF-8 BOM unless ignoreBOM is set;
  // losing it would also destroy the raw-file fingerprint's integrity.
  ['UTF-8 BOM + multi-byte', Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(html('Fictional melk 🥛')),
  ])],
]) {
  test('M3 preserves exact raw SHA-256 for ' + description, async t => {
    const path = await make(t, bytes, noProduct)
    const result = await compareLocalRetailerSnapshots(path, now)
    assert.equal(result.captureSummary[0].sha256,
      createHash('sha256').update(bytes).digest('hex'))
    assert.equal(result.captureSummary[1].sha256,
      createHash('sha256').update(noProduct).digest('hex'))
    assert.equal(result.comparison.claimable, false)
    assert.equal(result.comparison.savingsCents, null)
  })
}
