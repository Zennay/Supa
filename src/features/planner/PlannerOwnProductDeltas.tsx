import { useState } from 'react'
import type { ComparedOwnLine } from './ownStoreBudgetComparison.ts'
import type { OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import './plannerPriceBreakdown.css'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type DifferenceFilter = 'all' | 'PLUS' | 'DekaMarkt' | 'equal'
type DifferenceSort = 'impact' | 'ingredient' | 'plus-price' | 'deka-price'

function PriceEvidence({ line }: { line: ComparedOwnLine['plus'] }) {
  return <>
    <strong>{euro.format(line.lineTotalCents / 100)}</strong>
    <small>{line.packs} × {line.productName} · SKU {line.productId}</small>
    <small>{line.pack.amount} {line.pack.unit} × {line.pack.count} per pak · {euro.format(line.pricePerPackCents / 100)} per pak</small>
    <small>{privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
  </>
}

/**
 * A local view over the already-approved same-demand canonical comparison.
 * Filtering and sorting must never change priced basket totals, store choice,
 * sources, original SKU reviews or the derived mixed-store route.
 */
export function PlannerOwnProductDeltas({ lines, onChooseLine }: {
  lines: ComparedOwnLine[]
  onChooseLine: (ingredientId: string, store: OwnStore) => void
}) {
  const [filter, setFilter] = useState<DifferenceFilter>('all')
  const [sort, setSort] = useState<DifferenceSort>('impact')
  const [query, setQuery] = useState('')
  if (!lines.length) return null

  const plusLower = lines.filter(line => line.deltaCents > 0).length
  const dekaLower = lines.filter(line => line.deltaCents < 0).length
  const tied = lines.length - plusLower - dekaLower
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('nl')
  const visibleLines = lines.filter(line => {
    if (filter === 'PLUS' && line.deltaCents <= 0) return false
    if (filter === 'DekaMarkt' && line.deltaCents >= 0) return false
    if (filter === 'equal' && line.deltaCents !== 0) return false
    if (!normalizedQuery) return true
    return [line.ingredientLabel, line.plus.productName, line.deka.productName,
      line.plus.productId, line.deka.productId]
      .some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(normalizedQuery))
  }).sort((a, b) => {
    if (sort === 'ingredient') return a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl')
    if (sort === 'plus-price') return b.plus.lineTotalCents - a.plus.lineTotalCents ||
      a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl')
    if (sort === 'deka-price') return b.deka.lineTotalCents - a.deka.lineTotalCents ||
      a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl')
    return Math.abs(b.deltaCents) - Math.abs(a.deltaCents) ||
      a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl')
  })

  function resetView() {
    setFilter('all')
    setQuery('')
    setSort('impact')
  }

  return <details className="own-store-planner__details">
    <summary>Bekijk {lines.length} productprijzen, verpakkingen en regelverschillen</summary>
    <p>Per ingrediënt het originele, persoonlijk gecontroleerde winkelproduct. Eenheidsprijzen
      zijn indicatief per kg, liter of stuk; de vergelijking rekent met hele verpakkingen.
      Filters en volgorde wijzigen jouw winkelmandje niet.</p>
    <div className="own-store-breakdown__overview" aria-label="Prijsverschillen per product">
      <span><strong>{plusLower}</strong> ingrediënten goedkoper bij PLUS</span>
      <span><strong>{dekaLower}</strong> ingrediënten goedkoper bij DekaMarkt</span>
      <span><strong>{tied}</strong> even duur</span>
    </div>
    <div className="own-store-breakdown__controls">
      <label>Zoek ingrediënt, bronproduct of SKU
        <input type="search" value={query} maxLength={120}
          placeholder="Bijvoorbeeld rijst of artikelnummer"
          onChange={event => setQuery(event.currentTarget.value)} />
      </label>
      <label>Toon prijsregels
        <select value={filter} onChange={event => setFilter(event.currentTarget.value as DifferenceFilter)}>
          <option value="all">Alle gecontroleerde regels ({lines.length})</option>
          <option value="PLUS">PLUS goedkoper ({plusLower})</option>
          <option value="DekaMarkt">DekaMarkt goedkoper ({dekaLower})</option>
          <option value="equal">Gelijke regelprijs ({tied})</option>
        </select>
      </label>
      <label>Sorteer
        <select value={sort} onChange={event => setSort(event.currentTarget.value as DifferenceSort)}>
          <option value="impact">Grootste absolute prijsverschil</option>
          <option value="ingredient">Ingrediënt A–Z</option>
          <option value="plus-price">Hoogste PLUS-regelprijs</option>
          <option value="deka-price">Hoogste DekaMarkt-regelprijs</option>
        </select>
      </label>
    </div>
    <p className="own-store-breakdown__count" role="status" aria-live="polite">
      {visibleLines.length} van {lines.length} gecontroleerde ingrediënten zichtbaar.
      {visibleLines.length < lines.length ? ' De volledige mandtotalen hierboven blijven ongewijzigd.' : ''}
    </p>
    {visibleLines.length > 0
      ? <>
        <div className="own-store-planner__scroll" role="region"
          aria-label="Eigen productprijzen per winkel" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Ingrediënt</th><th scope="col">PLUS</th>
              <th scope="col">DekaMarkt</th><th scope="col">Verschil</th></tr></thead>
            <tbody>{visibleLines.map(item => <tr key={item.id}>
              <th scope="row">{item.ingredientLabel}</th>
              {([item.plus, item.deka] as const).map((line, index) =>
                <td key={index}><PriceEvidence line={line} /></td>)}
              <td><strong>{item.deltaCents === 0 ? 'Gelijk' : euro.format(Math.abs(item.deltaCents) / 100)}</strong>
                <small>{item.deltaCents > 0 ? 'PLUS lager' : item.deltaCents < 0 ? 'DekaMarkt lager' : 'Geen verschil'}</small>
                <div className="own-store-planner__line-actions" aria-label={'Kies winkel voor ' + item.ingredientLabel}>
                  <button type="button" onClick={() => onChooseLine(item.id, 'PLUS')}>Kies PLUS</button>
                  <button type="button" onClick={() => onChooseLine(item.id, 'DekaMarkt')}>Kies DekaMarkt</button>
                </div>
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="own-store-breakdown__mobile" aria-label="Mobiele productprijsvergelijking">
          {visibleLines.map(item => <article className="own-store-breakdown__mobile-card" key={item.id}>
            <h4>{item.ingredientLabel}</h4>
            <div className="own-store-breakdown__mobile-shops">
              <section aria-label={'PLUS voor ' + item.ingredientLabel}>
                <h5>PLUS</h5><PriceEvidence line={item.plus} />
              </section>
              <section aria-label={'DekaMarkt voor ' + item.ingredientLabel}>
                <h5>DekaMarkt</h5><PriceEvidence line={item.deka} />
              </section>
            </div>
            <p className="own-store-breakdown__mobile-difference">
              <strong>{item.deltaCents === 0 ? 'Gelijke regelprijs' :
                euro.format(Math.abs(item.deltaCents) / 100) + ' lager bij ' +
                (item.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')}</strong>
              {' '}voor dezelfde gecontroleerde fysieke behoefte.
            </p>
            <div className="own-store-planner__line-actions" aria-label={'Kies winkel voor ' + item.ingredientLabel}>
              <button type="button" onClick={() => onChooseLine(item.id, 'PLUS')}>Kies PLUS</button>
              <button type="button" onClick={() => onChooseLine(item.id, 'DekaMarkt')}>Kies DekaMarkt</button>
            </div>
          </article>)}
        </div>
      </>
      : <div className="own-store-breakdown__empty" role="status">
          <p>Geen gecontroleerde productregels met deze zoekopdracht en dit filter.</p>
          <button type="button" className="ghost-button" onClick={resetView}>Toon alle productprijzen</button>
        </div>}
  </details>
}
