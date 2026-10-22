import { useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { buildShoppingListCopyText } from './shoppingListCopyText.ts'
import { exportUnpricedShoppingCsv, importUnpricedShoppingCsv } from './manualShoppingNotesCsv.ts'

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

/** Optional transfer into Supa's EXISTING price-free personal notes importer.
 * The example shop and example products are intentionally discarded. The
 * original ingredient/physical demand, not a guessed SKU, becomes the note.
 */
export function buildPersonalShoppingNotesCsv(
  basket: OneStoreBasket,
  doneLineIds: readonly string[],
): string | null {
  if (buildShoppingListCopyText(basket, doneLineIds) === null ||
      basket.lines.length < 1 || basket.lines.length > 100) return null
  const done = new Set(doneLineIds)
  const notes = basket.lines.map(line => {
    const amount = line.requirement.amount === null ? '?' :
      String(line.requirement.amount).replace('.', ',')
    const unit = line.requirement.unit === 'piece' ? 'stuks' : line.requirement.unit
    return {
      store: 'Algemeen' as const,
      label: line.ingredientLabel + ' · ' + amount + ' ' + unit,
      done: done.has(line.id),
    }
  })
  try {
    const csv = exportUnpricedShoppingCsv(notes)
    // The actual personal-list reader is authoritative on schema, bounds,
    // duplicate identities and spreadsheet safety. No partial transfer.
    if (new TextEncoder().encode(csv).byteLength > 32768) return null
    return importUnpricedShoppingCsv(csv).length === notes.length ? csv : null
  } catch { return null }
}

export function ShoppingListCsvExport({ basket, doneLineIds }: {
  basket: OneStoreBasket; doneLineIds: readonly string[]
}) {
  const [message, setMessage] = useState('')
  const data = buildUnpricedShoppingListCsv(basket, doneLineIds)
  const personalData = buildPersonalShoppingNotesCsv(basket, doneLineIds)
  function download(csv: string | null, filename: string, success: string) {
    if (!csv) return
    try {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.append(anchor)
        try { anchor.click() } finally { anchor.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage(success)
    } catch {
      setMessage('Export mislukt; je boodschappen en afvinkstatus zijn niet veranderd.')
    }
  }
  return <div className="shopping-copy">
    <button type="button" className="shopping-copy__button" disabled={!data}
      onClick={() => download(data, 'supa-mijn-ongeprijsde-boodschappenlijst.csv',
        'Ongeprijsd bronoverzicht lokaal opgeslagen; geen fictieve winkelprijzen.') }>
      Exporteer ongeprijsde lijst (CSV)
    </button>
    <button type="button" className="shopping-copy__button" disabled={!personalData}
      onClick={() => download(personalData, 'supa-naar-mijn-eigen-ongeprijsde-boodschappen.csv',
        'Compatibele CSV opgeslagen. Importeer die via Lijst → Mijn eigen ongeprijsde boodschappen; controleer de voorinzage en bevestig zelf. Voorbeeldwinkel en SKU zijn niet overgenomen.') }>
      Zet Planner-ingrediënten over naar mijn eigen lijst (CSV)
    </button>
    {!personalData && data && <span className="shopping-copy__status" role="status">
      Overzetten niet beschikbaar: maximaal 100 unieke, geldige omschrijvingen.
      Download het ongeprijsde bronoverzicht om de regels zelf te bekijken.
    </span>}
    {!data && <span className="shopping-copy__status" role="status">Deze lijst kan nog niet veilig worden geëxporteerd.</span>}
    {message && <span className="shopping-copy__status" role="status">{message}</span>}
  </div>
}
