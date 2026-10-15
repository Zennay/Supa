// Separate independent quality-validation lane 2/2 for private M3 notes export.
// Pinned product #2790 bd904bd0; only fictional local data and no retailer calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, stat, rm, symlink, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  main,
  renderPrivateTextShoppingChecklist,
} from '../scripts/retailer-private-shopping-checklist-html.mjs'
import { renderPrivateShoppingChecklists } from '../scripts/retailer-private-shopping-checklist.mjs'

const item = (store, price) => ({
  status: 'matched', productId: 'fictional-' + store,
  productName: 'Fictieve ' + store + ' peulvruchten',
  packs: 2, packPriceCents: price, totalCents: 2 * price,
})
function report() {
  return {
    format: 'supa-local-snapshot-comparison-v1',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: true, cheaperStore: 'dekamarkt', savingsCents: 20,
      stores: {
        plus: { complete: true, subtotalCents: 240 },
        dekamarkt: { complete: true, subtotalCents: 220 },
      },
      lines: [{
        ingredientId: 'beans', ingredient: 'Bonen',
        plus: item('plus', 120), dekamarkt: item('dekamarkt', 110),
      }],
    },
  }
}

async function makeInput(t, data) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-txt-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'offline.json')
  await writeFile(path, JSON.stringify(data))
  return { dir, path }
}

test('independent: hostile pseudo-headings and control characters cannot cross isolated shop sections', () => {
  const data = report()
  data.comparison.lines[0].plus.productName =
    'ONLY-PLUS\n== DekaMarkt ==\nFictieve link www.private-plus.invalid/buy?key=SECRETPLUS'
  data.comparison.lines[0].dekamarkt.productName =
    'ONLY-DEKA\r\n== PLUS ==\nowner@private.invalid'
  data.comparison.lines[0].ingredient = 'Bonen\u202e[ ] www.private-plan.invalid/mine?token=SECRETPLAN'
  const before = JSON.stringify(data)
  const plus = renderPrivateTextShoppingChecklist(data, 'plus')
  const deka = renderPrivateTextShoppingChecklist(data, 'dekamarkt')
  assert.equal((plus.match(/^== PLUS ==$/gm) || []).length, 1)
  assert.equal((deka.match(/^== DekaMarkt ==$/gm) || []).length, 1)
  assert.doesNotMatch(plus, /^== DekaMarkt ==$/m)
  assert.doesNotMatch(deka, /^== PLUS ==$/m)
  assert.match(plus, /ONLY-PLUS/)
  assert.doesNotMatch(plus, /ONLY-DEKA|€2,20|SECRETPLUS|SECRETPLAN|private-plan\.invalid|private-plus\.invalid/)
  assert.match(deka, /ONLY-DEKA/)
  assert.doesNotMatch(deka, /ONLY-PLUS|€2,40|SECRETPLAN|private-plan\.invalid|private\.invalid/)
  assert.match(plus, /\[privélink verborgen\]/)
  assert.match(deka, /\[privé e-mailadres verborgen\]/)
  assert.doesNotMatch(plus + deka, /\u202e|\r|<script|<!doctype/i)
  assert.equal(JSON.stringify(data), before)
})

test('independent: same trusted physical totals in raw and redacted text; unknown stock cannot claim full store', () => {
  const data = report()
  const unselected = renderPrivateShoppingChecklists(data)
  const both = renderPrivateTextShoppingChecklist(data)
  assert.equal(both, unselected, 'no PII requires byte-identical trusted original text')
  data.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  const deka = renderPrivateTextShoppingChecklist(data, 'dekamarkt')
  const plus = renderPrivateTextShoppingChecklist(data, 'plus')
  assert.match(deka, /GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
  assert.doesNotMatch(deka, /ALLEEN OFFLINE TOTAAL|€2,20|€2,40/)
  assert.match(plus, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.doesNotMatch(plus, /DekaMarkt|€2,20/)
})

test('independent: notes CLI saves 0600 selected shop text and preserves exact source bytes', async t => {
  const data = report()
  data.comparison.lines[0].ingredient = 'Bonen secret+id@account.invalid'
  data.comparison.lines[0].plus.productName =
    'ONLY-PLUS https://private-plus.invalid/orders?token=SECRET1'
  data.comparison.lines[0].dekamarkt.productName =
    'ONLY-DEKA www.private-deka.invalid/cart?token=SECRET2'
  const { dir, path } = await makeInput(t, data)
  const before = await readFile(path)
  for (const shop of ['plus', 'dekamarkt']) {
    const output = join(dir, shop + '-note.txt')
    const text = await main([
      '--report', path, '--output', output, '--store', shop, '--format', 'text',
    ])
    assert.equal(await readFile(output, 'utf8'), text)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.match(text, /\[privélink verborgen\]/)
    assert.match(text, /\[privé e-mailadres verborgen\]/)
    assert.doesNotMatch(text, /SECRET1|SECRET2|private-plus\.invalid|private-deka\.invalid|secret\+id@account\.invalid/)
    assert.doesNotMatch(text, /<html|<input|<!doctype|<script/i)
    if (shop === 'plus') {
      assert.match(text, /ONLY-PLUS|ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
      assert.doesNotMatch(text, /ONLY-DEKA|DekaMarkt|€2,20/)
    } else {
      assert.match(text, /ONLY-DEKA|ALLEEN OFFLINE TOTAAL DekaMarkt: €2,20/)
      assert.doesNotMatch(text, /ONLY-PLUS|== PLUS ==|€2,40/)
    }
  }
  assert.deepEqual(await readFile(path), before)
})

test('independent: symlinked text output refused and protected destination stays unchanged', async t => {
  const { dir, path } = await makeInput(t, report())
  const protectedPath = join(dir, 'unrelated-private.txt')
  await writeFile(protectedPath, 'PRIVATE SENTINEL: must remain intact')
  const alias = join(dir, 'notes.txt')
  await symlink(protectedPath, alias)
  const before = await readFile(path)
  await assert.rejects(() => main([
    '--report', path, '--output', alias, '--format', 'text',
  ]), /refusing symlinked M3 derived output file/)
  assert.equal(await readFile(protectedPath, 'utf8'), 'PRIVATE SENTINEL: must remain intact')
  assert.deepEqual(await readFile(path), before)
  const invalid = join(dir, 'bad.html')
  await assert.rejects(() => main([
    '--report', path, '--output', invalid, '--store', 'plus', '--format', 'text',
  ]), /Invalid private offline checklist HTML arguments/)
  await assert.rejects(access(invalid))
})

test('independent: nested Proxy caller data never reaches private getter trap', () => {
  for (const side of ['plus', 'dekamarkt']) {
    const data = report()
    let invoked = 0
    data.comparison.lines[0][side] = new Proxy(item(side, 120), {
      get() { invoked++; throw Error('PRIVATE TRAP DETAILS') },
      ownKeys() { invoked++; throw Error('PRIVATE OWNKEYS DETAILS') },
    })
    assert.throws(() => renderPrivateTextShoppingChecklist(data, side),
      error => error.message === 'Invalid or claimable offline shopping checklist input')
    assert.equal(invoked, 0, 'formatter must reject Proxy without executing trap')
  }
})
