import { useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import type { OwnStore, PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import './privateReviewedProductCatalog.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Read-only personally reviewed basket sources, never an inferred live catalog. */
export function PrivateReviewedProductCatalog({ reviewed, onOpenComparison, onOpenList }: {
  reviewed: PrivateReviewedBaskets | null
  onOpenComparison: () => void
  onOpenList: (store?: OwnStore) => void
}) {
  const [store, setStore] = useState<'all' | OwnStore>('all')
  const [query, setQuery] = useState('')
  const sources = shops.flatMap(shop => {
    const capture = reviewed?.stores[shop]
    return capture ? capture.basket.lines.filter((line): line is Matched => line.status === 'matched')
      .map(line => ({ shop, line, observedAt: capture.observedAt })) : []
  })
  const search = query.trim().toLocaleLowerCase('nl')
  const visible = sources.filter(row => (store === 'all' || row.shop === store) &&
    (!search || [row.line.productName, row.line.productId, row.line.ingredientLabel]
      .some(value => value.toLocaleLowerCase('nl').includes(search))))
  return <section className="private-reviewed-products" aria-label="Mijn persoonlijk gecontroleerde winkelproducten">
    <h2>Mijn echte bronartikelen voor dit weekmenu</h2>
    <p>Alleen jouw zelf gecontroleerde productregels, geen actuele winkelcatalogus of kassagarantie.
      Historische ontwerpvoorbeelden elders op de pagina tellen niet mee.</p>
    {!sources.length ? <p role="status">Nog geen complete en actuele eigen bronproducten beschikbaar.
      Kies een weekmenu, importeer je eigen winkelbron en controleer iedere SKU en verpakking.</p> : <>
      <div className="private-reviewed-products__controls">
        <label>Winkel <select value={store} onChange={event => setStore(event.target.value as 'all' | OwnStore)}>
          <option value="all">Beide winkels</option>
          {shops.map(shop => <option value={shop} key={shop}>{shop}</option>)}
        </select></label>
        <label>Zoek eigen product <input type="search" value={query}
          onChange={event => setQuery(event.target.value)} placeholder="Product, SKU of ingrediënt" /></label>
      </div>
      <p role="status">{visible.length} van {sources.length} bevestigde productregels.</p>
      <div className="private-reviewed-products__grid">{visible.map(({ shop, line, observedAt }) => <article
        key={JSON.stringify([shop, line.id, line.productId])}>
        <small>{shop} · opname {observedAt}</small><h3>{line.productName}</h3>
        <small>Broncode {line.productId}</small>
        <p>{line.ingredientLabel}: {line.requirement.amount} {line.requirement.unit} nodig.</p>
        <p>{line.packs} × verpakking van {line.pack.count} × {line.pack.amount} {line.pack.unit}</p>
        <strong>{money.format(line.lineTotalCents / 100)} voor de week</strong>
        <small>{money.format(line.pricePerPackCents / 100)} per verpakking · {privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
      </article>)}</div>
      {!visible.length && <p>Geen producten gevonden voor deze selectie.</p>}
      <button type="button" onClick={() => onOpenList(store === 'all' ? undefined : store)}>
        {store === 'all' ? 'Open mijn gecontroleerde boodschappenlijst' : `Open mijn ${store}-boodschappenlijst`}
      </button>
    </>}
    <button type="button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    <small>Ontbrekende of verlopen bronproducten krijgen nooit een verzonnen prijs.</small>
  </section>
}
