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
  return <details className="offline-price-workbench__full-breakdown mixed-store-route__unit-breakdown">
    <summary>Vergelijk per ingrediënt de twee echte producten, eenheidsprijzen en pakbedragen</summary>
    <p>De eenheidsprijs is alleen indicatief per kilogram, liter of stuk.
      De goedkoopste winkel voor jouw week wordt gekozen op het werkelijk benodigde
      <strong> aantal hele verpakkingen</strong> en bijbehorende regelbedrag.
      Een lagere prijs per kilo maakt een grotere verpakking niet automatisch
      goedkoper voor jouw benodigde hoeveelheid.</p>
    <div className="mixed-store-route__unit-rows">
      {route.lines.map(chosen => {
        const p = plusLines.get(chosen.id)
        const d = dekaLines.get(chosen.id)
        if (!p || !d) return null
        const difference = Math.abs(p.lineTotalCents - d.lineTotalCents)
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
    </div>
    <small>De originele productkeuzes zijn privé door jou bevestigd tegen eigen bronmateriaal.
      Eenheidsprijzen zijn rekenhulp, geen toezegging van actuele winkelvoorraad
      of onafhankelijke supermarktprijsvalidatie.</small>
  </details>
}
