import { useState } from 'react'
import type { ComparedOwnLine } from './ownStoreBudgetComparison.ts'
import type { OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { privatePackUnitRate, privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import './plannerPriceBreakdown.css'

import { euro as exactEuro } from '../../lib/money.ts'
type DifferenceFilter = 'all' | 'PLUS' | 'DekaMarkt' | 'equal' | 'unit-PLUS' | 'unit-DekaMarkt'
type DifferenceSort = 'impact' | 'unit-gap' | 'ingredient' | 'plus-price' | 'deka-price'

function PriceEvidence({ line }: { line: ComparedOwnLine['plus'] }) {
  return <>
    <strong>{exactEuro.formatCents(line.lineTotalCents)}</strong>
    <small>{line.packs} × {line.productName} · SKU {line.productId}</small>
    <small>{line.pack.amount} {line.pack.unit} × {line.pack.count} per pak · {exactEuro.formatCents(line.pricePerPackCents)} per pak</small>
    <small>{privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
  </>
}

function unitPriceGap(item: ComparedOwnLine): {
  unit: 'kg' | 'liter' | 'stuk'
  differenceMilliCents: number
  roundedDifferenceCents: number
  cheaper: 'PLUS' | 'DekaMarkt' | null
} | null {
  const makeRate = (line: ComparedOwnLine['plus']) => privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit,
    count: line.pack.count, priceCents: line.pricePerPackCents,
  })
  const plus = makeRate(item.plus)
  const deka = makeRate(item.deka)
  if (!plus || !deka || plus.unit !== deka.unit) return null
  const difference = deka.milliCentsPerUnit - plus.milliCentsPerUnit
  return {
    unit: plus.unit,
    differenceMilliCents: Math.abs(difference),
    // Round the DIFFERENCE once, not two separately rounded unit prices.
    // Two rates that round €0.01 apart can actually differ by <€0.005.
    roundedDifferenceCents: Math.floor((Math.abs(difference) + 500) / 1000),
    cheaper: difference > 0 ? 'PLUS' : difference < 0 ? 'DekaMarkt' : null,
  }
}

function UnitPriceGap({ item }: { item: ComparedOwnLine }) {
  const gap = unitPriceGap(item)
  if (!gap) return <small>Eenheidsprijsverschil onbekend</small>
  return <small>{gap.cheaper === null
    ? 'Gelijke eenheidsprijs'
    : gap.roundedDifferenceCents === 0
      ? 'Eenheidsprijzen afgerond gelijk; klein verschil bij ' + gap.cheaper
      : exactEuro.formatCents(gap.roundedDifferenceCents) + ' / ' + gap.unit +
        ' lagere eenheidsprijs bij ' + gap.cheaper}
    {' '}· alleen productadvies, geen mandbesparing
  </small>
}

/**
 * A local view over the already-approved same-demand canonical comparison.
 * Filtering and sorting must never change priced basket totals, store choice,
 * sources, original SKU reviews or the derived mixed-store route.
 */
export function PlannerOwnProductDeltas({ lines, onChooseLine, onExportSelection }: {
  lines: ComparedOwnLine[]
  onChooseLine: (ingredientId: string, store: OwnStore) => void
  onExportSelection: (ingredientIds: string[], action: 'download' | 'copy') => void
}) {
  const [filter, setFilter] = useState<DifferenceFilter>('all')
  const [unitFamily, setUnitFamily] = useState<'all' | 'kg' | 'liter' | 'stuk'>('all')
  const [sort, setSort] = useState<DifferenceSort>('impact')
  const [query, setQuery] = useState('')
  // A typical eleven-ingredient field basket should show its real product
  // comparison immediately; larger lists remain collapsible by default.
  const [expanded, setExpanded] = useState(lines.length <= 12)
  if (!lines.length) return null

  const plusLower = lines.filter(line => line.deltaCents > 0).length
  const dekaLower = lines.filter(line => line.deltaCents < 0).length
  const tied = lines.length - plusLower - dekaLower
  const unitPlusLower = lines.filter(line => unitPriceGap(line)?.cheaper === 'PLUS').length
  const unitDekaLower = lines.filter(line => unitPriceGap(line)?.cheaper === 'DekaMarkt').length
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('nl')
  const unitCounts = { kg: 0, liter: 0, stuk: 0 }
  for (const line of lines) {
    const rate = unitPriceGap(line)
    if (rate) unitCounts[rate.unit]++
  }
  const visibleLines = lines.filter(line => {
    if (unitFamily !== 'all' && unitPriceGap(line)?.unit !== unitFamily) return false
    if (filter === 'PLUS' && line.deltaCents <= 0) return false
    if (filter === 'DekaMarkt' && line.deltaCents >= 0) return false
    if (filter === 'equal' && line.deltaCents !== 0) return false
    if (filter === 'unit-PLUS' && unitPriceGap(line)?.cheaper !== 'PLUS') return false
    if (filter === 'unit-DekaMarkt' && unitPriceGap(line)?.cheaper !== 'DekaMarkt') return false
    if (!normalizedQuery) return true
    return [line.ingredientLabel, line.plus.productName, line.deka.productName,
      line.plus.productId, line.deka.productId]
      .some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(normalizedQuery))
  }).sort((a, b) => {
    if (sort === 'unit-gap') {
      const left = unitPriceGap(a)
      const right = unitPriceGap(b)
      // €/kg, €/liter and €/stuk measure different things: never rank
      // an unrelated family as if it were the same physical measure.
      if (unitFamily === 'all' && left && right && left.unit !== right.unit)
        return left.unit.localeCompare(right.unit, 'nl')
      if (left && right && left.differenceMilliCents !== right.differenceMilliCents)
        return right.differenceMilliCents - left.differenceMilliCents
      if (!left && right) return 1
      if (left && !right) return -1
    }
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
    setUnitFamily('all')
    setQuery('')
    setSort('impact')
  }

  return <details className="own-store-planner__details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Bekijk {lines.length} productprijzen, verpakkingen en regelverschillen</summary>
    <p>Per ingrediënt het originele, persoonlijk gecontroleerde winkelproduct. Eenheidsprijzen
      zijn indicatief per kg, liter of stuk; de vergelijking rekent met hele verpakkingen.
      Je kunt zowel op hele-verpakkingenregelprijs als op indicatieve eenheidsprijs zoeken,
      filteren en sorteren. Alleen hele verpakkingen tellen mee voor de werkelijke manduitkomst;
      filters en volgorde wijzigen de mand niet. Bij sortering op eenheidsverschil
      worden kg, liter en stuks apart gegroepeerd; je kunt één fysieke eenheid kiezen.</p>
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
          <option value="unit-PLUS">Lagere eenheidsprijs bij PLUS ({unitPlusLower})</option>
          <option value="unit-DekaMarkt">Lagere eenheidsprijs bij DekaMarkt ({unitDekaLower})</option>
        </select>
      </label>
      <label>Eenheid vergelijken
        <select value={unitFamily} onChange={event => setUnitFamily(event.currentTarget.value as typeof unitFamily)}>
          <option value="all">Alle eenheden (apart gegroepeerd)</option>
          <option value="kg">Alleen per kg ({unitCounts.kg})</option>
          <option value="liter">Alleen per liter ({unitCounts.liter})</option>
          <option value="stuk">Alleen per stuk ({unitCounts.stuk})</option>
        </select>
      </label>
      <label>Sorteer
        <select value={sort} onChange={event => setSort(event.currentTarget.value as DifferenceSort)}>
          <option value="impact">Grootste absolute prijsverschil</option>
          <option value="unit-gap">Grootste verschil per kg, liter of stuk</option>
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
    <div className="own-store-breakdown__export">
      <button type="button" className="ghost-button"
        disabled={visibleLines.length === 0}
        onClick={() => onExportSelection(visibleLines.map(line => line.id), 'download')}>
        Bewaar deze {visibleLines.length} prijsregels als privé-TXT
      </button>
      <button type="button" className="ghost-button"
        disabled={visibleLines.length === 0}
        onClick={() => onExportSelection(visibleLines.map(line => line.id), 'copy')}>
        Kopieer deze {visibleLines.length} privéprijsregels
      </button>
      <small>Bevat alleen de zichtbare, bevestigde productregels en bronmomenten; geen volledig mandtotaal.</small>
    </div>
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
              <td><strong>{item.deltaCents === 0 ? 'Gelijk' : exactEuro.formatCents(Math.abs(item.deltaCents))}</strong>
                <small>{item.deltaCents > 0 ? 'PLUS lager' : item.deltaCents < 0 ? 'DekaMarkt lager' : 'Geen verschil'}</small>
                <UnitPriceGap item={item} />
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
                exactEuro.formatCents(Math.abs(item.deltaCents)) + ' lager bij ' +
                (item.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')}</strong>
              {' '}voor dezelfde gecontroleerde fysieke behoefte.
              <UnitPriceGap item={item} />
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
