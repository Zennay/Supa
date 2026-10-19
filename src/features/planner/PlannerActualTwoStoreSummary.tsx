import type { OneStoreBasket } from '../../domain/basket.ts'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import './plannerActualTwoStoreSummary.css'

const euros = new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'})
const when = new Intl.DateTimeFormat('nl-NL',{dateStyle:'short',timeStyle:'short'})

/** UI for canonical owned-source results, never a second pricing engine. */
export function PlannerActualTwoStoreSummary({plus,deka,comparison,source,fresh,budget,onOpen}:{
  plus:OneStoreBasket; deka:OneStoreBasket; comparison:BasketComparison
  source:OfflinePriceSnapshots; fresh:boolean; budget:number; onOpen:()=>void
}) {
  const complete = (basket:OneStoreBasket) => basket.lines.length>0 &&
    basket.selectedMealCount>0 && basket.unresolvedLineCount===0 &&
    basket.matchedLineCount===basket.lines.length &&
    Number.isSafeInteger(basket.totalCents) && basket.totalCents>=0
  const comparable = fresh && source.pairedWithin24h && complete(plus) &&
    complete(deka) && comparison.claimable &&
    Number.isSafeInteger(comparison.deltaCents)
  const diff = comparable ? comparison.deltaCents : null
  // A per-ingredient difference exists only in the canonical comparator's
  // admitted output. Never derive a second, weaker comparison from the UI.
  const priceDeltaById = comparable
    ? new Map(comparison.lineDeltas.map(row => [row.id, row.deltaCents] as const))
    : new Map<string, number>()
  const dekaById = new Map(deka.lines.map(line => [line.id, line] as const))
  const describe = (line: BasketTraceLine | undefined) => line?.status === 'matched'
    ? <div><strong>{line.productName}</strong>
      <small>SKU {line.productId} · {line.packs} hele pakken</small>
      <small>{line.pack.count} × {line.pack.amount} {line.pack.unit} per verpakking</small>
      <small>{euros.format(line.pricePerPackCents / 100)} / pak ·
        {' '}{privateUnitPrice(line) ?? 'eenheidsprijs onbekend'}</small>
      <b>{euros.format(line.lineTotalCents / 100)}</b>
    </div>
    : <div><strong>Geen betrouwbare productprijs</strong>
        <small>Originele SKU ontbreekt of verpakking/prijs onvolledig.</small></div>
  const budgetCents = Math.round(budget*100)
  const budgetValid = Number.isSafeInteger(budgetCents) && budgetCents>=0
  return <section className="planner-actual-store-compare" aria-label="Mijn twee winkelmandjes">
    <header><span className="eyebrow">Planner → eigen winkelbronnen</span>
      <h3>Mijn weekmand bij twee winkels</h3>
      <p>Alleen zelf geïmporteerde originele winkelopnames. Geen live prijs of onafhankelijk besparingsbewijs.</p>
    </header>
    <div className="planner-actual-store-compare__stores">
      {([['PLUS',plus],['DekaMarkt',deka]] as const).map(([store,basket]) =>
        <article key={store}>
          <strong>{store}</strong>
          <small>Eigen opname: {when.format(new Date(source.captures[store].observedMs))}</small>
          <span>{basket.matchedLineCount} van {basket.lines.length} gekoppeld</span>
          <b>{complete(basket) ? (fresh ? '' : 'Historisch: ') +
            euros.format(basket.totalCents/100) : 'Prijs onbekend · onvolledig'}</b>
          {comparable && budgetValid && <small>{basket.totalCents<=budgetCents ?
            'Binnen je weekbudget' : 'Boven je weekbudget'}</small>}
        </article>)}
    </div>
    <p role="status">{diff!==null ? diff===0 ?
      'Beide volledige mandjes kosten hetzelfde.' :
      (diff>0 ? 'PLUS' : 'DekaMarkt')+' is '+euros.format(Math.abs(diff)/100)+
        ' goedkoper volgens jouw eigen volledige bronopnames.' :
      !fresh ? 'Bronnen verouderd; geen actueel prijsverschil.' :
      !source.pairedWithin24h ? 'Opnames meer dan 24 uur uiteen; geen vergelijkbaar prijsverschil.' :
      'Productkoppelingen of prijzen ontbreken; prijsverschil onbekend.'}</p>
    <details className="planner-actual-store-compare__details">
      <summary>Bekijk originele producten en prijsverschillen per ingrediënt</summary>
      <p>Alle regels komen uit dezelfde gekozen week. Een prijsverschil verschijnt alleen
        wanneer de volledige fysieke mandvergelijking en beide bronmomenten geldig zijn.</p>
      {plus.lines.map(line => {
        const alternate = dekaById.get(line.id)
        const delta = priceDeltaById.get(line.id)
        return <article key={line.id}>
          <h4>{line.ingredientLabel} · nodig {line.requirement.amount ?? '?'}
            {' '}{line.requirement.unit}</h4>
          <div className="planner-actual-store-compare__line">
            <section><h5>PLUS</h5>{describe(line)}</section>
            <section><h5>DekaMarkt</h5>{describe(alternate)}</section>
            <section><h5>Prijsverschil</h5>
              {typeof delta === 'number' && Number.isSafeInteger(delta)
                ? <strong>{delta === 0 ? 'Gelijk' :
                  (delta > 0 ? 'PLUS' : 'DekaMarkt') + ' ' +
                    euros.format(Math.abs(delta) / 100) + ' goedkoper'}</strong>
                : <strong>Onbekend</strong>}
            </section>
          </div>
        </article>
      })}
    </details>
    <button type="button" className="ghost-button" onClick={onOpen}>
      Open bronprijzen, productkeuzes en boodschappenroute
    </button>
  </section>
}
