import { useState } from 'react'
import { privateKnownPricePairs } from '../products/privateProgressProductRows.ts'
import { downloadPrivateKnownLinePriceCsv } from '../products/privateKnownLinePriceCsv.ts'
import { downloadPrivateKnownLinePricePrint } from '../products/privateKnownLinePricePrint.ts'
import type { PrivateCaptureProgress, PrivateReviewedBaskets, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { euro } from '../../lib/money.ts'
import './plannerKnownLinePrices.css'

/** Read-only admitted original SKU pairs; never a fabricated full basket. */
export function PlannerKnownLinePrices({ progress, reviewed, now, onReviewIngredient }: {
  progress: PrivateCaptureProgress | null
  reviewed: PrivateReviewedBaskets | null
  now: number
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [message, setMessage] = useState('')
  const pairs = privateKnownPricePairs(progress, reviewed, now)
  if (!pairs.length) return null
  const search = query.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const filtered = pairs.filter(pair => !search || [
    pair.ingredientId, pair.ingredientLabel,
    pair.plusProduct.productName, pair.plusProduct.productId,
    pair.dekaProduct.productName, pair.dekaProduct.productId,
  ].some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(search)))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) ||
      a.ingredientId.localeCompare(b.ingredientId, 'nl'))
  const visible = showAll ? filtered : filtered.slice(0, 4)
  function download(kind: 'csv' | 'html') {
    try {
      if (kind === 'csv') {
        const count = downloadPrivateKnownLinePriceCsv(progress, reviewed)
        setMessage(count + ' origineel gepaarde privé-ingrediënten als CSV opgeslagen.')
      } else {
        downloadPrivateKnownLinePricePrint(progress, reviewed)
        setMessage('Offline afdruk met echte bronproducten lokaal opgeslagen.')
      }
    } catch {
      setMessage('De winkelprijzen of originele bronmomenten zijn verlopen of gewijzigd. Herzie ze in Vergelijk.')
    }
  }
  return <section className="planner-known-lines" aria-label="Bekende gedeeltelijke winkelprijzen">
    <h4>{pairs.length} ingrediëntprijzen bekend bij beide winkels</h4>
    <p>Dezelfde fysieke weekvraag en oorspronkelijke winkelopnames binnen 24 uur.
      <strong> Het volledige mandtotaal, de goedkoopste complete winkel en een
        besparingsclaim blijven onbekend</strong> tot beide volledige mandjes zijn gecontroleerd.</p>
    <label>Zoek ingrediëntcode, productnaam of SKU
      <input type="search" maxLength={120} value={query}
        onChange={event => setQuery(event.currentTarget.value)} />
    </label>
    <p role="status">{filtered.length} van {pairs.length} gecontroleerde paren.</p>
    <div className="planner-known-lines__list">
      {visible.map(pair => <article key={pair.ingredientId}>
        <strong>{pair.ingredientLabel} · {pair.requiredAmount} {pair.requiredUnit}</strong>
        <div className="planner-known-lines__stores">
          <div><b>PLUS</b>
            <span>{pair.plusProduct.productName} · SKU {pair.plusProduct.productId}</span>
            <small>{pair.plusProduct.packCount} × {pair.plusProduct.packAmount} {pair.plusProduct.packUnit} per pak ·
              {' '}{pair.plusProduct.unitRate ?? 'eenheidsprijs onbekend'}</small>
            <strong>{pair.plusPacks} pakken · {euro.formatCents(pair.plusCents)}</strong>
            <small>Eigen opname: {pair.plusObservedAt}</small>
          </div>
          <div><b>DekaMarkt</b>
            <span>{pair.dekaProduct.productName} · SKU {pair.dekaProduct.productId}</span>
            <small>{pair.dekaProduct.packCount} × {pair.dekaProduct.packAmount} {pair.dekaProduct.packUnit} per pak ·
              {' '}{pair.dekaProduct.unitRate ?? 'eenheidsprijs onbekend'}</small>
            <strong>{pair.dekaPacks} pakken · {euro.formatCents(pair.dekaCents)}</strong>
            <small>Eigen opname: {pair.dekaObservedAt}</small>
          </div>
        </div>
        <p><b>{pair.difference === 0 ? 'Gelijke regelprijs' :
          euro.formatCents(Math.abs(pair.difference)) + ' lager bij ' +
          (pair.difference > 0 ? 'PLUS' : 'DekaMarkt')}</b>
          {' '}voor deze ene ingrediëntvraag, niet voor het hele mandje.</p>
        <div className="planner-known-lines__actions">
          <button type="button" onClick={() => onReviewIngredient('PLUS', pair.ingredientId)}>Controleer PLUS-SKU</button>
          <button type="button" onClick={() => onReviewIngredient('DekaMarkt', pair.ingredientId)}>Controleer DekaMarkt-SKU</button>
        </div>
      </article>)}
    </div>
    {!filtered.length && <p>Geen bevestigde productregels met deze zoekterm.</p>}
    {filtered.length > 4 && <button type="button" onClick={() => setShowAll(value => !value)}>
      {showAll ? 'Toon eerste vier' : 'Toon alle ' + filtered.length + ' productparen'}
    </button>}
    <div className="planner-known-lines__actions">
      <button type="button" onClick={() => download('csv')}>Download echte ingrediëntprijzen (CSV)</button>
      <button type="button" onClick={() => download('html')}>Offline afdruk (HTML)</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>
}
