import { useRef, useState } from 'react'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import type {
  OwnStore, PrivateCaptureProgress, PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import { productSearchText } from './productSearchText.ts'
import { downloadPrivateKnownLinePriceCsv } from './privateKnownLinePriceCsv.ts'
import { downloadPrivateKnownLinePricePrint } from './privateKnownLinePricePrint.ts'
import {
  privateProgressProductRows, privateKnownPricePairs,
  type PrivateProgressProductRow,
} from './privateProgressProductRows.ts'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type Sort = 'source' | 'unitPrice' | 'lineTotal' | 'priceGap'
type Unit = 'all' | 'kg' | 'liter' | 'stuk'

/** Real, accepted but incomplete private source rows in Producten. The normal
 * catalog only receives FULL baskets; this deliberately never fills that gap
 * by promoting a partial source into a complete grocery price.
 */
export function PrivatePartialProductCards({
  progress, reviewed, now, onReviewIngredient, onOpenComparison,
}: {
  progress: PrivateCaptureProgress
  reviewed: PrivateReviewedBaskets | null
  now: number
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onOpenComparison: () => void
}) {
  const [store, setStore] = useState<'both' | OwnStore>('both')
  const [query, setQuery] = useState('')
  const [unit, setUnit] = useState<Unit>('all')
  const [sort, setSort] = useState<Sort>('source')
  const [message, setMessage] = useState('')
  const progressRef = useRef(progress)
  progressRef.current = progress
  const all = privateProgressProductRows(progress, now)
  // If a shop has a complete, admitted basket, its original rows are already
  // in the ordinary complete-catalog grid. Never display a duplicate card.
  const rows = all.filter(row => !reviewed?.stores[row.store])
  if (!rows.length) return null
  const paired = privateKnownPricePairs(progress, reviewed, now)
  const pairById = new Map(paired.map(pair => [pair.ingredientId, pair]))
  const differences = new Map(paired.map(pair =>
    [pair.ingredientId, pair.difference]))
  const rate = (row: PrivateProgressProductRow) => privatePackUnitRate({
    amount: row.line.packAmount, unit: row.line.packUnit,
    count: row.line.packCount, priceCents: row.line.pricePerPackCents,
  })
  const search = productSearchText(query.trim())
  const filtered = rows.filter(row => (store === 'both' || row.store === store) &&
    (unit === 'all' || rate(row)?.unit === unit) &&
    (!search || [row.line.productName, row.line.productId, row.line.ingredientLabel]
      .some(value => productSearchText(value).includes(search))))
  const ordered = sort === 'source' ? filtered : [...filtered].sort((a, b) => {
    if (sort === 'lineTotal') return a.line.lineTotalCents - b.line.lineTotalCents
    if (sort === 'priceGap') return (
      (differences.has(b.line.ingredientId)
        ? Math.abs(differences.get(b.line.ingredientId)!) : -1) -
      (differences.has(a.line.ingredientId)
        ? Math.abs(differences.get(a.line.ingredientId)!) : -1))
    const rank: Record<string, number> = { kg: 0, liter: 1, stuk: 2 }
    const left = rate(a)
    const right = rate(b)
    return (rank[left?.unit ?? ''] ?? 3) - (rank[right?.unit ?? ''] ?? 3) ||
      (left?.centsPerUnit ?? Infinity) - (right?.centsPerUnit ?? Infinity)
  })
  function review(row: PrivateProgressProductRow) {
    const current = progressRef.current
    if (current !== progress ||
        !privateProgressProductRows(current, Date.now()).some(next =>
          next.store === row.store && next.observedAt === row.observedAt &&
          next.line === row.line)) {
      setMessage('De bronopname is gewijzigd of verlopen. Controleer eerst de huidige bron.')
      onOpenComparison()
      return
    }
    onReviewIngredient(row.store, row.line.ingredientId)
  }
  return <section className="private-reviewed-products__partial-cards"
    aria-label="Eigen gecontroleerde losse winkelproducten zonder volledig weekmandje">
    <h3>Mijn bevestigde losse bronproducten ({rows.length})</h3>
    <p>Deze oorspronkelijke SKU’s, hoeveelheden en pakprijzen zijn al gecontroleerd,
      maar minimaal één volledig winkelmandje ontbreekt nog.
      <strong> Het totale mandbedrag en de goedkoopste winkel zijn onbekend.</strong>
      {' '}Alle bedragen hieronder gelden alleen voor de genoemde fysieke ingrediëntregel.
      {' '}Ook als de andere winkel al een volledig mandje heeft, verschijnt alleen een
      individueel verschil wanneer dezelfde hoeveelheid binnen 24 uur echt is bevestigd.</p>
    {paired.length > 0 && <div role="group" aria-label="Eigen deelprijsvergelijking exporteren">
      <p role="status">Voor {paired.length} fysieke {paired.length === 1 ? 'ingrediëntregel is' : 'ingrediëntregels zijn'}
        {' '}bij beide winkels gecontroleerde hele-pakprijzen bekend. Dit geeft nog geen
        vergelijking van het volledige weekmandje.</p>
      <button type="button" className="ghost-button" onClick={() => {
        try {
          const count = downloadPrivateKnownLinePriceCsv(progress, reviewed)
          setMessage(count + ' eigen vergelijkbare ingrediëntregels lokaal gedownload, zonder volledige mandclaim.')
        } catch {
          setMessage('De oorspronkelijke bronmomenten of producten zijn gewijzigd. Open Vergelijk en bekijk je eigen opnames opnieuw.')
        }
      }}>Download bekende PLUS/Deka-ingrediëntrijen (CSV)</button>
      <button type="button" className="ghost-button" onClick={() => {
        try {
          downloadPrivateKnownLinePricePrint(progress, reviewed)
          setMessage('Bekende eigen ingrediëntprijsverschillen lokaal afdrukbaar opgeslagen (HTML). Geen compleet winkelmandje.')
        } catch {
          setMessage('De oorspronkelijke bron is veranderd of verlopen. Open Vergelijk voor een nieuwe controle.')
        }
      }}>Offline afdrukbare deellijst (HTML)</button>
    </div>}
    <div className="private-reviewed-products__controls">
      <label>Winkel <select value={store}
        onChange={event => setStore(event.currentTarget.value as typeof store)}>
        <option value="both">Beide winkels</option>
        <option value="PLUS">PLUS</option>
        <option value="DekaMarkt">DekaMarkt</option>
      </select></label>
      <label>Eenheidsprijs <select value={unit}
        onChange={event => setUnit(event.currentTarget.value as Unit)}>
        <option value="all">Alle eenheden</option>
        <option value="kg">Per kilogram</option>
        <option value="liter">Per liter</option>
        <option value="stuk">Per stuk</option>
      </select></label>
      <label>Sorteer <select value={sort}
        onChange={event => setSort(event.currentTarget.value as Sort)}>
        <option value="source">Oorspronkelijke volgorde</option>
        <option value="unitPrice">Eenheidsprijs laag naar hoog</option>
        <option value="lineTotal">Hele-pakregeltotaal laag naar hoog</option>
        <option value="priceGap" disabled={paired.length === 0}>
          Grootste vergelijkbare regelverschil
        </option>
      </select></label>
      <label>Zoek eigen bronproduct <input type="search" maxLength={120}
        value={query} placeholder="Ingrediënt, SKU of productnaam"
        onChange={event => setQuery(event.currentTarget.value)} /></label>
    </div>
    <p role="status">{filtered.length} van {rows.length} echte bevestigde
      bronproductregels zichtbaar. Zoeken en sorteren wijzigen geen winkelbron.</p>
    <div className="private-reviewed-products__grid">
      {ordered.map(row => {
        const line = row.line
        const displayRate = rate(row)
        const comparison = pairById.get(line.ingredientId)
        const difference = comparison?.difference
        return <article key={JSON.stringify([row.store, row.observedAt,
          line.ingredientId, line.productId])}>
          <small>{row.store} · originele bron {row.observedAt}</small>
          <h3>{line.productName}</h3>
          <small>Originele SKU: {line.productId}</small>
          <p>{line.ingredientLabel}: {line.requiredAmount} {line.requiredUnit} nodig.</p>
          <p>{line.packagesNeeded} hele verpakkingen van {line.packCount} ×
            {' '}{line.packAmount} {line.packUnit}</p>
          <strong>{money.format(line.lineTotalCents / 100)}
            {' '}aan hele verpakkingen voor dit ingrediënt</strong>
          <small>{money.format(line.pricePerPackCents / 100)} per verpakking ·
            {' '}{displayRate ? formatPrivateUnitRate(displayRate) :
              'Eenheidsprijs onbekend'}</small>
          <small>{line.review === 'manual' ? 'Zelf bevestigd in de huidige bronreview' :
            'Automatisch toegelaten productmatch in de lokale bronreview'}</small>
          {comparison && difference !== undefined && <div
            className="private-reviewed-products__card-difference" role="note">
            <strong>Dezelfde fysieke hoeveelheid bij twee winkels</strong>
            <p><b>PLUS:</b> {comparison.plusProduct.productName} · SKU {comparison.plusProduct.productId}<br />
              {comparison.plusProduct.packCount} × {comparison.plusProduct.packAmount}
              {' '}{comparison.plusProduct.packUnit} per verpakking ·
              {' '}{comparison.plusProduct.unitRate ?? 'eenheidsprijs onbekend'}</p>
            <p><b>DekaMarkt:</b> {comparison.dekaProduct.productName} · SKU {comparison.dekaProduct.productId}<br />
              {comparison.dekaProduct.packCount} × {comparison.dekaProduct.packAmount}
              {' '}{comparison.dekaProduct.packUnit} per verpakking ·
              {' '}{comparison.dekaProduct.unitRate ?? 'eenheidsprijs onbekend'}</p>
            <p>PLUS · {comparison.plusPacks} hele pakken ·
              {' '}{money.format(comparison.plusCents / 100)}<br />
              DekaMarkt · {comparison.dekaPacks} hele pakken ·
              {' '}{money.format(comparison.dekaCents / 100)}</p>
            <strong>{difference === 0 ? 'Gelijke prijs voor dit ingrediënt.' :
              money.format(Math.abs(difference) / 100) +
              ' lagere hele-pakkosten bij ' +
              (difference > 0 ? 'PLUS' : 'DekaMarkt') + ' voor alleen deze regel.'}</strong>
            <small>Afzonderlijke echte SKU’s voor dezelfde hoeveelheid; merk en verpakking kunnen verschillen.
              Beide oorspronkelijke winkelmomenten maximaal 24 uur uiteen.
              {' '}{comparison.basis === 'complete-and-partial'
                ? 'Andere winkel volledig; deze winkel nog niet. ' : ''}
              Geen compleet mandverschil of onafhankelijke besparingsclaim.</small>
          </div>}
          <button type="button" onClick={() => review(row)}>
            Bekijk originele match of herzie bronproduct
          </button>
        </article>
      })}
    </div>
    {filtered.length === 0 && <p role="status">Geen bevestigde bronproducten
      voor deze selectie. Verwijder filters of open de bronreview.</p>}
    {message && <p role="status">{message}</p>}
    <button type="button" onClick={onOpenComparison}>
      Maak ontbrekende winkelproducten compleet in Vergelijk
    </button>
    <small>Privé bronprijzen uit jouw bestaande sessie, geen actuele winkelcatalogus,
      kassagarantie of onafhankelijk aangetoonde besparing. Nog niet gematchte
      ingrediënten hebben geen prijs en worden hier nooit € 0.</small>
  </section>
}
