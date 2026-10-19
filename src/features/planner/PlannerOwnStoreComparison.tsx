import type { PrivateReviewedBaskets, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { ownStoreWeekComparison } from './ownStoreBudgetComparison.ts'
import { PlannerOwnProductDeltas } from './PlannerOwnProductDeltas.tsx'
import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import './plannerOwnStoreComparison.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores = ['PLUS', 'DekaMarkt'] as const

/** Exact own-source totals only. No fixture or unreviewed prices. */
export function PlannerOwnStoreComparison({ reviewed, preferred, budget, onSelect, onOpenComparison, onOpenList }: {
  reviewed: PrivateReviewedBaskets | null
  preferred: OwnStore
  budget: number
  onSelect: (store: OwnStore) => void
  onOpenComparison: () => void
  onOpenList: () => void
}) {
  const summary = ownStoreWeekComparison(reviewed)
  const exactBudget = validCustomWeekBudgetEuros(budget)
  const budgetCents = exactBudget === null ? null : Math.round(exactBudget * 100)
  const selected = reviewed?.stores[preferred] ? preferred : reviewed?.stores.PLUS ? 'PLUS' : reviewed?.stores.DekaMarkt ? 'DekaMarkt' : preferred
  if (!summary.available.length) return null
  return <section className="own-store-planner" aria-labelledby="own-store-planner-heading">
    <header className="own-store-planner__header">
      <div><span className="eyebrow">Eigen gecontroleerde winkelopnames</span>
        <h3 id="own-store-planner-heading">Jouw weekmand per winkel</h3></div>
      <button type="button" className="ghost-button" onClick={onOpenComparison}>Controleer bronartikelen</button>
    </header>
    <div className="own-store-planner__cards">
      {stores.map(store => {
        const capture = reviewed?.stores[store]
        const cents = capture?.basket.totalCents
        return <div className="own-store-planner__card" key={store}>
          <strong>{store}</strong>
          <span className="own-store-planner__price">{capture && typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0
            ? money.format(cents / 100) : 'Prijs onbekend'}</span>
          <small>{capture ? `Eigen opname: ${capture.observedAt}` : 'Nog geen complete, gecontroleerde opname'}</small>
          {capture && typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 && budgetCents !== null &&
            <small className="own-store-planner__budget-gap">{cents > budgetCents
              ? `${money.format((cents - budgetCents) / 100)} boven je ingestelde weekbudget`
              : `${money.format((budgetCents - cents) / 100)} binnen je ingestelde weekbudget`}</small>}
          {capture && <button type="button" onClick={() => onSelect(store)}
            className="ghost-button" aria-pressed={selected === store}>
            {selected === store ? 'Gekozen voor mijn budget' : 'Gebruik voor mijn budget'}
          </button>}
        </div>
      })}
    </div>
    {summary.status === 'comparable'
      ? <div className="own-store-planner__result" role="status">
          <strong>{summary.cheapest === null ? 'Beide eigen mandjes hebben hetzelfde totaal.'
            : `${summary.cheapest} is ${money.format(summary.differenceCents / 100)} voordeliger voor jouw mandje.`}</strong>
          <p>Dezelfde gecontroleerde fysieke vraag en benodigde hele verpakkingen, eigen bronmomenten maximaal 24 uur uit elkaar. Geen kassagarantie of onafhankelijk bewezen besparing.</p>
          {summary.cheapest && selected !== summary.cheapest && <button type="button" className="ghost-button"
            onClick={() => onSelect(summary.cheapest!)}>Kies {summary.cheapest} voor mijn weekbudget</button>}
          <button type="button" className="ghost-button" onClick={onOpenList}>Open eigen boodschappenlijst</button>
          <PlannerOwnProductDeltas lines={summary.lines} />
        </div>
      : <div className="own-store-planner__result" role="status">
          <strong>Geen betrouwbaar twee-winkelprijsverschil</strong>
          <p>{summary.status === 'missing'
            ? 'Voor dezelfde Planner-week ontbreekt nog een volledig, persoonlijk gecontroleerd mandje bij de andere winkel.'
            : summary.status === 'different-moments'
              ? 'De bronmomenten liggen meer dan 24 uur uit elkaar. Maak een nieuwe opname voordat je prijzen vergelijkt.'
              : 'De fysieke hoeveelheden, verpakkingen of mandregels zijn niet gelijkwaardig bevestigd. Herzie de matches in Vergelijk.'}</p>
          <button type="button" className="ghost-button" onClick={onOpenComparison}>Vul ontbrekende brongegevens aan</button>
        </div>}
  </section>
}
