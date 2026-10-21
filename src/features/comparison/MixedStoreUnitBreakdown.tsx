import { useState } from 'react'
import { euro as exactEuro } from '../../lib/money.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'
import type { MixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Purely presentational readout of the SAME source-admitted baskets already
 * checked for complete, personally reviewed physical demand by the parent.
 * The per-unit amount is explanatory; the route uses whole-package totals.
 */
export function MixedStoreUnitBreakdown({
  plus, deka, route,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  route: MixedStoreShoppingPlan
}) {
  const ownMatched = (basket: OneStoreBasket) =>
    new Map(basket.lines.filter((line): line is Matched =>
      line.status === 'matched').map(line => [line.id, line]))
  const plusLines = ownMatched(plus)
  const dekaLines = ownMatched(deka)
  const [sortBy, setSortBy] = useState<'planner' | 'biggest-difference'>('planner')
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const comparisons = route.lines.flatMap((chosen, index) => {
    const p = plusLines.get(chosen.id)
    const d = dekaLines.get(chosen.id)
    return p && d ? [{
      chosen, p, d, index,
      difference: Math.abs(p.lineTotalCents - d.lineTotalCents),
    }] : []
  })
  const distinct = comparisons.filter(item => item.difference > 0).length
  const filtered = onlyDifferences
    ? comparisons.filter(item => item.difference > 0) : comparisons
  const visible = sortBy === 'biggest-difference'
    ? [...filtered].sort((a, b) => b.difference - a.difference || a.index - b.index)
    : filtered
  return <details className="offline-price-workbench__full-breakdown mixed-store-route__unit-breakdown">
    <summary>Vergelijk per ingrediënt de twee echte producten, eenheidsprijzen en pakbedragen</summary>
    <p>De eenheidsprijs is alleen indicatief per kilogram, liter of stuk.
      De goedkoopste winkel voor jouw week wordt gekozen op het werkelijk benodigde
      <strong> aantal hele verpakkingen</strong> en bijbehorende regelbedrag.
      Een lagere prijs per kilo maakt een grotere verpakking niet automatisch
      goedkoper voor jouw benodigde hoeveelheid.</p>
    <div className="mixed-store-route__unit-controls" role="group"
      aria-label="Toon en sorteer vergeleken bronproducten">
      <label>Sorteer de prijsverschillen
        <select value={sortBy} onChange={event =>
          setSortBy(event.currentTarget.value as 'planner' | 'biggest-difference')}>
          <option value="planner">Volgorde van mijn Planner</option>
          <option value="biggest-difference">Grootste prijsverschil eerst</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={onlyDifferences}
          onChange={event => setOnlyDifferences(event.currentTarget.checked)} />
        Toon alleen ingrediënten met een prijsverschil
      </label>
      <p role="status">{distinct} van {comparisons.length} ingrediënten hebben
        een verschillend pakbedrag voor dezelfde benodigde hoeveelheid.
        {onlyDifferences ? ' Gelijke bedragen zijn tijdelijk verborgen.' : ''}
        {' '}Dit filter verandert je mandje, brongegevens en winkelroute niet.</p>
    </div>
    <div className="mixed-store-route__unit-rows">
      {visible.map(({ chosen, p, d, difference }) => {
        const lessExpensive = p.lineTotalCents === d.lineTotalCents
          ? 'Beide winkels hebben hetzelfde regelbedrag.'
          : (p.lineTotalCents < d.lineTotalCents ? 'PLUS' : 'DekaMarkt') +
            ' is ' + exactEuro.formatCents(difference) +
            ' goedkoper voor deze benodigde hoeveelheid.'
        const row = (store: 'PLUS' | 'DekaMarkt', line: Matched) =>
          <div className={chosen.store === store ? 'mixed-store-route__unit-selected' : ''}
            key={store}>
            <strong>{store} {chosen.store === store ? '· gekozen voor jouw route' : ''}</strong>
            <span>{line.productName}</span>
            <small>Originele broncode: {line.productId}</small>
            <span>{line.packs} × {line.pack.count} × {line.pack.amount} {line.pack.unit}
              {' '}· {exactEuro.formatCents(line.pricePerPackCents)} per verpakking</span>
            <span>Eenheidsprijs: {privateUnitPrice(line) ?? 'Niet berekenbaar'}</span>
            <strong>Weekregel: {exactEuro.formatCents(line.lineTotalCents)}</strong>
          </div>
        return <article key={chosen.id}>
          <h5>{chosen.ingredientLabel} · nodig {chosen.amount} {chosen.unit}</h5>
          <div className="mixed-store-route__unit-stores">
            {row('PLUS', p)}
            {row('DekaMarkt', d)}
          </div>
          <p>{lessExpensive}</p>
        </article>
      })}
      {visible.length === 0 && <p>Er zijn geen verschillen binnen deze selectie.
        Toon alle ingrediënten om ook de gelijke winkelbedragen te bekijken.</p>}
    </div>
    <small>De originele productkeuzes zijn privé door jou bevestigd tegen eigen bronmateriaal.
      Eenheidsprijzen zijn rekenhulp, geen toezegging van actuele winkelvoorraad
      of onafhankelijke supermarktprijsvalidatie.</small>
  </details>
}
