import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderPrintablePrivateShoppingChecklist,
  main,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'

const row = (price, name = 'Fictieve melk') => ({
  status: 'matched', packs: 1, packPriceCents: price, totalCents: price,
  productName: name, productId: name,
  sourceUrl: 'https://example.invalid/private-secret-123',
})
function report() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      stores: { plus: { complete: true, subtotalCents: 129 },
        dekamarkt: { complete: true, subtotalCents: 119 } },
      lines: [{ ingredientId: 'milk', ingredient: 'melk',
        plus: row(129), dekamarkt: row(119) }],
    },
  }
}

test('renders two separate physically-priced printable shopping checklists, without winner', () => {
  const html = renderPrintablePrivateShoppingChecklist(report())
  assert.match(html, /<h2>PLUS<\/h2>/)
  assert.match(html, /<h2>DekaMarkt<\/h2>/)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2)
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
  assert.match(html, /ALLEEN OFFLINE TOTAAL DekaMarkt: €1,19/)
  assert.match(html, /Afvinken wordt niet opgeslagen/)
  assert.match(html, /@media print/)
  assert.match(html, /script-src &#39;none&#39;/)
  assert.doesNotMatch(html, /private-secret-123|goedkoopste winkel|BEWEZEN BESPARING/)
})

test('no-script retailer selection keeps exactly one supermarket visible and printable at a time', () => {
  const html = renderPrintablePrivateShoppingChecklist(report())
  assert.match(html, /<fieldset class="store-filter">/)
  assert.match(html, /id="view-both" checked>Beide winkels/)
  assert.match(html, /id="view-plus">Alleen PLUS/)
  assert.match(html, /id="view-deka">Alleen DekaMarkt/)
  assert.match(html, /class="shop shop-plus"/)
  assert.match(html, /class="shop shop-dekamarkt"/)
  assert.match(html, /body:has\(#view-plus:checked\) \.shop-dekamarkt/)
  assert.match(html, /body:has\(#view-deka:checked\) \.shop-plus/)
  assert.match(html, /@media print\{[^}]*\.store-filter\{display:none\}/)
  assert.equal((html.match(/name="storeView"/g) || []).length, 3)
  assert.equal((html.match(/name="storeView"[^>]*checked/g) || []).length, 1)
  assert.doesNotMatch(html, /<script|onsubmit=|onclick=|localStorage|fetch\(/)
})

test('unknown stock on one shop keeps other shop total but never invents second total', () => {
  const data = report()
  data.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  const html = renderPrintablePrivateShoppingChecklist(data)
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
  assert.match(html, /GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
  assert.match(html, /Controleren/)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1)
  assert.doesNotMatch(html, /ALLEEN OFFLINE TOTAAL DekaMarkt:/)
})

test('shared physical pack is purchased exactly once per store, with coverage noted', () => {
  const data = report()
  for (const shop of ['plus', 'dekamarkt']) {
    data.comparison.lines[0][shop].sharedPackCoversIngredientIds = ['milk', 'more']
  }
  data.comparison.lines.push({
    ingredientId: 'more', ingredient: 'extra melk',
    plus: { ...row(129), packs: 0, totalCents: 0, sharedPackWithIngredientId: 'milk' },
    dekamarkt: { ...row(119), packs: 0, totalCents: 0, sharedPackWithIngredientId: 'milk' },
  })
  const html = renderPrintablePrivateShoppingChecklist(data)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2)
  assert.equal((html.match(/Al gedekt/g) || []).length, 2)
  assert.equal((html.match(/NIET gratis/g) || []).length, 2)
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €1,29/)
})

test('all dynamic text is escaped: no executable markup, label attribute injection or URL leak', () => {
  const data = report()
  const injected = '<img src=x onerror="alert(1)">&" attr="'
  data.comparison.lines[0].plus.productName = injected
  data.comparison.lines[0].plus.productId = 'plus-sku'
  const html = renderPrintablePrivateShoppingChecklist(data)
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&quot; attr=&quot;/)
  assert.doesNotMatch(html, /<img|onerror="|private-secret-123|<script/)
})

test('invalid or claimable direct reports fail without exposing a private HTML page', () => {
  const data = report()
  data.comparison.claimable = true
  assert.throws(() => renderPrintablePrivateShoppingChecklist(data),
    /Invalid or claimable offline shopping checklist input/)
  data.comparison.claimable = false
  data.comparison.lines = []
  assert.throws(() => renderPrintablePrivateShoppingChecklist(data))
})

const offlineHtml = price =>
  '<html><script type="application/ld+json">' + JSON.stringify({
    '@type': 'Product', sku: 'fictional-milk', name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price, priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }) + '</script></html>'

test('real local fixture -> comparator -> printable HTML on disk with private 0600 permissions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-private-print-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'plus.html'), offlineHtml('1.29'))
  await writeFile(join(dir, 'deka.html'), offlineHtml('1.19'))
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, JSON.stringify({
    version: 1, requirements: [
      { id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' },
    ],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html',
        capturedAt: new Date().toISOString() },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html',
        capturedAt: new Date().toISOString() },
    ],
  }))
  const output = join(dir, 'private.html')
  await main([manifest, '--output', output])
  const html = await readFile(output, 'utf8')
  assert.match(html, /2 hele verpakking/)
  assert.match(html, /€2,58/)
  assert.match(html, /€2,38/)
  assert.match(html, /Halfvolle melk/)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  assert.doesNotMatch(html, /https:\/\/schema\.org|private-secret|<script/)
})

test('valid private manifest cannot be overwritten or used to follow output symlink', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-private-print-alias-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'plus.html'), offlineHtml('1.29'))
  await writeFile(join(dir, 'deka.html'), offlineHtml('1.19'))
  // Filename extension is not an authorization to overwrite raw input;
  // a valid JSON manifest can itself be named *.html.
  const manifest = join(dir, 'source-manifest.html')
  await writeFile(manifest, JSON.stringify({
    version: 1,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html',
        capturedAt: new Date().toISOString() },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html',
        capturedAt: new Date().toISOString() },
    ],
  }))
  const before = await readFile(manifest, 'utf8')
  await assert.rejects(() => main([manifest, '--output', manifest]),
    /refusing to overwrite M3 evidence input with derived output/)
  assert.equal(await readFile(manifest, 'utf8'), before)
  const sentinel = join(dir, 'private-source.txt')
  await writeFile(sentinel, 'protected private source')
  const output = join(dir, 'output.html')
  await symlink(sentinel, output)
  await assert.rejects(() => main([manifest, '--output', output]),
    /refusing symlinked M3 derived output file/)
  assert.equal(await readFile(sentinel, 'utf8'), 'protected private source')
})

test('argument validation prevents implicit output, network or arbitrary filename', async () => {
  await assert.rejects(() => main([]), /Invalid private offline checklist HTML arguments/)
  await assert.rejects(() => main(['x', '--output', '/tmp/unchecked.txt']),
    /Invalid private offline checklist HTML arguments/)
  await assert.rejects(() => main(['x', '--output', '  bad.html  ']),
    /Invalid private offline checklist HTML arguments/)
})
