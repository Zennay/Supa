import { privateReviewedPairWithin24Hours } from '../comparison/privateReviewedBasketBridge.ts'
import type { OwnStoreWeekComparison } from './ownStoreBudgetComparison.ts'
import { createPrivateBasketComparisonCsv } from '../../privateBasketComparisonCsv.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'

import { euro as exactEuro } from '../../lib/money.ts'

function readable(value: string): string {
  // Private text-only export: keep literal observed identities, but never let
  // control characters masquerade as additional products or report headings.
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim()
}

/** Only call with a comparison accepted by the canonical basket engine. */
export function printableOwnStoreComparison(
  comparison: Extract<OwnStoreWeekComparison, { status: 'comparable' }>,
  observations: { PLUS: string; DekaMarkt: string },
  extraVisitCostCents: number | null = null,
): string {
  const lines = [
    'Supa · mijn persoonlijke PLUS/DekaMarkt-weekmand',
    'Privé: alleen uit door mij ingevoerde en bevestigde bronnen; geen kassagarantie.',
    'PLUS bronmoment: ' + readable(observations.PLUS),
    'DekaMarkt bronmoment: ' + readable(observations.DekaMarkt),
    'PLUS totaal hele verpakkingen: ' + exactEuro.formatCents(comparison.plusCents),
    'DekaMarkt totaal hele verpakkingen: ' + exactEuro.formatCents(comparison.dekaCents),
    comparison.cheapest === null ? 'De beide winkelmandjes zijn even duur.' :
      comparison.cheapest + ' is ' + exactEuro.formatCents(comparison.differenceCents) + ' voordeliger voor dit mandje.',
  ]
  // Portable TXT and mobile clipboard contain the same conditional
  // two-stop economics as the Planner. Visit expenses remain the shopper's
  // own scenario and are deliberately NOT silently assumed to be zero.
  if (comparison.mixedRoute?.requiresTwoStops) {
    const route = comparison.mixedRoute
    lines.push('', 'Optionele combinatie van twee winkels:',
      'Goedkoopste gecontroleerde hele-verpakkingenregel per ingrediënt: ' +
        exactEuro.formatCents(route.totalCents),
      'Productverschil tegenover goedkoopste volledige winkel (voor extra bezoekkosten): ' +
        exactEuro.formatCents(route.possibleProductDifferenceCents),
      route.possibleProductDifferenceCents > 0
        ? 'Alleen voordeliger als jouw extra winkelstopkosten lager zijn dan ' +
          exactEuro.formatCents(route.possibleProductDifferenceCents) + '.'
        : 'Geen productvoordeel tegenover een volledige winkel; extra bezoekkosten maken dit duurder.',
      ...(extraVisitCostCents === null
        ? ['Netto voordeel onbekend: eigen extra winkelstopkosten niet ingevuld.']
        : Number.isSafeInteger(extraVisitCostCents) && extraVisitCostCents >= 0 && extraVisitCostCents <= 100000
          ? [
            'Zelf opgegeven extra winkelstopkosten: ' + exactEuro.formatCents(extraVisitCostCents),
            'Twee winkelstops inclusief die kosten: ' +
              exactEuro.formatCents(BigInt(route.totalCents) + BigInt(extraVisitCostCents)),
            'Netto verschil tegenover de goedkoopste volledige winkel: ' +
              exactEuro.formatCents(BigInt(route.possibleProductDifferenceCents) - BigInt(extraVisitCostCents)) +
              ' (positief = goedkoper; negatief = duurder).',
            'Niet meegenomen: overige persoonlijke reistijd of niet opgegeven kosten.',
          ]
          : ['Kosten ongeldig: netto vergelijking niet beschikbaar.']),
    )
  }
  lines.push('', 'Vergelijking per ingrediënt (zelfde fysieke vraag):')
  for (const row of comparison.lines) {
    const label = readable(row.ingredientLabel)
    const entry = (store: string, line: typeof row.plus) => [
      store + ': ' + readable(line.productName),
      'SKU ' + readable(line.productId),
      line.packs + ' volledige verpakking(en)',
      line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count + ' per verpakking',
      exactEuro.formatCents(line.pricePerPackCents) + ' per verpakking',
      (privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'),
      exactEuro.formatCents(line.lineTotalCents) + ' benodigd',
    ].join(' · ')
    lines.push('', label + ': ' + row.plus.requirement.amount + ' ' + row.plus.requirement.unit + ' benodigd',
      '  ' + entry('PLUS', row.plus), '  ' + entry('DekaMarkt', row.deka),
      '  Regelverschil: ' + (row.deltaCents === 0 ? 'gelijk' :
        exactEuro.formatCents(Math.abs(row.deltaCents)) +
        (row.deltaCents > 0 ? ' lager bij PLUS' : ' lager bij DekaMarkt')))
  }
  lines.push('', 'Alleen eigen opnames; geen onafhankelijk geverifieerd besparingsbewijs.')
  return lines.join('\n') + '\n'
}

export function downloadOwnStoreText(value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-prive-plus-deka-weekvergelijking.txt'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Planner CSV uses the identical, already-admitted private basket receipt
 * serializer as Vergelijk. No alternate arithmetic or invented price source. */
export function downloadOwnStoreCsv(
  reviewed: import('../comparison/privateReviewedBasketBridge.ts').PrivateReviewedBaskets,
  comparison: Extract<OwnStoreWeekComparison, { status: 'comparable' }>,
): void {
  const plus = reviewed.stores.PLUS
  const deka = reviewed.stores.DekaMarkt
  if (!plus || !deka || !privateReviewedPairWithin24Hours(plus, deka)) {
    throw new Error('De eigen winkelbronnen zijn niet allebei vergelijkbaar.')
  }
  const content = createPrivateBasketComparisonCsv({
    ingredients: plus.basket.lines.map(line => ({
      id: line.id, label: line.ingredientLabel,
      amount: line.requirement.amount, unit: line.requirement.unit,
    })),
    captures: {
      PLUS: { observedAt: plus.observedAt },
      DekaMarkt: { observedAt: deka.observedAt },
    },
    baskets: { PLUS: plus.basket, DekaMarkt: deka.basket },
    fresh: { PLUS: true, DekaMarkt: true },
    paired: true,
    deltas: new Map(comparison.lines.map(line => [line.id, line.deltaCents])),
  })
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-prive-plus-deka-weekvergelijking.csv'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
