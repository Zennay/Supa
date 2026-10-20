import { useMemo, useState } from 'react'
import source from '../../../docs/product/m3-issue78-exploratory-listing-basket-2026-10-17.json'
import { euro } from '../../lib/money'
import { PrivateManualShareText } from '../products/PrivateManualShareText.tsx'
import './listingBasketPreview.css'

type StoreKey = 'plus' | 'dekamarkt'
type PriceFilter = 'all' | 'plus' | 'dekamarkt' | 'same'
type PriceLine = (typeof source.lines)[number]

function priceWinner(line: PriceLine): Exclude<PriceFilter, 'all'> {
  const difference = line.dekamarkt.listingBasketLineTotalCents - line.plus.listingBasketLineTotalCents
  return difference > 0 ? 'plus' : difference < 0 ? 'dekamarkt' : 'same'
}

function storeCard(line: PriceLine, store: StoreKey) {
  const item = line[store]
  const name = store === 'plus' ? 'PLUS' : 'DekaMarkt'
  return (
    <div className="listing-basket__store" key={store}>
      <span className="listing-basket__store-name">{name}</span>
      <strong>{euro.formatCents(item.listingBasketLineTotalCents)}</strong>
      <small>{item.referencePackText} · {euro.formatCents(item.listingPricePerPackCents)} per verpakking</small>
      <a href={item.referenceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Bekijk bron voor ${line.canonicalDemandLabel} bij ${name}`}>
        Productbron <span aria-hidden="true">↗</span>
      </a>
    </div>
  )
}

/**
 * Fixed research comparison; deliberately independent of the live plan, M3
 * observed-basket intake and any proof or source-permission status.
 */
export function ListingBasketPreview() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PriceFilter>('all')
  const [sort, setSort] = useState<'original' | 'difference'>('original')
  const [copyText, setCopyText] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState('')

  const listing = source.lines
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('nl-NL')
    const selected = listing.filter(line =>
      (!needle || line.canonicalDemandLabel.toLocaleLowerCase('nl-NL').includes(needle)) &&
      (filter === 'all' || priceWinner(line) === filter),
    )
    return sort === 'difference'
      ? [...selected].sort((a, b) =>
          Math.abs(b.dekamarkt.listingBasketLineTotalCents - b.plus.listingBasketLineTotalCents) -
          Math.abs(a.dekamarkt.listingBasketLineTotalCents - a.plus.listingBasketLineTotalCents))
      : selected
  }, [query, filter, sort, listing])

  const baseline = listing.reduce((total, line) => total + line.plus.listingBasketLineTotalCents, 0)
  const candidate = listing.reduce((total, line) => total + line.dekamarkt.listingBasketLineTotalCents, 0)
  const delta = candidate - baseline
  const cheapStore = delta >= 0 ? 'PLUS' : 'DekaMarkt'

  function makeListText() {
    return [
      'SUPA — PLUS / DekaMarkt · bewaarde vergelijking',
      ...listing.map(line => [
        line.canonicalDemandLabel,
        `PLUS ${line.plus.referencePackText}: ${euro.formatCents(line.plus.listingBasketLineTotalCents)}`,
        `DekaMarkt ${line.dekamarkt.referencePackText}: ${euro.formatCents(line.dekamarkt.listingBasketLineTotalCents)}`,
      ].join(' | ')),
      `Totaal PLUS: ${euro.formatCents(baseline)}`,
      `Totaal DekaMarkt: ${euro.formatCents(candidate)}`,
      'Referentie 17 oktober 2026 — bedragen per gekozen hele verpakkingen',
    ].join('\n')
  }

  function showCopyList() {
    // Explicit user-controlled selection, never a privileged clipboard
    // write. The fixed research snapshot remains distinct from live prices.
    setCopyText(makeListText())
    setCopyStatus('Selecteer hieronder de tekst en kies zelf Kopieer op je apparaat.')
  }

  return (
    <section className="listing-basket" aria-labelledby="listing-basket-title">
      <header>
        <span className="eyebrow">PLUS tegenover DekaMarkt</span>
        <h2 id="listing-basket-title">Boodschappen vergelijken</h2>
        <p>Dezelfde 11 boodschappen, met de 22 bewaarde productkeuzes. Bekijk bedragen per volledige verpakking en open de oorspronkelijke producten.</p>
      </header>

      <div className="listing-basket__totals" aria-label="Resultaat van het bewaarde boodschappenmandje">
        <div><span>PLUS</span><strong>{euro.formatCents(baseline)}</strong></div>
        <div><span>DekaMarkt</span><strong>{euro.formatCents(candidate)}</strong></div>
      </div>
      <p className="listing-basket__difference" role="status">
        <strong>{delta === 0 ? 'Beide winkels zijn even duur' : `${cheapStore} is ${euro.formatCents(Math.abs(delta))} goedkoper`}</strong>
        <span>voor precies deze geselecteerde verpakkingen</span>
      </p>
      <div className="listing-basket__share">
        <button type="button" onClick={showCopyList}>Toon complete vergelijking om zelf te kopiëren</button>
        {copyStatus && <p role="status">{copyStatus}</p>}
        {copyText !== null && <PrivateManualShareText
          text={copyText} label="Bewaarde PLUS en DekaMarkt vergelijking" />}
      </div>
      <p className="listing-basket__source-note">
        Bewaarde prijsvergelijking van 17 oktober 2026. Geen automatische actuele winkelprijzen;
        niet gekoppeld aan je persoonlijke weekmenu. Verpakkingsgroottes en varianten kunnen verschillen.
      </p>

      <div className="listing-basket__controls">
        <label>
          <span>Zoek product</span>
          <input type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)}
            placeholder="Bijv. broccoli" />
        </label>
        <label>
          <span>Toon</span>
          <select value={filter} onChange={event => setFilter(event.target.value as PriceFilter)}>
            <option value="all">Alle producten</option>
            <option value="plus">PLUS goedkoper</option>
            <option value="dekamarkt">DekaMarkt goedkoper</option>
            <option value="same">Zelfde prijs</option>
          </select>
        </label>
        <label>
          <span>Sorteer</span>
          <select value={sort} onChange={event => setSort(event.target.value as 'original' | 'difference')}>
            <option value="original">Boodschappenlijst</option>
            <option value="difference">Grootste prijsverschil</option>
          </select>
        </label>
      </div>

      <div className="listing-basket__results" aria-live="polite">
        {rows.length} van {listing.length} producten
      </div>
      <div className="listing-basket__lines">
        {rows.map(line => (
          <article className="listing-basket__line" key={line.line}>
            <div className="listing-basket__line-head">
              <h3>{line.canonicalDemandLabel}</h3>
              <span>{priceWinner(line) === 'same'
                ? 'Gelijke prijs'
                : `${priceWinner(line) === 'plus' ? 'PLUS' : 'DekaMarkt'} ${euro.formatCents(Math.abs(line.dekamarkt.listingBasketLineTotalCents - line.plus.listingBasketLineTotalCents))} goedkoper`}</span>
            </div>
            <div className="listing-basket__pair">
              {storeCard(line, 'plus')}
              {storeCard(line, 'dekamarkt')}
            </div>
            {line.sourceCaution && <p className="listing-basket__caution">{line.sourceCaution}</p>}
          </article>
        ))}
        {rows.length === 0 && <p className="listing-basket__empty">Geen overeenkomende producten. Pas het filter of zoekwoord aan.</p>}
      </div>
    </section>
  )
}
