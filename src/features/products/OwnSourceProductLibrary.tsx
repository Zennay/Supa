import { useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import { privatePackUnitRate } from '../comparison/privateUnitPrice.ts'
import './ownSourceProductLibrary.css'
type Shop = 'PLUS' | 'DekaMarkt'
const shops: Shop[] = ['PLUS', 'DekaMarkt']
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const date = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
/** Read-only source catalog. Only caller-admitted private data; never infer prices. */
export function OwnSourceProductLibrary({ source, baskets, nowMs, onCompare, onList }: {
  source: OfflinePriceSnapshots | null
  baskets: { plus: OneStoreBasket; deka: OneStoreBasket } | null
  nowMs: number; onCompare: () => void; onList: (shop: Shop) => void
}) {
  const [selected, setSelected] = useState<'all' | Shop>('all')
  const [search, setSearch] = useState('')
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [sort, setSort] = useState<'source' | 'name' | 'unit'>('source')
  const rows = useMemo(() => !source ? [] : shops.flatMap(shop => {
    const basket = shop === 'PLUS' ? baskets?.plus : baskets?.deka
    return source.captures[shop].products.map((item, index) => ({
      shop, item, index,
      uses: basket?.lines.filter(line => line.status === 'matched' &&
        line.productId === item.id).map(line => line.ingredientLabel) ?? [],
    }))
  }), [source, baskets])
  if (!source) return <section className="own-products">
    <h2>Mijn eigen winkelproducten</h2>
    <p>Er zijn nog geen geautoriseerd ingevoerde persoonlijke winkelproducten.
      De overige kaarten zijn ontwerpvoorbeelden, geen actuele prijzen.</p>
    <button type="button" onClick={onCompare}>Eigen bron invoeren</button>
  </section>
  const recent = (shop: Shop) => {
    const delta = BigInt(Math.trunc(nowMs)) * 1_000_000n -
      source.captures[shop].observedNs
    return delta >= -300_000_000_000n && delta <= 604_800_000_000_000n
  }
  const unitRate = (item: typeof rows[number]['item']) => item.available
    ? privatePackUnitRate({ amount: item.packAmount, unit: item.packUnit,
      count: item.packCount ?? 1, priceCents: item.priceCents }) : null
  const term = search.trim().toLocaleLowerCase('nl-NL')
  const found = rows.filter(row => (selected === 'all' || selected === row.shop) &&
    (!linkedOnly || row.uses.length > 0) &&
    (!term || [row.shop, row.item.id, row.item.name, ...row.uses]
      .some(s => s.toLocaleLowerCase('nl-NL').includes(term))))
  if (sort !== 'source') found.sort((a, b) => {
    if (sort === 'name') return a.item.name.localeCompare(b.item.name, 'nl-NL')
    const first = unitRate(a.item), second = unitRate(b.item)
    const group: Record<string, number> = { kg: 0, liter: 1, stuk: 2 }
    return (first ? group[first.unit] : 3) - (second ? group[second.unit] : 3) ||
      (first?.centsPerUnit ?? Infinity) - (second?.centsPerUnit ?? Infinity) ||
      a.item.name.localeCompare(b.item.name, 'nl-NL')
  })
  const visible = found.slice(0, 150)
  return <section className="own-products" aria-label="Mijn eigen winkelproducten">
    <h2>Mijn eigen winkelproducten</h2>
    <p>Alleen eigen bronartikelen. Geen live winkelprijzen, kassagarantie of onafhankelijk
      besparingsbewijs. Koppel originele SKU's afzonderlijk aan je weekmenu.</p>
    <div className="own-products__sources">{shops.map(shop => <section key={shop}>
      <h3>{shop}</h3><small>{source.captures[shop].products.length} artikelen ·
        eigen opname {date.format(new Date(source.captures[shop].observedMs))}</small>
      {!recent(shop) && <p role="status">Bron verouderd: historische prijzen.</p>}
      <button type="button" onClick={() => onList(shop)}>Open mijn {shop}-lijst</button>
    </section>)}</div>
    <div className="own-products__filters">
      <label>Winkel<select value={selected} onChange={e =>
        setSelected(e.target.value as typeof selected)}>
        <option value="all">Beide winkels</option>
        {shops.map(shop => <option key={shop}>{shop}</option>)}
      </select></label>
      <label>Zoek<input type="search" maxLength={100} value={search}
        placeholder="Naam, SKU, ingrediënt" onChange={e => setSearch(e.target.value)} /></label>
      <label>Sorteer<select value={sort} onChange={e =>
        setSort(e.target.value as typeof sort)}>
        <option value="source">Bronvolgorde</option><option value="name">Naam</option>
        <option value="unit">Eenheidsprijs per eenheid gegroepeerd</option>
      </select></label>
      <label className="own-products__checkbox"><input type="checkbox"
        checked={linkedOnly} onChange={e => setLinkedOnly(e.target.checked)} />
        Alleen gekoppelde producten</label>
    </div>
    <p role="status">{found.length} van {rows.length} bronartikelen.
      {found.length > visible.length ? ' Eerste 150 getoond: zoek gerichter.' : ''}
      {' '}Kg, liter en stuk worden niet onderling op prijs gesorteerd.</p>
    <div className="own-products__grid">{visible.map(({ shop, item, index, uses }) => {
      const rate = unitRate(item)
      const known = item.available && item.packAmount !== null &&
        Number.isSafeInteger(item.priceCents) && item.priceCents >= 0
      return <article key={shop + ':' + index}>
        <small>{shop} · SKU {item.id}</small><h3>{item.name}</h3>
        <p>Verpakking: {item.packAmount ?? 'onbekend'} {item.packUnit}
          {' '}× {item.packCount ?? 1}</p>
        <strong>{known ? (recent(shop) ? '' : 'Historisch: ') +
          money.format(item.priceCents / 100) + ' per verpakking' :
          'Prijs of beschikbaarheid onbekend'}</strong>
        <small>{rate ? money.format(rate.centsPerUnit / 100) +
          ' / ' + rate.unit : 'Eenheidsprijs onbekend'}</small>
        <p>{uses.length ? 'Gekoppeld aan: ' + uses.join(', ') :
          'Nog niet aan het huidige weekmenu gekoppeld.'}</p>
      </article>
    })}</div>
    {!visible.length && <p>Geen eigen productregels voor deze selectie.</p>}
    <button type="button" onClick={onCompare}>Open bronimport en productmatching</button>
  </section>
}
