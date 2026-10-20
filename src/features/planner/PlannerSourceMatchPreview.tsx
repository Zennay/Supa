import { useEffect, useMemo, useState } from 'react'
import { matchIngredient, type MatchUnit } from '../../domain/matching.ts'
import { productSearchText } from '../products/productSearchText.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import type { OfflinePriceSnapshots, OfflineRetailer, OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import { recentOwnCaptureInstant } from '../comparison/privateReviewedBasketBridge.ts'
import { selectiveTwoStoreCaptureCsv, selectiveTwoStoreCaptureGuide } from './selectiveTwoStoreCapture.ts'
import { privateTwoStoreCoverageCsv, privateTwoStoreCoverageText, type CoverageExportLine } from './twoStoreCoverageExport.ts'
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
  packCents: number; unitRate: string | null; packsNeeded: number; lineCents: number
} | null
type UnpricedHint = { name: string; sku: string; reason: string } | null
const wholeMoney = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })
/** Exact original integer cent presentation, including large safe pack totals. */
const exactEuro = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) return 'Prijs onbekend'
  const absolute = BigInt(Math.abs(cents))
  return (cents < 0 ? '−' : '') + '€\u00a0' +
    wholeMoney.format(absolute / 100n) + ',' +
    String(absolute % 100n).padStart(2, '0')
}
const sourceDate = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })

/** Unconfirmed, read-only candidate hints. Canonical Workbench approves totals. */
export function PlannerSourceMatchPreview({ needs, source, onReviewIngredient, onRecapture }: {
  needs: readonly PlannerCaptureGuideNeed[]
  source: OfflinePriceSnapshots
  onReviewIngredient?: (store: 'PLUS' | 'DekaMarkt', ingredientId: string) => void
  onRecapture?: (store: 'PLUS' | 'DekaMarkt') => void
}) {
  // An open Planner tab may outlive a source capture's seven-day validity.
  // Recompute proposed SKUs on the real clock, not only on source-file edits.
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setClock(Date.now())
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const [showAll, setShowAll] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<'review-first' | 'largest-provisional-gap'>('review-first')
  const [storeFilter, setStoreFilter] = useState<'both' | 'PLUS' | 'DekaMarkt'>('both')
  const [actionFilter, setActionFilter] = useState<'all' | 'choose-sku' | 'fix-source' | 'capture' | 'paired'>('all')
  const [captureMessage, setCaptureMessage] = useState('')
  const [showMobileGuide, setShowMobileGuide] = useState(false)
  const [showActionList, setShowActionList] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  // A single-store capture can be fresh (<7 days) but still unusable for a
  // paired comparison if the other store was observed >24h apart. Point the
  // user at the OLDER store instead of promising a reviewable paired SKU.
  const olderPairedStore = !source.pairedWithin24h &&
    source.captures.PLUS && source.captures.DekaMarkt
    ? source.captures.PLUS.observedNs < source.captures.DekaMarkt.observedNs
      ? 'PLUS' : 'DekaMarkt'
    : null
  const coverage = useMemo(() => {
    const products = Object.fromEntries(stores.map(store => [
      store, new Map(source.captures[store]?.products.map(p => [p.id, p]) ?? []),
    ])) as Record<OfflineRetailer, Map<string, OfflineStoreProduct>>
    return needs.map(need => {
      const suggestions = {} as Record<OfflineRetailer, Suggestion>
      const unpricedHints = { PLUS: null, DekaMarkt: null } as Record<OfflineRetailer, UnpricedHint>
      const manualReview = { PLUS: false, DekaMarkt: false }
      for (const store of stores) {
        const capture = source.captures[store]
        if (!capture || olderPairedStore === store ||
            !recentOwnCaptureInstant(capture.observedAt, clock) ||
            need.amount === null || !Number.isFinite(need.amount) ||
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
        const requirement = {
          id: need.id, query: need.query || need.label, amount: need.amount,
          unit: need.unit as MatchUnit,
        }
        const choice = matchIngredient(requirement, eligible)
        // Diagnostic only: the same original retailer file can already
        // contain a likely SKU without a usable price/pack/availability.
        // NEVER promote this projection into a purchasable or reviewed match.
        const incomplete = capture.products.filter(product => {
          const productFamily = family(product.packUnit)
          // A known physically different unit must never look suitable;
          // unknown packaging may be shown only as an unpriced identity hint.
          if (productFamily !== null && productFamily !== family(need.unit)) return false
          const priceValid = typeof product.sourcePriceCents === 'number' &&
            Number.isSafeInteger(product.sourcePriceCents) && product.sourcePriceCents >= 0
          const packValid = product.packAmount !== null && product.packAmount > 0 &&
            productFamily === family(need.unit)
          return !product.available || !priceValid || !packValid
        })
        if (incomplete.length && choice.type !== 'match' &&
            !choice.reasons.includes('top candidates too close')) {
          const diagnostic = matchIngredient(requirement,
            incomplete.map(product => ({ ...product, available: true })),
            { minimumScore: 80, minimumMargin: 20 })
          const found = diagnostic.type === 'match'
            ? incomplete.find(product => product.id === diagnostic.productId) : null
          if (found) {
            unpricedHints[store] = {
              name: found.name,
              sku: found.id,
              reason: found.available !== true ? 'volgens de originele bron niet beschikbaar'
                : found.packAmount === null || found.packAmount <= 0 ||
                    family(found.packUnit) === null ? 'verpakking of maateenheid ontbreekt'
                  : typeof found.sourcePriceCents !== 'number' ||
                      !Number.isSafeInteger(found.sourcePriceCents) ||
                      found.sourcePriceCents < 0 ? 'pakprijs ontbreekt of is ongeldig'
                    : 'brongegevens vragen persoonlijke controle',
            }
          }
        }
        // An ambiguous source already contains several valid original SKUs.
        // The user must pick one in Vergelijk, not re-observe a made-up new
        // product or silently treat the first result as a match.
        manualReview[store] = choice.type === 'abstain' &&
          choice.reasons.includes('top candidates too close')
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
              // The *same* exact decimal ceiling used by the canonical
              // basket engine. This is only a per-ingredient shopping hint:
              // shared SKUs across ingredients are aggregated downstream.
              if (need.unit === 'piece' && !Number.isSafeInteger(need.amount)) return null
              const packsNeeded = calculateDecimalPackCount(
                [{ amount: need.amount, unit: need.unit as MatchUnit }],
                { amount: match.packAmount!, unit: match.packUnit, count },
              )
              if (packsNeeded === null ||
                  !Number.isSafeInteger(packsNeeded * match.sourcePriceCents)) return null
              const rate = privatePackUnitRate({
                amount: match.packAmount, unit: match.packUnit,
                count, priceCents: match.sourcePriceCents,
              })
              return { name: match.name, sku: match.id,
                packCount: count, packAmount: match.packAmount,
                packUnit: match.packUnit, packCents: match.sourcePriceCents,
                unitRate: rate ? formatPrivateUnitRate(rate) : null,
                packsNeeded, lineCents: packsNeeded * match.sourcePriceCents }
            })() : null
      }
      return { need, suggestions, manualReview, unpricedHints }
    })
  }, [needs, source, olderPairedStore, clock])
  if (!coverage.length) return null
  const suggested = stores.map(store => coverage.filter(line => line.suggestions[store]).length)
  const paired = coverage.filter(line => line.suggestions.PLUS && line.suggestions.DekaMarkt).length
  const missing = coverage.filter(line => !line.suggestions.PLUS || !line.suggestions.DekaMarkt)
  const requiringChoice = stores.map(store =>
    coverage.filter(line => line.manualReview[store]).length)
  const sourceKnownButUnpriced = stores.map(store =>
    coverage.filter(line => !!line.unpricedHints[store]).length)
  // Review ambiguous existing SKUs before asking for new source capture.
  const priority = (line: typeof coverage[number]) =>
    stores.some(store => line.manualReview[store]) ? 0 :
    stores.some(store => line.unpricedHints[store]) ? 1 :
    stores.some(store => !line.suggestions[store]) ? 2 : 3
  const candidateLineGap = (line: typeof coverage[number]) =>
    source.pairedWithin24h && line.suggestions.PLUS && line.suggestions.DekaMarkt
      ? line.suggestions.DekaMarkt.lineCents - line.suggestions.PLUS.lineCents : null
  // Explain precisely why a physical week ingredient cannot yet be compared.
  // A local uploaded source is not proof that either retailer authorized reuse.
  const noLineGapReason = (line: typeof coverage[number]): string | null => {
    if (candidateLineGap(line) !== null) return null
    if (olderPairedStore) return 'Bronmomenten meer dan 24 uur uiteen: vernieuw ' +
      olderPairedStore + ' met een echte waarneming.'
    for (const store of stores) {
      const capture = source.captures[store]
      if (!capture) return store + ': oorspronkelijke winkelbron ontbreekt.'
      if (!recentOwnCaptureInstant(capture.observedAt, clock))
        return store + ': opname is verlopen of komt uit de toekomst.'
      if (line.manualReview[store])
        return store + ': kies handmatig één van de meerdere passende originele SKU’s.'
      if (line.unpricedHints[store])
        return store + ': bestaande mogelijke SKU ' + line.unpricedHints[store]!.sku +
          ' heeft geen bruikbare brondata (' + line.unpricedHints[store]!.reason + ').'
      if (!line.suggestions[store])
        return store + ': geen passende, geprijsde en beschikbare oorspronkelijke SKU.'
    }
    return 'Er is nog geen controleerbaar prijsverschil voor dit ingrediënt.'
  }
  // Count ONLY provisional original-SKU rows, never imply an additive bill:
  // two physical ingredients may both map to a single pack of the same SKU.
  const previewRows = coverage.filter(line => candidateLineGap(line) !== null)
  const provisionalLower = {
    PLUS: previewRows.filter(line => candidateLineGap(line)! > 0).length,
    DekaMarkt: previewRows.filter(line => candidateLineGap(line)! < 0).length,
    equal: previewRows.filter(line => candidateLineGap(line) === 0).length,
  }
  // Only navigation to the existing manual product workbench: NEVER approve
  // an unverified candidate here. Pick the most material single-line hint.
  const largestPairedReview = [...previewRows].sort((a, b) =>
    Math.abs(candidateLineGap(b)!) - Math.abs(candidateLineGap(a)!))[0]
  const selectedStores = storeFilter === 'both' ? stores : [storeFilter]
  const term = productSearchText(search.trim())
  const filtered = (onlyMissing ? missing : coverage).filter(line => {
    if (term && ![
      line.need.label, line.need.id,
      ...stores.flatMap(store => [line.suggestions[store]?.name, line.suggestions[store]?.sku,
        line.unpricedHints[store]?.name, line.unpricedHints[store]?.sku]),
    ].some(value => value && productSearchText(value).includes(term))) return false
    if (actionFilter === 'choose-sku') return selectedStores.some(store => line.manualReview[store])
    if (actionFilter === 'fix-source') return selectedStores.some(store =>
      !!line.unpricedHints[store])
    if (actionFilter === 'capture') return selectedStores.some(store =>
      !line.suggestions[store] && !line.manualReview[store] &&
      !line.unpricedHints[store])
    if (actionFilter === 'paired') return stores.every(store => !!line.suggestions[store])
    return storeFilter === 'both' || selectedStores.some(store =>
      !line.suggestions[store] || line.manualReview[store])
  }).sort((a, b) => {
    if (sortMode === 'largest-provisional-gap') {
      const aGap = candidateLineGap(a)
      const bGap = candidateLineGap(b)
      if (aGap !== null || bGap !== null) {
        if (aGap === null) return 1
        if (bGap === null) return -1
        if (Math.abs(aGap) !== Math.abs(bGap))
          return Math.abs(bGap) - Math.abs(aGap)
      }
    }
    return priority(a) - priority(b) || a.need.label.localeCompare(b.need.label, 'nl')
  })
  const shown = filtered.slice(0, showAll ? 200 : 12)
  // Portable, non-financial next-action list for the CURRENT filters.
  // It never saves candidate prices, guesses a SKU, or alters imports.
  function actionListRows(): CoverageExportLine[] {
    const statusFor = (line: typeof coverage[number], store: 'PLUS' | 'DekaMarkt') => {
      const capture = source.captures[store]
      if (capture && !recentOwnCaptureInstant(capture.observedAt, Date.now()))
        return 'Bronopname verlopen of toekomstig · werkelijke winkelbron opnieuw opnemen'
      if (olderPairedStore === store)
        return 'Bronpaar meer dan 24 uur uiteen · oudste winkel opnieuw opnemen'
      if (line.manualReview[store]) return 'Kies zelf bestaande originele SKU in Vergelijk'
      const incomplete = line.unpricedHints[store]
      if (incomplete) return 'Originele mogelijke SKU ' + incomplete.sku +
        ' (' + incomplete.reason + ') · controleer echte brondata opnieuw'
      const candidate = line.suggestions[store]
      return candidate
        ? 'Onbevestigd bronvoorstel SKU ' + candidate.sku + ' · controleer verpakking in Vergelijk'
        : 'Geen passende geprijsde bron-SKU · echte waarneming ontbreekt'
    }
    return filtered.map(line => ({
      ingredientId: line.need.id,
      ingredient: line.need.label,
      demand: String(line.need.amount ?? 'onbekend') + ' ' + line.need.unit,
      plusStatus: statusFor(line, 'PLUS'),
      plusObservedAt: source.captures.PLUS?.observedAt ?? '',
      dekaStatus: statusFor(line, 'DekaMarkt'),
      dekaObservedAt: source.captures.DekaMarkt?.observedAt ?? '',
    }))
  }
  function actionListText(): string {
    return privateTwoStoreCoverageText(actionListRows())
  }
  function downloadActionList() {
    setActionMessage('')
    try {
      const output = actionListText()
      const url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-gefilterde-bronmatch-controles.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setActionMessage('Actuele selectie lokaal opgeslagen. Originele prijzen zijn niet bevestigd of gewijzigd.')
    } catch {
      setActionMessage('Geen geldige, beperkte selectie voor export. Kies eerst fysieke ingrediënten.')
    }
  }
  function downloadActionCsv() {
    setActionMessage('')
    try {
      // The same filtered physical needs and source status facts as the mobile
      // TXT list; this spreadsheet is an action sheet, not a price receipt.
      const output = privateTwoStoreCoverageCsv(actionListRows())
      const url = URL.createObjectURL(new Blob([output], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-gefilterde-plus-deka-broncontroles.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setActionMessage('Gefilterde bronacties als privé CSV opgeslagen. Dit bevat geen bevestigde mandprijzen.')
    } catch {
      setActionMessage('Kon de geselecteerde bronacties niet exporteren. Controleer de fysieke weekbehoefte.')
    }
  }
  async function copyActionList() {
    setActionMessage('')
    try {
      const output = actionListText()
      if (!navigator.clipboard?.writeText) throw new Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(output)
      setActionMessage('Je geselecteerde privé-SKU-controles zijn gekopieerd. Er zijn geen bronprijzen gewijzigd of bevestigd.')
    } catch {
      // No clipboard permissions on many mobile browsers / local previews.
      // Display the EXACT same safe formatter output as selectable plain text.
      setShowActionList(true)
      setActionMessage('Klembord geweigerd of niet beschikbaar. Selecteer de privé-controlelijst hieronder.')
    }
  }
  const needsForNewSource = (store: 'PLUS' | 'DekaMarkt',
    nowMs: number): PlannerCaptureGuideNeed[] => {
    const capture = source.captures[store]
    // Expired/missing original source: no SKU is a currently usable price.
    // More-than-24h pairs require a fresh recording of the older retailer,
    // even if its candidate list looks complete in isolation.
    if (!capture || !recentOwnCaptureInstant(capture.observedAt, nowMs) ||
        olderPairedStore === store) return [...needs]
    return missing.filter(({ suggestions, manualReview }) =>
      !suggestions[store] && !manualReview[store]).map(({ need }) => need)
  }
  const pendingPlus = needsForNewSource('PLUS', clock).length
  const pendingDeka = needsForNewSource('DekaMarkt', clock).length
  // The first concrete human decision, prioritized over unconfirmed name
  // suggestions. Never approve an SKU here; only navigate to the canonical
  // review workbench or to a deliberately empty real-source capture sheet.
  const nextReview = coverage.flatMap(line => stores.flatMap(store =>
    line.manualReview[store] ? [{ store, need: line.need, ambiguous: true }] : [],
  ))[0] ?? coverage.flatMap(line => stores.flatMap(store =>
    line.unpricedHints[store] ? [{ store, need: line.need, ambiguous: false, incomplete: true }] : [],
  ))[0] ?? coverage.flatMap(line => stores.flatMap(store =>
    line.suggestions[store] ? [{ store, need: line.need, ambiguous: false, incomplete: false }] : [],
  ))[0]
  const nextCapture = pendingPlus ? 'PLUS' : pendingDeka ? 'DekaMarkt' : null
  const firstIncompleteStore = (stores as readonly ('PLUS' | 'DekaMarkt')[])
    .find(store => sourceKnownButUnpriced[stores.indexOf(store)] > 0)
  const firstAmbiguousStore = (stores as readonly ('PLUS' | 'DekaMarkt')[])
    .find(store => requiringChoice[stores.indexOf(store)] > 0)
  function focusOriginalSourceAction(store: 'PLUS' | 'DekaMarkt',
    action: 'choose-sku' | 'fix-source') {
    // Only filters the actual imported source. Never confirms or changes an SKU.
    setStoreFilter(store)
    setActionFilter(action)
    setSearch('')
    setOnlyMissing(true)
    setShowAll(true)
  }
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
            {' · '}{recentOwnCaptureInstant(capture.observedAt, clock)
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
    {previewRows.length > 0 && <p className="supa-planner-source-matches__tentative-summary">
      <strong>Alleen voorlopige SKU-regels uit je twee oorspronkelijke bronnen:</strong>
      {' '}{provisionalLower.PLUS} ingrediëntregels met lagere PLUS-hele-pakkenregel,
      {' '}{provisionalLower.DekaMarkt} met lagere DekaMarkt-regel,
      {' '}{provisionalLower.equal} gelijk.
      {' '}Geen winnaar voor het hele mandje: productkeuzes zijn niet bevestigd,
      {' '}dezelfde verpakking kan meerdere ingrediënten dekken.
      {' '}Controleer de volledige mandjes in Vergelijk.
      {largestPairedReview && onReviewIngredient && <button
        type="button" className="ghost-button supa-planner-source-matches__paired-next"
        onClick={() => {
          const capture = source.captures.PLUS
          if (source.pairedWithin24h && capture &&
              recentOwnCaptureInstant(capture.observedAt, Date.now()) &&
              source.captures.DekaMarkt &&
              recentOwnCaptureInstant(source.captures.DekaMarkt.observedAt, Date.now()))
            onReviewIngredient('PLUS', largestPairedReview.need.id)
        }}>
        Controleer grootste voorlopige regelverschil in Vergelijk:
        {' '}{largestPairedReview.need.label}
      </button>}
    </p>}
    <div className="supa-planner-source-matches__next" aria-label="Snel door met je echte broncontrole">
      <strong>Volgende stappen naar een vergelijkbaar weekmandje</strong>
      <p>Nieuwe bronregels: PLUS {pendingPlus}, DekaMarkt {pendingDeka}.
        {' '}Twijfelachtige originele SKU-keuzes: PLUS {requiringChoice[0]}, DekaMarkt {requiringChoice[1]}.
        {' '}Mogelijk bestaande SKU zonder bruikbare bronprijs/verpakking/beschikbaarheid:
        {' '}PLUS {sourceKnownButUnpriced[0]}, DekaMarkt {sourceKnownButUnpriced[1]}.
        {' '}Kandidaten zijn nog niet definitief gecontroleerd.</p>
      <div className="supa-planner-source-matches__next-actions">
        {firstIncompleteStore && <button type="button" className="ghost-button"
          onClick={() => focusOriginalSourceAction(firstIncompleteStore, 'fix-source')}>
          Bekijk eerst {sourceKnownButUnpriced[stores.indexOf(firstIncompleteStore)]}
          {' '}bestaande {firstIncompleteStore}-artikelen waarvan prijs, pak of beschikbaarheid ontbreekt
        </button>}
        {firstAmbiguousStore && <button type="button" className="ghost-button"
          onClick={() => focusOriginalSourceAction(firstAmbiguousStore, 'choose-sku')}>
          Toon {requiringChoice[stores.indexOf(firstAmbiguousStore)]}
          {' '}onzekere {firstAmbiguousStore}-SKU-keuzes voor menselijke controle
        </button>}
        {nextCapture && onRecapture && <button type="button" className="ghost-button"
          onClick={() => onRecapture(nextCapture)}>
          1. Open {nextCapture}-opnameblad voor werkelijke ontbrekende brondata
        </button>}
        {nextReview && onReviewIngredient && <button type="button" className="ghost-button"
          onClick={() => {
            const capture = source.captures[nextReview.store]
            if (olderPairedStore !== nextReview.store && capture &&
                recentOwnCaptureInstant(capture.observedAt, Date.now()))
              onReviewIngredient(nextReview.store, nextReview.need.id)
          }}>
          {nextCapture ? '2.' : '1.'} Beoordeel {nextReview.need.label} bij {nextReview.store}
          {nextReview.ambiguous ? ' (meerdere SKU’s)' :
            'incomplete' in nextReview && nextReview.incomplete
              ? ' (bestaande SKU mist brondata)' : ' (bron-SKU nog onbevestigd)'}
        </button>}
      </div>
      {!nextCapture && !nextReview && <small>
        Er zijn geen voorlopige bronvoorstellen of ontbrekende bronregels over.
        Controleer de volledige fysieke mandjes en het prijsverschil in Vergelijk.
      </small>}
    </div>
    {(requiringChoice[0] > 0 || requiringChoice[1] > 0) && <p role="status">
      <strong>Handmatige bronkeuze vereist:</strong> {requiringChoice[0]} PLUS-
      en {requiringChoice[1]} DekaMarkt-ingrediënten hebben meerdere
      vergelijkbaar passende echte bronproducten. Kies de juiste oorspronkelijke
      SKU in Vergelijk; voor deze bestaande artikelen hoeft niet opnieuw een
      fictieve winkelopname te worden aangevraagd.
    </p>}
    <p><strong>Dit zijn onbevestigde naam- en verpakkingssuggesties.</strong> Een
      winkelprijs of besparing ontstaat pas nadat Vergelijk de originele SKU,
      benodigde hele verpakkingen, volledige mandjes en bronmomenten controleert.</p>
    <div className="supa-planner-source-matches__controls" aria-label="Zoek en filter bronmatches">
      <label>Zoek ingrediënt, product of SKU
        <input type="search" maxLength={120} value={search}
          placeholder="Bijvoorbeeld rijst of originele SKU"
          onChange={event => { setSearch(event.currentTarget.value); setShowAll(false) }} />
      </label>
      <label>Winkel
        <select value={storeFilter} onChange={event => {
          setStoreFilter(event.currentTarget.value as typeof storeFilter); setShowAll(false)
        }}>
          <option value="both">Beide winkels</option>
          <option value="PLUS">PLUS: openstaande controles</option>
          <option value="DekaMarkt">DekaMarkt: openstaande controles</option>
        </select>
      </label>
      <label>Volgende stap
        <select value={actionFilter} onChange={event => {
          setActionFilter(event.currentTarget.value as typeof actionFilter); setShowAll(false)
        }}>
          <option value="all">Alle productregels</option>
          <option value="choose-sku">Kies bestaande SKU in Vergelijk</option>
          <option value="fix-source">Bestaande SKU mist pakprijs of brondata</option>
          <option value="capture">Geen geschikte originele SKU beschikbaar</option>
          <option value="paired">Voorstel voor beide winkels</option>
        </select>
      </label>
      <label>Sorteren
        <select value={sortMode} onChange={event => {
          setSortMode(event.currentTarget.value as typeof sortMode)
          setShowAll(false)
        }}>
          <option value="review-first">Ontbrekende en onzekere SKU’s eerst</option>
          <option value="largest-provisional-gap">Grootste voorlopige prijsregelverschil eerst</option>
        </select>
      </label>
      <label className="supa-planner-source-matches__check">
        <input type="checkbox" checked={onlyMissing}
          onChange={e => { setOnlyMissing(e.target.checked); setShowAll(false) }} />
        Alleen ontbrekende of onzekere bronmatches
      </label>
    </div>
    <p role="status">{filtered.length} van {coverage.length} ingrediënten in beeld;
      {' '}{shown.length} nu getoond. Onzekere matches staan eerst.
      Filters wijzigen nooit je mand of winkelprijzen.</p>
    <div className="supa-planner-source-matches__table" role="table"
      aria-label="Voorlopige bronmatching voor hetzelfde fysieke weekmandje">
      <div className="supa-planner-source-matches__row supa-planner-source-matches__row--head" role="row">
        <strong role="columnheader">Fysieke behoefte</strong>
        <strong role="columnheader">PLUS</strong>
        <strong role="columnheader">DekaMarkt</strong>
      </div>
      {shown.map(({ need, suggestions, manualReview, unpricedHints }) => <div className="supa-planner-source-matches__row"
        role="row" key={need.id}>
        <span role="cell" data-store="Fysieke behoefte"><strong>{need.label}</strong>
          <small>{need.amount ?? 'Onbekend'} {need.unit}</small>
          {source.pairedWithin24h && suggestions.PLUS && suggestions.DekaMarkt &&
            (() => {
              // Exact source-derived line arithmetic for the SAME physical
              // ingredient, but two *unconfirmed* SKU choices. Do not sum:
              // one SKU may cover multiple ingredients in a canonical basket.
              const diff = suggestions.DekaMarkt.lineCents - suggestions.PLUS.lineCents
              return <span className="supa-planner-source-matches__tentative-delta">
                <small>Alleen dit ingrediënt · voorlopige hele-pakkenregel:
                  {' '}PLUS {exactEuro(suggestions.PLUS.lineCents)},
                  {' '}DekaMarkt {exactEuro(suggestions.DekaMarkt.lineCents)}.
                </small>
                <small>Verschil Deka min PLUS:
                  {' '}{diff === 0 ? 'gelijk (' + exactEuro(0) + ')' :
                    (diff > 0 ? '+' : '−') + exactEuro(Math.abs(diff))}.
                  {' '}Nog geen bevestigd prijsverschil of mandbesparing.
                </small>
              </span>
            })()}
          {noLineGapReason({ need, suggestions, manualReview, unpricedHints }) &&
            <small className="supa-planner-source-matches__missing-delta">
              Prijsverschil onbekend:
              {' '}{noLineGapReason({ need, suggestions, manualReview, unpricedHints })}
            </small>}</span>
        {stores.map(store => <span role="cell" data-store={store} key={store}>
          {suggestions[store] ? <>Kandidaat: {suggestions[store]!.name}
            <small>SKU {suggestions[store]!.sku} · niet bevestigd</small>
            <small>{suggestions[store]!.packCount} × {suggestions[store]!.packAmount}
              {' '}{suggestions[store]!.packUnit} · opgenomen bronpakprijs
              {' '}{exactEuro(suggestions[store]!.packCents)}
              {suggestions[store]!.unitRate
                ? ' · informatief ' + suggestions[store]!.unitRate : ''}
              {' '}· bronmoment niet automatisch gevalideerd</small>
            <small>{suggestions[store]!.packsNeeded} hele verpakking(en) voor
              alleen dit ingrediënt · voorlopige regel
              {' '}{exactEuro(suggestions[store]!.lineCents)}
              {' '}volgens exacte metrische behoefte;
              {' '}niet bevestigd, gedeelde producten pas in Vergelijk samenvoegen.</small></>
            : source.captures[store] &&
              !recentOwnCaptureInstant(source.captures[store]!.observedAt, clock)
              ? 'Verlopen of toekomstige bron: geen actueel geprijsd voorstel; leg een echte nieuwe opname vast'
            : olderPairedStore === store
              ? 'Bronpaar >24 uur uiteen: neem deze oudste winkel opnieuw op voordat je prijzen vergelijkt'
            : manualReview[store]
              ? 'Meerdere geschikte SKU’s: kies de juiste originele verpakking zelf in Vergelijk'
              : unpricedHints[store]
                ? <>Mogelijke bestaande originele SKU: {unpricedHints[store]!.sku}
                  <small>{unpricedHints[store]!.name} · {unpricedHints[store]!.reason}.
                    Dit is geen beschikbare prijs of bevestigde productmatch;
                    controleer de werkelijkheid vóór een nieuwe opname.</small></>
                : 'Geen geschikte geprijsde SKU in deze bron; ontbrekende bron vastleggen'}
          {onReviewIngredient && (suggestions[store] || manualReview[store] ||
            unpricedHints[store]) &&
            source.captures[store] &&
            recentOwnCaptureInstant(source.captures[store]!.observedAt, clock) &&
            <button type="button" className="ghost-button"
              onClick={() => onReviewIngredient(store, need.id)}>
              {unpricedHints[store] && !suggestions[store] && !manualReview[store]
                ? 'Bekijk bestaande maar ongeprijsde ' + store + '-SKU in Vergelijk'
                : 'Controleer deze ' + store + '-SKU in Vergelijk'}
            </button>}
          {onRecapture && !suggestions[store] && !manualReview[store] &&
            <button type="button" className="ghost-button"
              onClick={() => onRecapture(store)}>
              Open leeg {store}-opnameblad
            </button>}
        </span>)}
      </div>)}
    </div>
    {filtered.length === 0 && <div role="status">
      <p>Geen matches voor deze filters. Dit is geen prijs- of bronbewijs.</p>
      <button type="button" className="ghost-button" onClick={() => {
        setSearch(''); setStoreFilter('both'); setActionFilter('all')
        setOnlyMissing(false); setShowAll(false)
      }}>Toon alle ingrediënten</button>
    </div>}
    <div className="supa-planner-source-matches__exports" aria-label="Mijn geselecteerde productcontroles meenemen">
      <button type="button" className="ghost-button" onClick={downloadActionList}
        disabled={!filtered.length}>
        Download deze SKU-controles als privé TXT
      </button>
      <button type="button" className="ghost-button" onClick={downloadActionCsv}
        disabled={!filtered.length}>
        Download deze SKU-controles als spreadsheet-CSV
      </button>
      <button type="button" className="ghost-button" disabled={!filtered.length}
        onClick={() => { void copyActionList() }}>
        Kopieer geselecteerde SKU-controles direct
      </button>
      <button type="button" className="ghost-button" disabled={!filtered.length}
        aria-expanded={showActionList} onClick={() => setShowActionList(value => !value)}>
        {showActionList ? 'Verberg kopieerbare lijst' : 'Bekijk kopieerbare SKU-controles (mobiel)'}
      </button>
      {showActionList && filtered.length > 0 && <label className="supa-planner-source-matches__mobile-guide">
        Alleen de huidige filters; geen geverifieerde winkelprijzen of mandbesparing
        <textarea readOnly rows={11} value={(() => {
          try { return actionListText() }
          catch { return 'Actielijst te groot of ongeldig. Verklein de selectie.' }
        })()} onFocus={event => event.currentTarget.select()}
          aria-label="Selecteer mijn huidige SKU-controlelijst" />
      </label>}
      {actionMessage && <p role="status">{actionMessage}</p>}
    </div>
    {(pendingPlus > 0 || pendingDeka > 0) && <div className="supa-planner-source-matches__exports">
      <p><strong>Nieuwe echte bronopname vereist:</strong>
        {' '}{pendingPlus} PLUS- en {pendingDeka} DekaMarkt-regels.
        Onduidelijke bestaande SKU-keuzes gaan naar Vergelijk en niet naar dit
        nieuwe bronblad. Ontbrekende prijzen vragen alleen ontbrekende SKU’s;
        bij een verouderde
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
