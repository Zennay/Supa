import { useEffect, useMemo, useState } from 'react'
import './RetailerSearchView.css'

export type RetailerPriceHit = {
  supermarket: string
  supermarketName: string
  name: string
  brand: string | null
  pack: string | null
  priceCents: number
  regularPriceCents: number
  offer: boolean
  observedAt: string
  sourceUrl: string
  availability: 'available'
}
type ResponseBody = {
  results?: RetailerPriceHit[]
  availability?: string
  error?: string
}
const euro = new Intl.NumberFormat('nl-NL', {
  style: 'currency', currency: 'EUR',
})
const formatTime = (value: string) => new Date(value).toLocaleString('nl-NL', {
  dateStyle: 'short', timeStyle: 'short',
})
function validHit(row: unknown): row is RetailerPriceHit {
  if (!row || typeof row !== 'object') return false
  const p = row as Partial<RetailerPriceHit>
  return typeof p.name === 'string' && p.name.length <= 200 &&
    typeof p.supermarket === 'string' &&
    typeof p.supermarketName === 'string' &&
    typeof p.observedAt === 'string' &&
    typeof p.sourceUrl === 'string' && /^https:\/\//.test(p.sourceUrl) &&
    Number.isSafeInteger(p.priceCents) && Number(p.priceCents) > 0 &&
    Number.isSafeInteger(p.regularPriceCents) &&
    p.availability === 'available' &&
    Number.isFinite(Date.parse(p.observedAt))
}

export function RetailerSearchView() {
  const [query, setQuery] = useState('')
  const [store, setStore] = useState('all')
  const [hits, setHits] = useState<RetailerPriceHit[]>([])
  const [status, setStatus] = useState<'idle'|'searching'|'ready'|'empty'|'error'|'disabled'>('idle')
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    setStatus('searching')
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/retailer-products?q=' + encodeURIComponent(query.trim()),
          { signal:controller.signal, credentials:'omit', cache:'no-store' })
        if (!res.ok) throw Error('price service unavailable')
        const data = await res.json() as ResponseBody
        if (!Array.isArray(data.results)) throw Error('invalid source response')
        const incoming = data.results.slice(0,40).filter(validHit)
        setHits(incoming)
        setStatus(data.availability === 'sources-not-approved'
          ? 'disabled' : incoming.length ? 'ready' : 'empty')
      } catch {
        if (!controller.signal.aborted) {
          setHits([])
          setStatus('error')
        }
      }
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])

  const stores = useMemo(() =>
    [...new Map(hits.map(hit => [hit.supermarket,hit.supermarketName])).entries()]
      .sort((a,b)=>a[1].localeCompare(b[1],'nl')), [hits])
  const visible = useMemo(() => hits.filter(hit =>
    store === 'all' || hit.supermarket === store).filter(hit => {
      const age = clock - Date.parse(hit.observedAt)
      return age >= 0 && age <= 24*3600_000
    }), [hits,store,clock])
  return (
    <section className="screen retailer-search" aria-label="Supermarktprijzen zoeken">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SUPA · Productzoeker</span>
          <h2>Zoek supermarktprijzen</h2>
        </div>
      </div>
      <p className="disclaimer">
        Alleen waargenomen online prijzen van de afgelopen 24 uur.
        Winkelprijzen kunnen verschillen; dit is geen gegarandeerde besparing.
      </p>
      <label className="search-label" htmlFor="retailer-product-search">Zoek een product</label>
      <input id="retailer-product-search" type="search"
        placeholder="Bijvoorbeeld rijst, kip of melk"
        autoComplete="off" value={query} maxLength={80}
        onChange={e => { setQuery(e.target.value); setStore('all') }}
      />
      {stores.length > 1 && (
        <label className="search-label" htmlFor="retailer-search-store">
          Supermarkt
          <select id="retailer-search-store" value={store}
            onChange={e=>setStore(e.target.value)}>
            <option value="all">Alle beschikbare supermarkten</option>
            {stores.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      )}
      <p aria-live="polite" role="status" className="search-status">
        {status === 'idle' && 'Typ minimaal twee letters om te zoeken.'}
        {status === 'searching' && 'Prijzen opzoeken…'}
        {status === 'empty' && 'Geen recente prijzen gevonden voor dit product.'}
        {status === 'disabled' && 'Er zijn nog geen goedgekeurde actuele supermarktbronnen beschikbaar.'}
        {status === 'error' && 'Actuele prijzen zijn nu niet bereikbaar. Geen voorbeeldprijzen getoond.'}
        {status === 'ready' && visible.length === 0 && 'Geen prijzen van maximaal 24 uur oud beschikbaar.'}
        {status === 'ready' && visible.length > 0 && visible.length + ' recente prijsvermeldingen.'}
      </p>
      <div className="search-results" aria-label="Actuele supermarktprijsresultaten">
        {visible.map((hit,i) => (
          <article className="search-result" key={hit.supermarket+'-'+hit.sourceUrl+'-'+i}>
            <div className="search-result-heading">
              <div>
                <strong>{hit.name}</strong>
                <small>{hit.supermarketName}{hit.pack ? ' · '+hit.pack : ''}</small>
              </div>
              <span className="search-result-price">{euro.format(hit.priceCents / 100)}</span>
            </div>
            <div className="search-result-bottom">
              <small>{hit.offer ? 'Aanbiedingsprijs · ' : ''}Gecontroleerd: {formatTime(hit.observedAt)}</small>
              <a href={hit.sourceUrl} target="_blank" rel="noopener noreferrer">
                Bekijk bron
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
