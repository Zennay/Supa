import { useState } from 'react'
import { recentOwnCaptureInstant, type OwnStore, type PrivateCaptureProgress } from '../comparison/privateReviewedBasketBridge.ts'
import './plannerReviewedSourceLines.css'

const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** Individual admitted SKU facts only. Never a complete basket authority. */
export function PlannerReviewedSourceLines({ progress, now, onReviewIngredient }: {
  progress: PrivateCaptureProgress | null
  now: number
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [shop, setShop] = useState<'both' | OwnStore>('both')
  const [expanded, setExpanded] = useState(false)
  if (!progress) return null
  const entries = shops.flatMap(store => {
    const source = progress.stores[store]
    if (!source?.fresh || !recentOwnCaptureInstant(source.observedAt, now)) return []
    return (source.confirmedSourceLines ?? []).map(line => ({ store, line }))
  })
  if (entries.length === 0) return null
  const search = query.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const shown = entries.filter(({ store, line }) =>
    (shop === 'both' || shop === store) &&
    (!search || [line.ingredientLabel, line.productName, line.productId]
      .some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(search))))
  return <details className="supa-reviewed-source-lines" open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{entries.length} gekoppelde bronproducten en eenheidsprijzen bekijken</summary>
    {expanded && <>
      <p>Originele producten uit je eigen lokale winkelopnames. Dit zijn losse,
        gekoppelde regels, geen compleet mandje. Ontbrekende prijzen blijven onbekend.
        Zonder twee volledige recente mandjes is er <strong>geen winkelwinnaar
        of totale besparing</strong>.</p>
      <div className="supa-reviewed-source-lines__controls">
        <label>Zoek ingrediënt, product of SKU
          <input type="search" value={query} maxLength={120}
            onChange={event => setQuery(event.currentTarget.value)} />
        </label>
        <label>Winkel
          <select value={shop}
            onChange={event => setShop(event.currentTarget.value as typeof shop)}>
            <option value="both">Beide winkels</option>
            <option value="PLUS">PLUS</option>
            <option value="DekaMarkt">DekaMarkt</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite">{shown.length} van {entries.length} gekoppelde
        artikelen zichtbaar; geen volledige mandtotalen.</p>
      <div className="supa-reviewed-source-lines__grid">
        {shown.map(({ store, line }) => <article
          key={JSON.stringify([store, line.ingredientId, line.productId])}>
          <small>{store} · {line.review === 'automatic'
            ? 'Eenduidig automatisch gekoppeld' : 'Zelf gecontroleerde match'}</small>
          <h4>{line.ingredientLabel}</h4>
          <strong>{line.productName}</strong>
          <small>Originele SKU: {line.productId}</small>
          <span>Pak: {line.packCount} × {line.packAmount} {line.packUnit}</span>
          <span>{eur.format(line.pricePerPackCents / 100)} per pak ·
            {' '}{line.unitPrice ?? 'Eenheidsprijs onbekend'}</span>
          <span>{line.packagesNeeded} hele pak(ken) voor deze regel ·
            {' '}{eur.format((line.packagesNeeded * line.pricePerPackCents) / 100)}</span>
          <button type="button" className="ghost-button" onClick={() => {
            const current = progress.stores[store]
            if (!current || !recentOwnCaptureInstant(current.observedAt, Date.now())) return
            onReviewIngredient(store, line.ingredientId)
          }}>Controleer originele SKU in Vergelijk</button>
        </article>)}
      </div>
    </>}
  </details>
}
