import type { OwnStore, PrivateReviewedSourceLine } from '../comparison/privateReviewedBasketBridge.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export type PartialShoppingSheet = {
  store: OwnStore
  observedAt: string
  rows: readonly PrivateReviewedSourceLine[]
  checked: Readonly<Record<string, boolean>>
  totalDemandLines: number
}

/** Progress-only export: no basket root, checkout claim or retailer winner.
 * The calling Lijst component must also re-check the original source age,
 * exact plan key and physically admitted SKU rows at the click instant. */
export function privatePartialShoppingExport(
  input: PartialShoppingSheet, kind: 'csv' | 'text',
): string {
  const { store, observedAt, rows, checked, totalDemandLines } = input
  if ((store !== 'PLUS' && store !== 'DekaMarkt') || !observedAt ||
      !Array.isArray(rows) || rows.length < 1 || rows.length >= totalDemandLines ||
      !Number.isSafeInteger(totalDemandLines) || totalDemandLines > 1000) {
    throw new Error('Geen geldige gedeeltelijk gecontroleerde eigen winkellijst.')
  }
  const ids = new Set<string>()
  const skus = new Set<string>()
  for (const item of rows) {
    if (!item || !item.ingredientId || ids.has(item.ingredientId) ||
        !item.productId || skus.has(item.productId) ||
        !Number.isSafeInteger(item.packagesNeeded) || item.packagesNeeded < 1 ||
        !Number.isSafeInteger(item.pricePerPackCents) || item.pricePerPackCents < 0 ||
        !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents < 0 ||
        item.packagesNeeded * item.pricePerPackCents !== item.lineTotalCents) {
      throw new Error('Deze bronregels kunnen niet als eigen deelboodschappenlijst worden geëxporteerd.')
    }
    ids.add(item.ingredientId)
    skus.add(item.productId)
  }
  const clean = (value: string | number) => String(value)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  let output: string
  if (kind === 'csv') {
    const header = [
      'status', 'winkel', 'eigen_bronmoment', 'ingredient_id', 'ingredient',
      'benodigd', 'eenheid', 'sku', 'bronproduct',
      'hele_pakken', 'inhoud_per_pak', 'inhoudeeenheid', 'stuks_per_pak',
      'pakprijs_cent', 'regelprijs_cent', 'indicatieve_eenheidsprijs', 'afgevinkt',
    ]
    const cells: (string | number)[][] = [header]
    for (const line of rows) {
      cells.push([
        'Deellijst; niet alle ingredienten geprijsd', store, observedAt,
        line.ingredientId, line.ingredientLabel, line.requiredAmount, line.requiredUnit,
        line.productId, line.productName, line.packagesNeeded, line.packAmount,
        line.packUnit, line.packCount, line.pricePerPackCents, line.lineTotalCents,
        line.unitPrice ?? 'onbekend', checked[line.ingredientId] === true ? 'ja' : 'nee',
      ])
    }
    output = '\uFEFF' + cells.map(c => c.map(v => literalCsv(v)).join(',')).join('\r\n') + '\r\n'
  } else {
    const lines = [
      'SUPA · mijn gedeeltelijk gecontroleerde ' + store + '-boodschappen',
      'Originele eigen bron: ' + clean(observedAt),
      rows.length + ' van ' + totalDemandLines + ' ingrediënten hebben bevestigde winkelproducten.',
      'Ontbrekende ingrediënten en hun prijzen blijven ONBEKEND; dit is geen compleet mandtotaal.',
      'Geen actuele kassagarantie, retailerrechten, winkelwinnaar of geverifieerde besparingsclaim.',
      '',
    ]
    for (const row of rows) {
      lines.push(
        (checked[row.ingredientId] ? '☑ ' : '☐ ') +
          clean(row.ingredientLabel) + ' · ' + clean(row.requiredAmount) + ' ' + clean(row.requiredUnit),
        '  ' + clean(row.packagesNeeded) + ' × ' + clean(row.productName) +
          ' (SKU ' + clean(row.productId) + ')',
        '  ' + clean(row.packCount) + ' × ' + clean(row.packAmount) +
          ' ' + clean(row.packUnit) + ' per pak · ' +
          euro.format(row.pricePerPackCents / 100) + ' per pak',
        '  Regelprijs: ' + euro.format(row.lineTotalCents / 100) +
          ' · ' + clean(row.unitPrice ?? 'eenheidsprijs onbekend'),
        '',
      )
    }
    lines.push('Controleer de overige ingrediënten en hun fysieke SKU’s in Vergelijk.')
    output = lines.join('\n') + '\n'
  }
  if (new TextEncoder().encode(output).length > 256_000)
    throw new Error('De eigen deellijst is te groot om lokaal te exporteren.')
  return output
}
