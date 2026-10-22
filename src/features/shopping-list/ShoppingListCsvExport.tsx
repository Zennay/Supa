import { useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { buildShoppingListCopyText } from './shoppingListCopyText.ts'

/** Private, price-free export of the existing example shopping checklist. */
export function buildUnpricedShoppingListCsv(
  basket: OneStoreBasket,
  doneLineIds: readonly string[],
): string | null {
  // Reuse strict trusted shopping-list admission; reject malformed snapshots.
  if (buildShoppingListCopyText(basket, doneLineIds) === null) return null
  const done = new Set(doneLineIds)
  const rows: string[][] = [[
    'bron', 'winkel_voorbeeld', 'ingredient_id', 'ingredient',
    'nodig_hoeveelheid', 'nodig_eenheid', 'product_voorbeeld',
    'keuze_status', 'afgevinkt',
  ]]
  for (const line of basket.lines) {
    rows.push([
      'Supa-planning (geen prijsbron)', basket.store.name, line.id,
      line.ingredientLabel,
      line.requirement.amount === null ? '' : String(line.requirement.amount).replace('.', ','),
      line.requirement.unit,
      line.status === 'matched' ? line.productName : '',
      line.status === 'matched' ? 'Voorbeeldproduct, zelf controleren' : 'Product nog kiezen',
      done.has(line.id) ? 'ja' : 'nee',
    ])
  }
  const csv = '\ufeff' + rows.map(row => row.map(value => literalCsv(value)).join(';')).join('\r\n') + '\r\n'
  return new TextEncoder().encode(csv).byteLength <= 128000 ? csv : null
}

export function ShoppingListCsvExport({ basket, doneLineIds }: {
  basket: OneStoreBasket; doneLineIds: readonly string[]
}) {
  const [message, setMessage] = useState('')
  const data = buildUnpricedShoppingListCsv(basket, doneLineIds)
  function download() {
    if (!data) return
    try {
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }))
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'supa-mijn-ongeprijsde-boodschappenlijst.csv'
        document.body.append(anchor)
        try { anchor.click() } finally { anchor.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Ongeprijsde lijst lokaal opgeslagen. Voorbeeldwinkel en producten zijn geen bevestigde bron; geen prijzen geëxporteerd.')
    } catch {
      setMessage('Export mislukt; je boodschappen en afvinkstatus zijn niet veranderd.')
    }
  }
  return <div className="shopping-copy">
    <button type="button" className="shopping-copy__button" disabled={!data} onClick={download}>
      Exporteer ongeprijsde lijst (CSV)
    </button>
    {!data && <span className="shopping-copy__status" role="status">Deze lijst kan nog niet veilig worden geëxporteerd.</span>}
    {message && <span className="shopping-copy__status" role="status">{message}</span>}
  </div>
}
