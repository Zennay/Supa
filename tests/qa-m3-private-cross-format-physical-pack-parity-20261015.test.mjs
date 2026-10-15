// Integrated independent QA: HTML and plain-text share a single pinned M3 trust contract.
// Synthetic local shopping examples ONLY. This is not an observed retailer basket.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, stat, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../scripts/retailer-private-shopping-checklist-html.mjs'

function makeReport() {
  const shared = (shop, cents) => ({
    status: 'matched', productId: 'fake-shared-' + shop,
    productName: 'SECRET-' + shop.toUpperCase() + ' test+email@fiction.invalid',
    packs: 2, packPriceCents: cents, totalCents: 2 * cents,
    sharedPackCoversIngredientIds: ['beans', 'leftover'],
  })
  const owner = { plus: shared('plus', 120), dekamarkt: shared('dekamarkt', 110) }
  return {
    format: 'supa-local-snapshot-comparison-v1',
    warning: 'No authentic retailer observation',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: true, savingsCents: 20, cheaperStore: 'dekamarkt',
      stores: {
        plus: { complete: true, subtotalCents: 240 },
        dekamarkt: { complete: true, subtotalCents: 220 },
      },
      lines: [
        { ingredientId: 'beans', ingredient: 'Bonen https://private.invalid/plan?token=HIDDEN',
          plus: owner.plus, dekamarkt: owner.dekamarkt },
        { ingredientId: 'leftover', ingredient: 'Overige bonen',
          plus: { ...owner.plus, packs: 0, totalCents: 0,
            sharedPackWithIngredientId: 'beans' },
          dekamarkt: { ...owner.dekamarkt, packs: 0, totalCents: 0,
            sharedPackWithIngredientId: 'beans' } },
      ],
    },
  }
}
async function fixture(t, data = makeReport()) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-cross-mode-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const input = join(directory, 'saved.json')
  await writeFile(input, JSON.stringify(data))
  return { directory, input }
}

test('integrated QA: HTML and notes TXT charge each physical shared pack once and never reveal opposing retailer', async t => {
  const { directory, input } = await fixture(t)
  const original = await readFile(input)
  for (const store of ['plus', 'dekamarkt']) {
    const other = store === 'plus' ? 'dekamarkt' : 'plus'
    const title = store === 'plus' ? 'PLUS' : 'DekaMarkt'
    const cents = store === 'plus' ? '€2,40' : '€2,20'
    const htmlFile = join(directory, store + '.html')
    const textFile = join(directory, store + '.txt')
    const html = await main(['--report', input, '--output', htmlFile, '--store', store])
    const txt = await main(['--report', input, '--output', textFile, '--store', store, '--format', 'text'])
    assert.equal(await readFile(htmlFile, 'utf8'), html)
    assert.equal(await readFile(textFile, 'utf8'), txt)
    assert.equal((await stat(htmlFile)).mode & 0o777, 0o600)
    assert.equal((await stat(textFile)).mode & 0o777, 0o600)
    for (const output of [html, txt]) {
      assert.match(output, new RegExp('ALLEEN OFFLINE TOTAAL ' + title + ': ' + cents))
      assert.match(output, new RegExp('SECRET-' + store.toUpperCase()))
      assert.doesNotMatch(output, new RegExp('SECRET-' + other.toUpperCase(), 'i'))
      assert.doesNotMatch(output, /HIDDEN|test\+email@fiction\.invalid|private\.invalid\/plan/)
      assert.match(output, /\[privélink verborgen\]/)
      assert.match(output, /\[privé e-mailadres verborgen\]/)
      assert.match(output, /NIET gratis/)
      assert.doesNotMatch(output, /bewezen besparing(?![\s\S]*geen bewezen besparing)/i)
    }
    assert.equal((html.match(/type="checkbox"/g)||[]).length, 1)
    assert.equal((txt.match(/^\[ \] /gm)||[]).length, 1)
    assert.equal((txt.match(/^\[=\] /gm)||[]).length, 1)
    assert.equal((html.match(/Al gedekt/g)||[]).length, 1)
    assert.equal((txt.match(/NIET gratis/g)||[]).length, 1)
    assert.doesNotMatch(txt, /<html|<script|<input/i)
  }
  assert.deepEqual(await readFile(input), original, 'neither derived output may mutate genuine input bytes')
})

test('integrated QA: unknown opposing shop remains unknown in HTML and TXT; valid store still truthful', async t => {
  const data = makeReport()
  data.comparison.lines[0].dekamarkt.status = 'availability_unknown'
  const { directory, input } = await fixture(t, data)
  for (const format of ['html', 'text']) {
    const suffix = format === 'text' ? '.txt' : '.html'
    const file = join(directory, 'deka-' + format + suffix)
    const args = ['--report', input, '--output', file, '--store', 'dekamarkt']
    if (format === 'text') args.push('--format', 'text')
    const output = await main(args)
    assert.match(output, /GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
    assert.doesNotMatch(output, /ALLEEN OFFLINE TOTAAL DekaMarkt|€2,40|€2,20|SECRET-PLUS/)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  }
  const plus = await main(['--report', input, '--output', join(directory, 'plus.txt'),
    '--store', 'plus', '--format', 'text'])
  assert.match(plus, /ALLEEN OFFLINE TOTAAL PLUS: €2,40/)
  assert.doesNotMatch(plus, /DekaMarkt|€2,20/)
})

test('integrated QA: forged claimable input can produce neither HTML nor TXT', async t => {
  const data = makeReport()
  data.comparison.claimable = true
  const { directory, input } = await fixture(t, data)
  for(const format of ['html', 'text']) {
    const output = join(directory, 'forbidden.' + (format === 'html' ? 'html' : 'txt'))
    const args = ['--report', input, '--output', output, '--store', 'plus']
    if(format === 'text') args.push('--format', 'text')
    await assert.rejects(() => main(args), /Invalid or claimable offline shopping checklist input/)
    await assert.rejects(access(output))
  }
})
