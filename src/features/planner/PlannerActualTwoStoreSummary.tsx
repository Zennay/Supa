import type { OneStoreBasket } from '../../domain/basket.ts'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
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
    <button type="button" className="ghost-button" onClick={onOpen}>
      Open bronprijzen, productkeuzes en boodschappenroute
    </button>
  </section>
}
