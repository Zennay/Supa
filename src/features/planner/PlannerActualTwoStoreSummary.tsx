import { useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { createMixedStoreShoppingPlan, formatMixedStoreShoppingPlan } from '../comparison/mixedStoreShoppingPlan.ts'
import { parsePrivateExtraVisitCostCents } from '../comparison/privateExtraVisitCost.ts'
import './plannerActualTwoStoreSummary.css'

const euros = new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'})
const when = new Intl.DateTimeFormat('nl-NL',{dateStyle:'short',timeStyle:'short'})

/** UI for canonical owned-source results, never a second pricing engine. */
export function PlannerActualTwoStoreSummary({plus,deka,comparison,source,fresh,budget,onOpen}:{
  plus:OneStoreBasket; deka:OneStoreBasket; comparison:BasketComparison
  source:OfflinePriceSnapshots; fresh:boolean; budget:number; onOpen:()=>void
}) {
  // An own second-stop estimate belongs to this *exact* physical pair.
  // If Planner choices, SKU, packing or observations change, it must be
  // re-entered; it must not silently carry over to unrelated prices.
  const routeKey = JSON.stringify([
    source.captures.PLUS.observedAt, source.captures.DekaMarkt.observedAt,
    plus.lines, deka.lines,
  ])
  const [costChoice, setCostChoice] = useState<{ key: string; raw: string } | null>(null)
  const visitCostText = costChoice?.key === routeKey ? costChoice.raw : ''
  const [downloadMessage, setDownloadMessage] = useState('')
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
  const mixed = comparable ? createMixedStoreShoppingPlan(plus, deka) : null
  const needsSecondStop = !!mixed && (['PLUS', 'DekaMarkt'] as const).every(shop =>
    mixed.lines.some(line => line.store === shop))
  const visitCost = parsePrivateExtraVisitCostCents(visitCostText)
  const netDifference = mixed && (!needsSecondStop || visitCost !== null)
    ? mixed.additionalDifferenceCents - (needsSecondStop ? visitCost! : 0) : null
  async function downloadMixedRoute(kind: 'txt' | 'csv' | 'html') {
    try {
      const current = BigInt(Date.now()) * 1_000_000n
      const datesCurrent = (['PLUS', 'DekaMarkt'] as const).every(store => {
        const age = current - source.captures[store].observedNs
        return age >= -300_000_000_000n && age <= 604_800_000_000_000n
      })
      const freshPlan = datesCurrent && source.pairedWithin24h
        ? createMixedStoreShoppingPlan(plus, deka) : null
      if (!freshPlan) throw Error('De winkelbronnen zijn niet meer actueel of het mandje is onvolledig.')
      const second = (['PLUS', 'DekaMarkt'] as const).every(shop =>
        freshPlan.lines.some(line => line.store === shop))
      const extra = parsePrivateExtraVisitCostCents(visitCostText)
      const captured = {
        PLUS: source.captures.PLUS.observedAt,
        DekaMarkt: source.captures.DekaMarkt.observedAt,
      }
      const costCents = second ? extra : 0
      const text = kind === 'txt'
        ? formatMixedStoreShoppingPlan(freshPlan, captured, {}, costCents)
        : kind === 'csv'
          ? (await import('../comparison/mixedStoreRouteCsv.ts'))
            .exportMixedStoreRouteCsv({
              plus, deka, route: freshPlan, captured, checked: new Set<string>(),
              extraVisitCostCents: costCents, strategy: 'auto',
            })
          : (await import('../comparison/mixedStorePrintHtml.ts'))
            .printMixedStoreRouteHtml({
              plus, deka, route: freshPlan, captured, checked: new Set<string>(),
              extraVisitCostCents: costCents, strategy: 'auto',
            })
      if (new TextEncoder().encode(text).byteLength > 256_000) {
        throw Error('De winkelroute is te groot voor export.')
      }
      const url = URL.createObjectURL(new Blob([text], {type: (kind === 'txt' ? 'text/plain' :
        kind === 'csv' ? 'text/csv' : 'text/html') + ';charset=utf-8'}))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-twee-winkelroute.' + kind
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage('Privéwinkelroute als ' + kind.toUpperCase() + ' gedownload. Controleer de bronprijzen zelf.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message :
        'Geen betrouwbare winkelroute beschikbaar.')
    }
  }
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
    {mixed && <details className="planner-actual-store-compare__route">
      <summary>Bereken mijn mogelijke gecombineerde winkelroute</summary>
      <p>Alleen zelf geobserveerde en compleet gematchte hele verpakkingen.
        Een lagere productprijs is geen bewezen totale besparing.</p>
      <p>Goedkoopste volledige winkel: <strong>{euros.format(mixed.cheapestWholeStoreCents / 100)}</strong>.
        {' '}Losse goedkoopste producten combineren: <strong>{euros.format(mixed.totalCents / 100)}</strong>.
        {' '}Productkostenverschil: <strong>{euros.format(mixed.additionalDifferenceCents / 100)}</strong>.</p>
      {needsSecondStop ? <label className="planner-actual-store-compare__cost">
        Eigen extra kosten voor een tweede winkelstop (€)
        <input type="text" inputMode="decimal" maxLength={12}
          placeholder="Onbekend, bijvoorbeeld 2,50"
          value={visitCostText} onChange={event =>
            setCostChoice({ key: routeKey, raw: event.target.value })} />
        <small>Dit is jouw eigen schatting, geen supermarktprijs.
          Niet-opgegeven kosten en reistijd zijn niet inbegrepen.</small>
      </label> : <p>De goedkoopste route gebruikt slechts één winkel.</p>}
      <p role="status">{netDifference === null ?
        'Netto kostenverschil onbekend: vul ook bij nul extra kosten zelf 0 in.' :
        netDifference > 0 ?
          'Na jouw opgegeven extra kosten: ' + euros.format(netDifference / 100) +
            ' rekenkundig verschil in het voordeel van deze route.' :
        netDifference < 0 ?
          'Met jouw opgegeven extra kosten is één volledige winkel ' +
            euros.format(Math.abs(netDifference) / 100) + ' voordeliger.' :
          'Inclusief jouw opgegeven extra kosten komen beide routes gelijk uit.'}</p>
      <div className="planner-actual-store-compare__route-stores">
        {(['PLUS', 'DekaMarkt'] as const).map(shop => <section key={shop}>
          <h4>{shop} · {euros.format(mixed.totals[shop] / 100)}</h4>
          <ul>{mixed.lines.filter(line => line.store === shop).map(line =>
            <li key={line.key}>{line.packs} × {line.productName}
              {' '}({line.ingredientLabel}) · {euros.format(line.lineTotalCents / 100)}</li>)}</ul>
        </section>)}
      </div>
      <div className="planner-actual-store-compare__downloads">
        {(['txt', 'csv', 'html'] as const).map(kind => <button
          key={kind} type="button" className="ghost-button"
          onClick={() => { void downloadMixedRoute(kind) }}>
          {kind === 'html' ? 'Afdrukbare privéroute (HTML)' :
            'Download mijn privéroute (' + kind.toUpperCase() + ')'}
        </button>)}
      </div>
      <p role="status">{downloadMessage}</p>
    </details>}
    <button type="button" className="ghost-button" onClick={onOpen}>
      Open bronprijzen, productkeuzes en boodschappenroute
    </button>
  </section>
}
