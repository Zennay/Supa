import { useState } from 'react'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'

const COLUMNS = [
  'plusObservedAt', 'dekaObservedAt', 'comparisonStatus',
  'ingredientId', 'ingredient', 'requiredAmount', 'requiredUnit',
  'plusStatus', 'plusProduct', 'plusPacks', 'plusPackAmount', 'plusPackUnit',
  'plusPackCount', 'plusPackPriceCents', 'plusLineCents',
  'dekaStatus', 'dekaProduct', 'dekaPacks', 'dekaPackAmount', 'dekaPackUnit',
  'dekaPackCount', 'dekaPackPriceCents', 'dekaLineCents',
  'deltaCentsDekaMinusPlus',
]

function cell(value: string | number): string {
  const input = String(value)
  // Normalize only for detection; preserve the user's original label in the CSV.
  // NFKC catches full-width formula markers, and leading Unicode format controls
  // cannot hide one. Numeric values (including negative deltas) stay numeric.
  const probe = typeof value === 'string'
    ? input.normalize('NFKC').replace(/^[\s\p{Cf}\u00ad]*/u, '')
    : ''
  const text = typeof value === 'string' && /^[=+\-@]/u.test(probe) ? "'" + input : input
  return '"' + text.replace(/"/g, '""') + '"'
}

function lineFields(line: BasketTraceLine): (string | number)[] {
  if (line.status !== 'matched') return [
    'niet gekoppeld', '', '', '', '', '', '', '',
  ]
  return [
    line.reasons.includes('explicit local user selection; not an automatic or verified retailer match')
      ? 'door gebruiker gekoppeld' : 'automatisch gekoppeld',
    line.productName, line.packs, line.pack.amount,
    line.pack.unit, line.pack.count, line.pricePerPackCents, line.lineTotalCents,
  ]
}

function physicalLedgerValid(basket: OneStoreBasket): boolean {
  try {
    if (!basket || !Array.isArray(basket.lines) ||
        !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0 ||
        !Number.isSafeInteger(basket.matchedLineCount) || basket.matchedLineCount < 0 ||
        !Number.isSafeInteger(basket.unresolvedLineCount) || basket.unresolvedLineCount < 0 ||
        basket.matchedLineCount + basket.unresolvedLineCount !== basket.lines.length ||
        basket.lines.length > 1000) return false
    let matched = 0
    let unresolved = 0
    let sum = 0
    const ids = new Set<string>()
    for (const item of basket.lines) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) return false
      ids.add(item.id)
      if (item.status === 'unresolved') { unresolved++; continue }
      if (item.status !== 'matched' || !Number.isSafeInteger(item.packs) || item.packs <= 0 ||
          !Number.isSafeInteger(item.pricePerPackCents) || item.pricePerPackCents < 0 ||
          !Number.isSafeInteger(item.lineTotalCents) || item.lineTotalCents < 0 ||
          item.lineTotalCents !== item.packs * item.pricePerPackCents) return false
      matched++
      sum += item.lineTotalCents
      if (!Number.isSafeInteger(sum)) return false
    }
    return matched === basket.matchedLineCount &&
      unresolved === basket.unresolvedLineCount && sum === basket.totalCents
  } catch { return false }
}

function buildCsv(plus: OneStoreBasket, deka: OneStoreBasket,
  plusObservedAt: string, dekaObservedAt: string, comparable: boolean): string {
  if (!physicalLedgerValid(plus) || !physicalLedgerValid(deka)) {
    throw new Error('Mandgegevens zijn niet volledig consistent.')
  }
  if (!plus.lines.length || plus.lines.length !== deka.lines.length ||
      plus.selectedMealCount <= 0 || deka.selectedMealCount <= 0 ||
      plus.selectedMealCount !== deka.selectedMealCount) {
    throw new Error('Kies dezelfde geplande ingrediënten voor beide winkels.')
  }
  const dekaById = new Map(deka.lines.map(line => [line.id, line]))
  if (dekaById.size !== deka.lines.length ||
      plus.lines.some(item => !dekaById.has(item.id))) {
    throw new Error('De twee mandjes bevatten verschillende ingrediëntbehoeften.')
  }
  const complete = plus.unresolvedLineCount === 0 && deka.unresolvedLineCount === 0
  const showMoneyDifference = comparable && complete
  const state = showMoneyDifference ? 'privé rekenkundig vergelijkbaar' :
    'geen volledig of actueel vergelijkbaar prijsverschil'
  const rows = plus.lines.map(plusLine => {
    const dekaLine = dekaById.get(plusLine.id)!
    const sameDemand = plusLine.requirement.amount === dekaLine.requirement.amount &&
      plusLine.requirement.unit === dekaLine.requirement.unit
    if (!sameDemand) throw new Error('De fysieke ingrediëntbehoefte verschilt tussen winkels.')
    return [
      plusObservedAt, dekaObservedAt, state,
      plusLine.id, plusLine.ingredientLabel, plusLine.requirement.amount ?? '',
      plusLine.requirement.unit,
      ...lineFields(plusLine), ...lineFields(dekaLine),
      showMoneyDifference && plusLine.status === 'matched' && dekaLine.status === 'matched'
        ? dekaLine.lineTotalCents - plusLine.lineTotalCents : '',
    ]
  })
  const header = COLUMNS.map(cell).join(',')
  const csvLines = rows.map(values => values.map(cell).join(','))
  return '\uFEFF' + [header, ...csvLines].join('\r\n') + '\r\n'
}

/** User-initiated local CSV export: no publication, no retailer network or inferred prices. */
export function PrivateBasketComparisonExport({
  plus, deka, plusObservedAt, dekaObservedAt, comparable,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  plusObservedAt: string
  dekaObservedAt: string
  comparable: boolean
}) {
  const [message, setMessage] = useState('')
  const download = () => {
    try {
      const csv = buildCsv(plus, deka, plusObservedAt, dekaObservedAt, comparable)
      const uri = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = uri
        a.download = 'supa-twee-winkels-private-vergelijking.csv'
        document.body.append(a)
        a.click()
        a.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(uri), 1000)
      }
      setMessage('Privéprijsvergelijking als CSV gedownload. Controleer de bronwaarden zelf.')
    } catch {
      setMessage('Kon geen betrouwbaar overzicht maken. Controleer beide mandjes.')
    }
  }
  return <div className="offline-price-workbench__export">
    <button type="button" className="ghost-button" onClick={download}
      disabled={plus.lines.length === 0 || deka.lines.length === 0}>
      Download volledig prijs- en matchingoverzicht (CSV)
    </button>
    <p className="disclaimer">Per ingrediënt: benodigde hoeveelheid, gekoppeld of onbekend,
      verpakking en hele eurocenten voor beide winkels. Bij ontbrekende of verlopen prijzen
      staan er geen prijsverschillen in het bestand. Alle gegevens zijn afkomstig uit jouw eigen
      lokale invoer; dit is geen officieel prijsbewijs of besparingsonderzoek.</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </div>
}
