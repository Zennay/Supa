import { useMemo, useState } from 'react'
import { matchIngredient, type MatchUnit } from '../../domain/matching.ts'
import type { OfflinePriceSnapshots, OfflineRetailer, OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import { recentOwnCaptureInstant } from '../comparison/privateReviewedBasketBridge.ts'
import { selectiveTwoStoreCaptureCsv, selectiveTwoStoreCaptureGuide } from './selectiveTwoStoreCapture.ts'
import './plannerSourceMatchPreview.css'

const stores = ['PLUS', 'DekaMarkt'] as const
const units = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const family = (unit: string): 'mass' | 'volume' | 'piece' | null =>
  unit === 'g' || unit === 'kg' ? 'mass' :
  unit === 'ml' || unit === 'l' ? 'volume' :
  unit === 'piece' ? 'piece' : null
type Suggestion = {
  name: string; sku: string
  packCount: number; packAmount: number; packUnit: string
  packCents: number; unitRate: string | null
} | null
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const sourceDate = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })

/** Unconfirmed, read-only candidate hints. Canonical Workbench approves totals. */
export function PlannerSourceMatchPreview({ needs, source }: {
  needs: readonly PlannerCaptureGuideNeed[]
  source: OfflinePriceSnapshots
}) {
  const [showAll, setShowAll] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [showMobileGuide, setShowMobileGuide] = useState(false)
  const coverage = useMemo(() => {
    const products = Object.fromEntries(stores.map(store => [
      store, new Map(source.captures[store]?.products.map(p => [p.id, p]) ?? []),
    ])) as Record<OfflineRetailer, Map<string, OfflineStoreProduct>>
    return needs.map(need => {
      const suggestions = {} as Record<OfflineRetailer, Suggestion>
      for (const store of stores) {
        const capture = source.captures[store]
        if (!capture || need.amount === null || !Number.isFinite(need.amount) ||
            need.amount <= 0 || !units.has(need.unit)) {
          suggestions[store] = null
          continue
        }
        // Candidates without an actual captured price or compatible physical
        // packaging cannot satisfy this shopping need. Exclude them BEFORE
        // ranking: an unpriced high-scoring SKU must not shadow a genuine,
        // uniquely identifiable priced product from the same source.
        const eligible = capture.products.filter(product =>
          product.available === true &&
          typeof product.sourcePriceCents === 'number' &&
          Number.isSafeInteger(product.sourcePriceCents) &&
          product.sourcePriceCents >= 0 &&
          product.packAmount !== null && product.packAmount > 0 &&
          family(product.packUnit) === family(need.unit))
        const choice = matchIngredient({
          id: need.id, query: need.query || need.label, amount: need.amount,
          unit: need.unit as MatchUnit,
        }, eligible)
        const match = choice.type === 'match' ? products[store].get(choice.productId) : null
        // The fuzzy matcher can rank an attractive name even if the source
        // package belongs to a different physical unit family. Never present
        // e.g. ml rice as a viable candidate for a gram-based rice demand.
        suggestions[store] = match && match.available &&
          typeof match.sourcePriceCents === 'number' &&
          Number.isSafeInteger(match.sourcePriceCents) && match.sourcePriceCents >= 0 &&
          match.packAmount !== null && family(match.packUnit) === family(need.unit)
          ? (() => {
              const count = match.packCount ?? 1
              const rate = privatePackUnitRate({
                amount: match.packAmount, unit: match.packUnit,
                count, priceCents: match.sourcePriceCents,
              })
              return { name: match.name, sku: match.id,
                packCount: count, packAmount: match.packAmount,
                packUnit: match.packUnit, packCents: match.sourcePriceCents,
                unitRate: rate ? formatPrivateUnitRate(rate) : null }
            })() : null
      }
      return { need, suggestions }
    })
  }, [needs, source])
  if (!coverage.length) return null
  const suggested = stores.map(store => coverage.filter(line => line.suggestions[store]).length)
  const paired = coverage.filter(line => line.suggestions.PLUS && line.suggestions.DekaMarkt).length
  const missing = coverage.filter(line => !line.suggestions.PLUS || !line.suggestions.DekaMarkt)
  const filtered = onlyMissing ? missing : coverage
  const shown = filtered.slice(0, showAll ? 200 : 12)
  const needsForNewSource = (store: 'PLUS' | 'DekaMarkt',
    nowMs: number): PlannerCaptureGuideNeed[] => {
    const capture = source.captures[store]
    // Expired/missing original source: no SKU is a currently usable price.
    // More-than-24h pairs require a fresh recording of the older retailer,
    // even if its candidate list looks complete in isolation.
    const olderPairedStore = !source.pairedWithin24h &&
      source.captures.PLUS && source.captures.DekaMarkt
      ? source.captures.PLUS.observedNs < source.captures.DekaMarkt.observedNs
        ? 'PLUS' : 'DekaMarkt'
      : null
    if (!capture || !recentOwnCaptureInstant(capture.observedAt, nowMs) ||
        olderPairedStore === store) return [...needs]
    return missing.filter(({ suggestions }) => !suggestions[store])
      .map(({ need }) => need)
  }
  const pendingPlus = needsForNewSource('PLUS', Date.now()).length
  const pendingDeka = needsForNewSource('DekaMarkt', Date.now()).length
  function mobileGuideText(): string {
    try {
      return selectiveTwoStoreCaptureGuide({
        PLUS: needsForNewSource('PLUS', Date.now()),
        DekaMarkt: needsForNewSource('DekaMarkt', Date.now()),
      })
    } catch (cause) {
      return cause instanceof Error ? cause.message
        : 'Het opnameblad is onduidelijk. Controleer het geselecteerde weekmenu.'
    }
  }
  function downloadMissingSourceCapture(kind: 'csv' | 'csv-excel' | 'guide') {
    try {
      // Derive two distinct genuinely missing sets against the SAME selected
      // Planner week. Original source facts are never copied into empty rows,
      // and an unconfirmed candidate can never masquerade as field evidence.
      const nowMs = Date.now()
      const missingByStore = {
        PLUS: needsForNewSource('PLUS', nowMs),
        DekaMarkt: needsForNewSource('DekaMarkt', nowMs),
      }
      const content = kind === 'guide'
        ? selectiveTwoStoreCaptureGuide(missingByStore)
        : selectiveTwoStoreCaptureCsv(missingByStore,
            kind === 'csv-excel' ? ';' : ',')
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'guide' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = kind === 'guide'
          ? 'supa-ontbrekende-plus-deka-rijgids.txt'
          : kind === 'csv-excel'
            ? 'supa-ontbrekende-plus-deka-spreadsheet.csv'
            : 'supa-ontbrekende-plus-deka-import.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCaptureMessage(kind === 'guide'
        ? 'De rijgids vermeldt per winkel en CSV-regel de originele Planner-behoefte.'
        : 'Leeg importeerbaar bronblad opgeslagen. Vul uitsluitend werkelijk geobserveerde SKU’s, prijzen en bronmomenten in; importeer daarna via Vergelijk.')
    } catch (cause) {
      setCaptureMessage(cause instanceof Error ? cause.message
        : 'Kon het lege winkelopnameblad niet opstellen.')
    }
  }
  return <section className="supa-planner-source-matches" aria-label="Voorlopige weekmand-productmatching">
    <h4>Weekmand tegenover de aangeleverde bron-SKU’s</h4>
    <div role="status" className="supa-planner-source-matches__capture-status">
      {stores.map(store => {
        const capture = source.captures[store]
        return <p key={store}><strong>{store}:</strong>{' '}
          {capture ? <>bronopname {sourceDate.format(new Date(capture.observedMs))}
            {' · '}{recentOwnCaptureInstant(capture.observedAt, Date.now())
              ? 'bron jonger dan 7 dagen' : 'bron te oud voor een actuele vergelijking'}</>
            : 'geen bronopname; alle winkelprijzen onbekend'}</p>
      })}
      {source.captures.PLUS && source.captures.DekaMarkt &&
        !source.pairedWithin24h && <p><strong>Niet gelijktijdig vergelijkbaar:</strong>
          {' '}de twee oorspronkelijke opnames liggen meer dan 24 uur uit elkaar.
          Nieuwe echte opnames zijn nodig voor een actuele twee-winkeldelta.</p>}
    </div>
    <p>{coverage.length} fysieke ingrediënten: PLUS {suggested[0]} mogelijke kandidaten,
      DekaMarkt {suggested[1]}. Voor {paired} ingrediënten is er voorlopig een
      kandidaat bij beide winkels.</p>
    <p><strong>Dit zijn onbevestigde naam- en verpakkingssuggesties.</strong> Een
      winkelprijs of besparing ontstaat pas nadat Vergelijk de originele SKU,
      benodigde hele verpakkingen, volledige mandjes en bronmomenten controleert.</p>
    <label><input type="checkbox" checked={onlyMissing}
      onChange={e => { setOnlyMissing(e.target.checked); setShowAll(false) }} />
      Alleen ontbrekende of onzekere bronmatches tonen</label>
    <div className="supa-planner-source-matches__table" role="table"
      aria-label="Voorlopige bronmatching voor hetzelfde fysieke weekmandje">
      <div className="supa-planner-source-matches__row" role="row">
        <strong role="columnheader">Fysieke behoefte</strong>
        <strong role="columnheader">PLUS</strong>
        <strong role="columnheader">DekaMarkt</strong>
      </div>
      {shown.map(({ need, suggestions }) => <div className="supa-planner-source-matches__row"
        role="row" key={need.id}>
        <span role="cell"><strong>{need.label}</strong>
          <small>{need.amount ?? 'Onbekend'} {need.unit}</small></span>
        {stores.map(store => <span role="cell" key={store}>
          {suggestions[store] ? <>Kandidaat: {suggestions[store]!.name}
            <small>SKU {suggestions[store]!.sku} · niet bevestigd</small>
            <small>{suggestions[store]!.packCount} × {suggestions[store]!.packAmount}
              {' '}{suggestions[store]!.packUnit} · opgenomen bronpakprijs
              {' '}{money.format(suggestions[store]!.packCents / 100)}
              {suggestions[store]!.unitRate
                ? ' · informatief ' + suggestions[store]!.unitRate : ''}
              {' '}· bronmoment niet automatisch gevalideerd</small></>
            : 'Geen eenduidige geprijsde kandidaat; handmatig koppelen'}
        </span>)}
      </div>)}
    </div>
    {(pendingPlus > 0 || pendingDeka > 0) && <div className="supa-planner-source-matches__exports">
      <p><strong>Nieuwe echte bronopname vereist:</strong>
        {' '}{pendingPlus} PLUS- en {pendingDeka} DekaMarkt-regels.
        Ontbrekende prijzen vragen alleen ontbrekende SKU’s; bij een verouderde
        opname of een bronpaar buiten 24 uur moet de betreffende winkel
        opnieuw worden vastgelegd.</p>
      <button type="button" className="ghost-button"
        onClick={() => downloadMissingSourceCapture('csv')}>
        Download alleen ontbrekende PLUS/Deka-producten (importeerbaar CSV)
      </button>
      <button type="button" className="ghost-button"
        onClick={() => downloadMissingSourceCapture('csv-excel')}>
        Spreadsheet-CSV (puntkomma)
      </button>
      <button type="button" className="ghost-button"
        onClick={() => downloadMissingSourceCapture('guide')}>
        Download bijbehorende CSV-rijgids (TXT)
      </button>
      <button type="button" className="ghost-button"
        aria-expanded={showMobileGuide}
        onClick={() => setShowMobileGuide(value => !value)}>
        {showMobileGuide ? 'Verberg mobiele meeneemlijst' : 'Bekijk en kopieer mobiele meeneemlijst'}
      </button>
      {showMobileGuide && <label className="supa-planner-source-matches__mobile-guide">
        Alle ontbrekende winkelregels met exacte CSV-rijnummers · alleen eigen Planner-behoefte
        <textarea readOnly rows={11}
          value={mobileGuideText()}
          onFocus={event => event.currentTarget.select()}
          aria-label="Selecteer mijn ontbrekende PLUS- en Deka-producten" />
      </label>}
      <small>CSV en rijgids gebruiken dezelfde volgorde per winkel.
        Alle artikelcodes, tijden, werkelijk gemeten verpakkingen en prijzen
        moeten nog in de lege cellen worden ingevuld; dit is geen retailerbron.</small>
    </div>}
    {captureMessage && <p role="status">{captureMessage}</p>}
    {filtered.length > shown.length && <button type="button" className="ghost-button"
      onClick={() => setShowAll(true)}>Toon alle {filtered.length} ingrediënten</button>}
    <small>Een kandidaat uit een verouderde opname is geen actuele prijs.
      Open de bron in Vergelijk voor definitieve controle.</small>
  </section>
}
