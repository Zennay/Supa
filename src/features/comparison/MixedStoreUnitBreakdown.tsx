import { useState } from 'react'
import { euro as exactEuro } from '../../lib/money.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { privateUnitPrice, privatePackUnitRate } from './privateUnitPrice.ts'
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
  const [sortBy, setSortBy] = useState<'planner' | 'biggest-difference' | 'unit-difference'>('planner')
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [search, setSearch] = useState('')
  const comparisons = route.lines.flatMap((chosen, index) => {
    const p = plusLines.get(chosen.id)
    const d = dekaLines.get(chosen.id)
    if (!p || !d) return []
    const plusUnit = privatePackUnitRate({
      amount: p.pack.amount, unit: p.pack.unit, count: p.pack.count,
      priceCents: p.pricePerPackCents,
    })
    const dekaUnit = privatePackUnitRate({
      amount: d.pack.amount, unit: d.pack.unit, count: d.pack.count,
      priceCents: d.pricePerPackCents,
    })
    const unitDifference = plusUnit && dekaUnit && plusUnit.unit === dekaUnit.unit
      ? Math.abs(plusUnit.milliCentsPerUnit - dekaUnit.milliCentsPerUnit) : null
    return [{
      chosen, p, d, index, unitDifference,
      difference: Math.abs(p.lineTotalCents - d.lineTotalCents),
    }]
  })
  const distinct = comparisons.filter(item => item.difference > 0).length
  const query = search.normalize('NFC').trim().toLocaleLowerCase('nl-NL')
  const filtered = comparisons.filter(({ chosen, p, d, difference }) => {
    if (onlyDifferences && difference === 0) return false
    if (!query) return true
    const haystack = [
      chosen.ingredientLabel, p.productName, d.productName, p.productId, d.productId,
    ].join(' ').normalize('NFC').toLocaleLowerCase('nl-NL')
    return haystack.includes(query)
  })
  const visible = sortBy === 'biggest-difference'
    ? [...filtered].sort((a, b) => b.difference - a.difference || a.index - b.index)
    : sortBy === 'unit-difference'
      ? [...filtered].sort((a, b) =>
          (b.unitDifference ?? -1) - (a.unitDifference ?? -1) || a.index - b.index)
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
      <label>Zoek ingrediënt, oorspronkelijk product of SKU
        <input type="search" value={search} maxLength={80}
          placeholder="Bijv. tomaten of broncode" onChange={event =>
            setSearch(event.currentTarget.value)} />
      </label>
      <label>Sorteer de prijsverschillen
        <select value={sortBy} onChange={event =>
          setSortBy(event.currentTarget.value as 'planner' | 'biggest-difference' | 'unit-difference')}>
          <option value="planner">Volgorde van mijn Planner</option>
          <option value="biggest-difference">Grootste prijsverschil eerst</option>
          <option value="unit-difference">Grootste vergelijkbare eenheidsprijsverschil eerst</option>
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
        {' '}Er zijn {visible.length} ingrediënten zichtbaar.
        Zoeken en sorteren veranderen je mandje, brongegevens en winkelroute niet.
        {sortBy === 'unit-difference' && ' Alleen eenheidsprijzen met dezelfde basis (kg, liter of stuk) worden vergeleken. Onbekende of onvergelijkbare eenheden komen achteraan; je echte weekkosten blijven op hele pakken gebaseerd.'}</p>
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
          {difference > 0 && chosen.store !==
            (p.lineTotalCents < d.lineTotalCents ? 'PLUS' : 'DekaMarkt') && <p>
            Je hebt {chosen.store} gekozen. Voor deze oorspronkelijke fysieke
            hoeveelheid is dat <strong>{exactEuro.formatCents(difference)} duurder</strong>
            dan het andere beoordeelde product. Dit is alleen een vergelijking
            van jouw bronopnames, niet een actuele kassaprijs.
          </p>}
        </article>
      })}
      {visible.length === 0 && <p>Geen ingrediënten gevonden binnen deze selectie.
        Wis je zoekterm of schakel 'alleen verschillen' uit om de complete
        vergelijking uit jouw eigen bronopnames te bekijken.</p>}
    </div>
    <small>De originele productkeuzes zijn privé door jou bevestigd tegen eigen bronmateriaal.
      Eenheidsprijzen zijn rekenhulp, geen toezegging van actuele winkelvoorraad
      of onafhankelijke supermarktprijsvalidatie.</small>
  </details>
}
