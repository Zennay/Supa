import { useState } from 'react'
import { freshReviewedBaskets, type PrivateReviewedBaskets, type OwnStore, type PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import { currentPrivateRouteChoice } from '../comparison/privateRouteChoice.ts'
import { ownStoreWeekComparison } from './ownStoreBudgetComparison.ts'
import { PlannerOwnProductDeltas } from './PlannerOwnProductDeltas.tsx'
import type { CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import './plannerOwnStoreComparison.css'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores = ['PLUS', 'DekaMarkt'] as const

/** Exact own-source totals only. No fixture or unreviewed prices. */
export function PlannerOwnStoreComparison({ reviewed, preferred, hasDemand, budget, onSelect, onOpenComparison, onOpenList, onOpenMixedRoute, onChooseRouteLine, captureNeeds }: {
  reviewed: PrivateReviewedBaskets | null
  captureNeeds: readonly PlannerCaptureGuideNeed[]
  preferred: OwnStore
  hasDemand: boolean
  budget: number
  onSelect: (store: OwnStore) => void
  onOpenComparison: () => void
  onOpenList: () => void
  onOpenMixedRoute: () => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
}) {
  const [downloadMessage, setDownloadMessage] = useState('')
  const [captureTarget, setCaptureTarget] = useState<'both' | CaptureStore>('both')
  const summary = ownStoreWeekComparison(reviewed)
  const exactBudget = validCustomWeekBudgetEuros(budget)
  const budgetCents = exactBudget === null ? null : Math.round(exactBudget * 100)
  const selected = reviewed?.stores[preferred] ? preferred : reviewed?.stores.PLUS ? 'PLUS' : reviewed?.stores.DekaMarkt ? 'DekaMarkt' : preferred
  function openConfirmedStoreList(store: OwnStore) {
    // A Planner tab may stay open while its source crosses the freshness
    // boundary. Never hand an expired or different source to Lijst.
    const source = reviewed?.stores[store]
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    if (!source || current?.stores[store] !== source) {
      setDownloadMessage('De eigen winkelopname is verlopen of veranderd. Herzie de bron eerst in Vergelijk.')
      return
    }
    onSelect(store)
    onOpenList()
    setDownloadMessage('')
  }
  async function downloadFieldSheet(kind: 'csv' | 'guide') {
    setDownloadMessage('')
    try {
      const stores: readonly CaptureStore[] = captureTarget === 'both'
        ? ['PLUS', 'DekaMarkt'] : [captureTarget]
      const source = kind === 'csv'
        ? (await import('../comparison/plannerPriceCaptureSheet.ts'))
          .makeBlankPlannerCaptureCsv(captureNeeds, stores)
        : (await import('../comparison/plannerPriceCaptureGuide.ts'))
          .makePlannerCaptureGuide(captureNeeds, stores)
      const url = URL.createObjectURL(new Blob([source], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-planner-' + captureTarget.toLowerCase() +
          (kind === 'csv' ? '-lege-winkelopname.csv' : '-opnamegids.txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage('Leeg ' + (kind === 'csv' ? 'prijsinvulblad' : 'opnameformulier') +
        ' van dit weekmenu gedownload. Vul werkelijk waargenomen bronproducten in en importeer ze in Vergelijk.')
    } catch {
      setDownloadMessage('Prijsinvulblad niet beschikbaar. Controleer de fysieke ingrediënten en weekdagen.')
    }
  }
  async function downloadPrivateComparison() {
    setDownloadMessage('')
    try {
      if (!reviewed) throw new Error('Geen persoonlijke bronopnames beschikbaar.')
      const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
      const fresh = ownStoreWeekComparison(current)
      if (fresh.status !== 'comparable' || !current?.stores.PLUS || !current.stores.DekaMarkt) {
        throw new Error('De bronopnames zijn verlopen of niet meer vergelijkbaar. Werk ze bij in Vergelijk.')
      }
      const { printableOwnStoreComparison, downloadOwnStoreText } = await import('./downloadOwnStoreComparison.ts')
      downloadOwnStoreText(printableOwnStoreComparison(fresh, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      }))
      setDownloadMessage('Je eigen twee-winkelvergelijking is lokaal gedownload.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Download is niet gelukt.')
    }
  }
  async function downloadPrivateCsv() {
    setDownloadMessage('')
    try {
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const fresh = ownStoreWeekComparison(current)
      if (!current || fresh.status !== 'comparable') {
        throw new Error('Voor deze CSV zijn twee actuele en volledig gecontroleerde winkelmandjes nodig.')
      }
      const { downloadOwnStoreCsv } = await import('./downloadOwnStoreComparison.ts')
      downloadOwnStoreCsv(current, fresh)
      setDownloadMessage('De privévergelijking met originele SKU’s en gehele centprijzen is lokaal als CSV gedownload.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'CSV-download mislukt.')
    }
  }
  async function downloadPrivateHtml() {
    setDownloadMessage('')
    try {
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
          ownStoreWeekComparison(current).status !== 'comparable') {
        throw new Error('Er zijn twee actuele en volledig gecontroleerde mandjes nodig voor deze afdruk.')
      }
      const { privateComparisonHtml } = await import('../comparison/PrivateBasketComparisonExport.tsx')
      const html = privateComparisonHtml(
        current.stores.PLUS.basket, current.stores.DekaMarkt.basket,
        current.stores.PLUS.observedAt, current.stores.DekaMarkt.observedAt,
        true, new Date().toISOString(),
      )
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-prive-weekmandjes-print.html'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage('Afdrukbaar privéoverzicht offline opgeslagen, zonder scripts of externe bronnen.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Afdrukbaar overzicht mislukt.')
    }
  }
  function chooseConfirmedLine(id: string, store: OwnStore) {
    const choice = currentPrivateRouteChoice(reviewed, id, store, Date.now())
    if (!choice) {
      setDownloadMessage('De winkelbron of Planner-vraag is veranderd of verlopen. Bevestig de producten opnieuw in Vergelijk.')
      return
    }
    setDownloadMessage('')
    onChooseRouteLine(choice)
  }
  return <section className="own-store-planner" aria-labelledby="own-store-planner-heading">
    <header className="own-store-planner__header">
      <div><span className="eyebrow">Eigen gecontroleerde winkelopnames</span>
        <h3 id="own-store-planner-heading">Jouw weekmand per winkel</h3></div>
      <button type="button" className="ghost-button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
    </header>
    {captureNeeds.length > 0 && <div className="own-store-planner__capture" aria-label="Mijn lokale winkelprijsopname">
      <strong>Zelf winkelprijzen vastleggen voor dit weekmenu</strong>
      <p>Download een leeg invulblad of opnamegids voor {captureNeeds.length} fysieke ingrediënten. Productcodes, bronmomenten en prijzen moet je werkelijk vastleggen.</p>
      <label>Winkel(s) voor eigen opname
        <select value={captureTarget}
          onChange={event => setCaptureTarget(event.currentTarget.value as 'both' | CaptureStore)}>
          <option value="both">PLUS en DekaMarkt</option>
          <option value="PLUS">Alleen PLUS</option>
          <option value="DekaMarkt">Alleen DekaMarkt</option>
        </select>
      </label>
      <div className="own-store-planner__capture-buttons">
        <button type="button" className="ghost-button" onClick={() => void downloadFieldSheet('csv')}>Download leeg CSV-prijsinvulblad</button>
        <button type="button" className="ghost-button" onClick={() => void downloadFieldSheet('guide')}>Download opnamegids (TXT)</button>
      </div>
    </div>}
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
          {capture && <button type="button" className="ghost-button"
            onClick={() => openConfirmedStoreList(store)}>
            Open mijn {store}-boodschappenlijst
          </button>}
        </div>
      })}
    </div>
    {summary.status === 'missing' && summary.available.length === 0 && <div className="own-store-planner__start" role="status">
      <strong>Prijsverschil onbekend · nog geen gecontroleerde winkelmandjes</strong>
      {hasDemand ? <>
        <p>Je weekmenu is de basis. Vul voor PLUS en DekaMarkt alleen echt verkregen
          productgegevens, verpakkingen, beschikbaarheid, pakprijzen en bronmomenten in.
          Bevestig vervolgens per ingrediënt de originele bronartikelen. Zonder beide
          volledig gecontroleerde mandjes wordt geen prijsverschil berekend.</p>
        <button type="button" className="ghost-button" onClick={onOpenComparison}>
          Start met eigen winkelprijsdata
        </button>
      </> : <p>Kies eerst minstens één maaltijd in je Planner-weekmenu.
        Daarna kun je de benodigde producten bij de twee winkels invoeren en vergelijken.</p>}
    </div>}
    {summary.status === 'comparable'
      ? <div className="own-store-planner__result" role="status">
          <strong>{summary.cheapest === null ? 'Beide eigen mandjes hebben hetzelfde totaal.'
            : `${summary.cheapest} is ${money.format(summary.differenceCents / 100)} voordeliger voor jouw mandje.`}</strong>
          <p>Dezelfde gecontroleerde fysieke vraag en benodigde hele verpakkingen, eigen bronmomenten maximaal 24 uur uit elkaar. Geen kassagarantie of onafhankelijk bewezen besparing.</p>
          {summary.cheapest && selected !== summary.cheapest && <button type="button" className="ghost-button"
            onClick={() => onSelect(summary.cheapest!)}>Kies {summary.cheapest} voor mijn weekbudget</button>}
          <button type="button" className="ghost-button" onClick={onOpenList}>Open eigen boodschappenlijst</button>
          <button type="button" className="ghost-button" onClick={downloadPrivateComparison}>
            Download privévergelijking (TXT)
          </button>
          <button type="button" className="ghost-button" onClick={downloadPrivateCsv}>
            Download privévergelijking met originele SKU's (CSV)
          </button>
          <button type="button" className="ghost-button" onClick={downloadPrivateHtml}>
            Download afdrukbaar volledig prijsvergelijkingsblad (HTML)
          </button>
          {summary.mixedRoute && <div className="own-store-planner__mix-preview">
            <h4>Combineren van goedkoopste artikelen</h4>
            <p><strong>{money.format(summary.mixedRoute.totalCents / 100)} aan winkelproducten</strong>
              {' '}als je per ingrediënt het goedkoopste gecontroleerde hele-verpakkingenbedrag neemt.
              {summary.mixedRoute.requiresTwoStops
                ? <> Dit is {money.format(summary.mixedRoute.possibleProductDifferenceCents / 100)}
                    {' '}lager dan de goedkoopste volledige winkel, <strong>vóór extra bezoekkosten</strong>.
                    Het werkelijke voordeel is onbekend zolang reistijd of extra kosten niet zijn ingevuld.</>
                : <> Deze selectie past bij één winkel; een tweede winkelstop is niet nodig.</>}</p>
            <button type="button" className="ghost-button" onClick={onOpenMixedRoute}>
              Open mijn gecombineerde winkelroute in Lijst
            </button>
          </div>}
          <PlannerOwnProductDeltas lines={summary.lines} onChooseLine={chooseConfirmedLine} />
        </div>
      : summary.available.length > 0 ? <div className="own-store-planner__result" role="status">
          <strong>Geen betrouwbaar twee-winkelprijsverschil</strong>
          <p>Je kunt het complete, zelf gecontroleerde mandje van één winkel al
            gebruiken via de winkelkaarten hierboven. Voor een prijsverschil zijn
            twee geldige opnames van hetzelfde weekmenu nodig.</p>
          <p>{summary.status === 'missing'
            ? 'Voor dezelfde Planner-week ontbreekt nog een volledig, persoonlijk gecontroleerd mandje bij de andere winkel.'
            : summary.status === 'different-moments'
              ? 'De bronmomenten liggen meer dan 24 uur uit elkaar. Maak een nieuwe opname voordat je prijzen vergelijkt.'
              : 'De fysieke hoeveelheden, verpakkingen of mandregels zijn niet gelijkwaardig bevestigd. Herzie de matches in Vergelijk.'}</p>
          <button type="button" className="ghost-button" onClick={onOpenComparison}>Vul ontbrekende brongegevens aan</button>
        </div> : null}
    {downloadMessage && <p role="status" aria-live="polite">{downloadMessage}</p>}
  </section>
}
