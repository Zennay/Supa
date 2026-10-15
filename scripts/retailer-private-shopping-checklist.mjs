import { pathToFileURL } from 'node:url'
import { compareLocalRetailerSnapshots } from './retailer-compare-local-snapshots.mjs'

const safeMoney = n => Number.isSafeInteger(n) && n >= 0
const euro = n => '€' + (n / 100).toFixed(2).replace('.', ',')
function safeLabel(value) {
  if (typeof value !== 'string') return 'onbekend'
  // Local product names and free-form planner ingredients are UNTRUSTED.
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 120) || 'onbekend'
}

function safeRow(row) {
  if (!row || row.status !== 'matched' ||
      !Number.isSafeInteger(row.packs) || row.packs < 0 ||
      !safeMoney(row.packPriceCents) || !safeMoney(row.totalCents) ||
      row.packs * row.packPriceCents !== row.totalCents ||
      (row.packs === 0 && typeof row.sharedPackWithIngredientId !== 'string')) return false
  return true
}

/**
 * Private, physically meaningful purchase checklist per shop.
 * Never asserts public savings, never downloads retailer pages.
 */
export function renderPrivateShoppingChecklists(report) {
  const comparison = report?.comparison
  if (report?.format !== 'supa-local-snapshot-comparison-v1' ||
      !comparison || comparison.provenance !== 'offline-snapshot-preview' ||
      comparison.claimable !== false ||
      !Array.isArray(comparison.lines) || comparison.lines.length === 0 ||
      comparison.lines.length > 500 ||
      !comparison.stores?.plus || !comparison.stores?.dekamarkt) {
    throw new Error('Invalid or claimable offline shopping checklist input')
  }
  const output = [
    'SUPA · PRIVÉ BOODSCHAPPENCHECKLIST',
    'ALLEEN LOKALE SNAPSHOTS · GEEN LIVE PRIJS OF BEWEZEN BESPARING',
    'Controleer altijd verpakking, prijs en voorraad in de winkel.',
  ]
  for (const [shop, title] of [['plus','PLUS'], ['dekamarkt','DekaMarkt']]) {
    output.push('', '== ' + title + ' ==')
    let sum = 0
    let complete = true
    const paidSku = new Map()
    for (const line of comparison.lines) {
      const row = line?.[shop]
      const ingredient = safeLabel(line?.ingredient)
      if (!safeRow(row)) {
        complete = false
        output.push('[?] ' + ingredient + ': prijs, product of voorraad onbekend')
        continue
      }
      if (row.packs === 0) {
        // A zero-pack row is not a free product and requires PROOF that the
        // previously paid SKU explicitly covers this ingredient demand.
        const paid = paidSku.get(row.productId)
        if (!paid || typeof line?.ingredientId !== 'string' ||
            paid.ownerId !== row.sharedPackWithIngredientId ||
            !paid.coveredIds.includes(line.ingredientId)) {
          complete = false
          output.push('[?] ' + ingredient + ': gedeeld pak niet te bewijzen')
          continue
        }
        output.push('[=] ' + ingredient + ': gedekt door eerder gedeeld pak; NIET gratis')
        continue
      }
      const product = safeLabel(row.productName)
      const productId = typeof row.productId === 'string' ? row.productId : null
      // Repeated paid IDs would mean duplicate shopping purchases.
      if (!productId || paidSku.has(productId)) {
        complete = false
        output.push('[?] ' + ingredient + ': dubbel product-ID, controleren')
        continue
      }
      paidSku.set(productId, { ownerId: line?.ingredientId,
        coveredIds: Array.isArray(row.sharedPackCoversIngredientIds)
          ? row.sharedPackCoversIngredientIds : [] })
      sum += row.totalCents
      if (!safeMoney(sum)) {
        complete = false
        output.push('[?] ' + ingredient + ': ongeldige prijsberekening')
        continue
      }
      output.push('[ ] ' + ingredient + ': ' + row.packs + ' hele verpakking(en) ' +
        product + ' · ' + euro(row.packPriceCents) + '/pak · ' +
        euro(row.totalCents) + ' lokaal totaal')
    }
    const trustedSum = safeMoney(sum) && comparison.stores[shop].subtotalCents === sum
    const printable = complete && trustedSum && comparison.stores[shop].complete === true
    output.push(printable
      ? 'ALLEEN OFFLINE TOTAAL ' + title + ': ' + euro(sum)
      : 'GEEN BETROUWBAAR VOLLEDIG TOTAAL ' + title + ': ontbrekende of tegenstrijdige gegevens')
  }
  output.push('', 'Geen winkeladvies: zonder actuele voorraad en bronrechten zijn dit uitsluitend privéberekeningen.')
  return output.join('\n') + '\n'
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error('Gebruik: node --experimental-strip-types scripts/retailer-private-shopping-checklist.mjs manifest.json')
  }
  const report = await compareLocalRetailerSnapshots(argv[0])
  console.log(renderPrivateShoppingChecklists(report))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
