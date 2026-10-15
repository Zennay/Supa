import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main } from '../scripts/retailer-private-shopping-checklist-html.mjs'

// Only deliberately fictional local JSON snapshots; no supermarket HTTP,
// humans, observed prices, receipts or permission/savings claims.
function savedPreview(name, plusCents, dekaCents) {
  const paid = (amount, suffix) => ({
    status: 'matched', packs: 1, packPriceCents: amount,
    totalCents: amount, productId: 'fake-' + suffix,
    productName: 'Fictief ' + name,
    sourceUrl: 'https://source.invalid/sensitive-private-token',
  })
  return {
    format: 'supa-local-snapshot-comparison-v1',
    comparison: {
      provenance: 'offline-snapshot-preview', claimable: false,
      comparable: true, savingsCents: 999999,
      stores: {
        plus: { complete: true, subtotalCents: plusCents },
        dekamarkt: { complete: true, subtotalCents: dekaCents },
      },
      lines: [{
        ingredientId: 'fictitious-demand', ingredient: 'Fictief product',
        plus: paid(plusCents, 'plus'), dekamarkt: paid(dekaCents, 'deka'),
      }],
    },
  }
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-saved-qa-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
test('two distinct saved reports competing for one HTML output publish only a complete winner', async t => {
  const dir = await setup(t)
  const left = join(dir, 'left.json')
  const right = join(dir, 'right.json')
  await writeFile(left, JSON.stringify(savedPreview('A',129,119)))
  await writeFile(right, JSON.stringify(savedPreview('B',139,109)))
  const before = await Promise.all([readFile(left), readFile(right)])
  const output = join(dir, 'generated.html')
  const results = await Promise.allSettled([
    main(['--report',left,'--output',output]),
    main(['--report',right,'--output',output]),
  ])
  const successful = results.filter(x => x.status === 'fulfilled').map(x => x.value)
  assert.ok(successful.length > 0, 'At least one valid local saved report publishes')
  const html = await readFile(output, 'utf8')
  assert.ok(successful.includes(html), 'Output must exactly equal one completed writer')
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /<h2>PLUS<\/h2>/)
  assert.match(html, /<h2>DekaMarkt<\/h2>/)
  assert.equal((await stat(output)).mode & 0o777, 0o600)
  assert.equal((html.includes('Fictief A') ? 1 : 0) +
    (html.includes('Fictief B') ? 1 : 0), 1, 'Never splice separate report bodies')
  assert.doesNotMatch(html, /sensitive-private-token|999999|https:\/\/source\.invalid/)
  assert.deepEqual(await Promise.all([readFile(left),readFile(right)]),before)
  assert.ok(!(await readdir(dir)).some(x => x.includes('.m3-tmp')),
    'No residual private temporary reports after both writers settle')
})

test('a valid saved JSON input named .html cannot overwrite itself as the output', async t => {
  const dir = await setup(t)
  const source = join(dir, 'private-comparison.html')
  await writeFile(source, JSON.stringify(savedPreview('A',129,119)))
  const original = await readFile(source)
  await assert.rejects(
    () => main(['--report',source,'--output',source]),
    /refusing to overwrite M3 evidence input with derived output/,
  )
  assert.deepEqual(await readFile(source), original)
  assert.ok(!(await readdir(dir)).some(x => x.includes('.m3-tmp')))
})

test('malformed saved JSON with private path tokens fails closed before publication and never echoes them', async t => {
  const dir = await setup(t)
  const privateInput = join(dir, 'PRIVATE-SOURCE-ACCOUNT-SECRET.json')
  const target = join(dir, 'not-created.html')
  await writeFile(privateInput, '{"comparison":"PRIVATE-SOURCE-ACCOUNT-SECRET","broken":')
  await assert.rejects(
    () => main(['--report',privateInput,'--output',target]),
    err => {
      assert.equal(err.message, 'Private offline comparison file could not be read')
      assert.doesNotMatch(String(err), /PRIVATE-SOURCE-ACCOUNT-SECRET/)
      return true
    },
  )
  await assert.rejects(access(target))
})

test('more than 500 untrusted saved purchase rows never publish a convincing total', async t => {
  const dir = await setup(t)
  const report = savedPreview('A',129,119)
  report.comparison.lines = Array.from({length:501}, (_,i) => ({
    ...report.comparison.lines[0], ingredientId: 'fictional-' + i,
  }))
  const source = join(dir, 'oversized-rows.json')
  await writeFile(source, JSON.stringify(report))
  const target = join(dir, 'should-not-publish.html')
  await assert.rejects(
    () => main(['--report',source,'--output',target]),
    /Invalid or claimable offline shopping checklist input/,
  )
  await assert.rejects(access(target))
})

test('saved shared pack without a real paid owner withholds full totals and never calls a free item', async t => {
  const dir = await setup(t)
  const report = savedPreview('A',129,119)
  for (const shop of ['plus','dekamarkt']) {
    report.comparison.lines[0][shop].packs = 0
    report.comparison.lines[0][shop].totalCents = 0
    report.comparison.lines[0][shop].sharedPackWithIngredientId = 'nonexistent-owner'
    report.comparison.stores[shop].subtotalCents = 0
  }
  const source = join(dir,'forged-shared.json')
  await writeFile(source,JSON.stringify(report))
  const html = await main(['--report',source,'--output',join(dir,'private.html')])
  assert.match(html,/gedeeld pak niet te bewijzen/)
  assert.match(html,/GEEN BETROUWBAAR VOLLEDIG TOTAAL PLUS/)
  assert.match(html,/GEEN BETROUWBAAR VOLLEDIG TOTAAL DekaMarkt/)
  assert.doesNotMatch(html,/ALLEEN OFFLINE TOTAAL (?:PLUS|DekaMarkt):/)
  assert.doesNotMatch(html,/gratis product|sensitive-private-token/i)
})
