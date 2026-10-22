import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { freshReviewedBaskets, recentOwnCaptureInstant, type PrivateReviewedBaskets, type PrivateCaptureProgress, type OwnStore, type PrivateRouteChoice } from '../comparison/privateReviewedBasketBridge.ts'
import { privatePriceAgeNotice } from '../comparison/privatePriceAgeNotice.ts'
import { currentPrivateRouteChoice } from '../comparison/privateRouteChoice.ts'
import { parsePrivateExtraVisitCostCents } from '../comparison/privateExtraVisitCost.ts'
import { ownStoreWeekComparison } from './ownStoreBudgetComparison.ts'
// Native share requires transient user activation, so its existing trusted
// formatter must be ready synchronously before opening the OS share sheet.
import { printableOwnStoreComparison } from './downloadOwnStoreComparison.ts'
// Price deltas only exist after both sources are fully reviewed; defer these
// heavier presentational modules so the everyday Planner loads sooner.
const PlannerKnownLinePrices = lazy(() => import('./PlannerKnownLinePrices.tsx')
  .then(module => ({ default: module.PlannerKnownLinePrices })))
const PlannerOwnProductDeltas = lazy(() => import('./PlannerOwnProductDeltas.tsx')
  .then(module => ({ default: module.PlannerOwnProductDeltas })))
const PlannerTwoStoreCoverage = lazy(() => import('./PlannerTwoStoreCoverage.tsx')
  .then(module => ({ default: module.PlannerTwoStoreCoverage })))
const PlannerMissingCapturePanel = lazy(() => import('./PlannerMissingCapturePanel.tsx')
  .then(module => ({ default: module.PlannerMissingCapturePanel })))
const PrivateOwnReceiptViewer = lazy(() => import('./PrivateOwnReceiptViewer.tsx')
  .then(module => ({ default: module.PrivateOwnReceiptViewer })))
const PrivateOwnReceiptHistory = lazy(() => import('./PrivateOwnReceiptHistory.tsx')
  .then(module => ({ default: module.PrivateOwnReceiptHistory })))
const PlannerReviewedSourceLines = lazy(() => import('./PlannerReviewedSourceLines.tsx')
  .then(module => ({ default: module.PlannerReviewedSourceLines })))
const PlannerQuickSourcePaste = lazy(() => import('./PlannerQuickSourcePaste.tsx')
  .then(module => ({ default: module.PlannerQuickSourcePaste })))
import type { CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { validCustomWeekBudgetEuros } from './customWeekBudget.ts'
import { euro as exactEuro } from '../../lib/money.ts'
import { confirmedPartialBasket } from './confirmedPartialBasket.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { privateMatchedUnitPriceGap } from '../products/privateProgressProductRows.ts'
import './plannerOwnStoreComparison.css'

const stores = ['PLUS', 'DekaMarkt'] as const

/** Exact own-source totals only. No fixture or unreviewed prices. */
export function PlannerOwnStoreComparison({ reviewed, captureProgress, preferred, hasDemand, budget, onSelect, onOpenComparison, onImportSourceFiles, onReviewIngredient, onOpenList, onOpenMixedRoute, onChooseRouteLine, captureNeeds }: {
  reviewed: PrivateReviewedBaskets | null
  captureProgress: PrivateCaptureProgress | null
  captureNeeds: readonly PlannerCaptureGuideNeed[]
  preferred: OwnStore
  hasDemand: boolean
  budget: number
  onSelect: (store: OwnStore) => void
  onOpenComparison: () => void
  onImportSourceFiles: (files: File[]) => void
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onOpenList: () => void
  onOpenMixedRoute: (extraCostRaw?: string) => void
  onChooseRouteLine: (choice: Omit<PrivateRouteChoice, 'serial'>) => void
}) {
  const [downloadMessage, setDownloadMessage] = useState('')
  // Do not authorize an asynchronous copy/download against a source object
  // that another render (e.g. another tab's replacement) has already removed.
  const currentReviewedRef = useRef(reviewed)
  currentReviewedRef.current = reviewed
  const [copyableStore, setCopyableStore] = useState<{
    store: OwnStore
    receipt: NonNullable<PrivateReviewedBaskets['stores'][OwnStore]>
    text: string
  } | null>(null)

  const [copyableComparison, setCopyableComparison] = useState<{
    plus: NonNullable<PrivateReviewedBaskets['stores']['PLUS']>
    deka: NonNullable<PrivateReviewedBaskets['stores']['DekaMarkt']>
    costRaw: string
    text: string
  } | null>(null)
  const [directImportMessage, setDirectImportMessage] = useState('')
  const [directDropActive, setDirectDropActive] = useState(false)
  const [filteredCopy, setFilteredCopy] = useState<{
    planKey: string
    plus: NonNullable<PrivateReviewedBaskets['stores']['PLUS']>
    deka: NonNullable<PrivateReviewedBaskets['stores']['DekaMarkt']>
    text: string
  } | null>(null)
  function takeOwnSourceFiles(files: File[]) {
    // Early UX-only guards: these never verify the store, its rights or SKU.
    // All original bytes still pass the canonical import in Vergelijk.
    if (files.length === 0) return
    if (files.length > 2) {
      setDirectImportMessage('Selecteer maximaal twee bestanden: één eigen PLUS- en één DekaMarkt-opname.')
      return
    }
    if (files.some(file => file.size === 0 || file.size > 256000)) {
      setDirectImportMessage('Elk bronbestand moet gevuld zijn en maximaal 256 kB groot zijn.')
      return
    }
    setDirectImportMessage('')
    onImportSourceFiles(files)
  }

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const [captureTarget, setCaptureTarget] = useState<'both' | CaptureStore>('both')
  const [secondStopCost, setSecondStopCost] = useState<{ key: string; raw: string }>({ key: '', raw: '' })
  // Never let a long-open Planner keep displaying expired personal prices.
  const currentSources = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', now)
  const summary = ownStoreWeekComparison(currentSources)
  const expiredSources = !!reviewed &&
    (Object.keys(reviewed.stores) as OwnStore[]).some(store =>
      !!reviewed.stores[store] && !currentSources?.stores[store])
  const exactBudget = validCustomWeekBudgetEuros(budget)
  const budgetCents = exactBudget === null ? null : Math.round(exactBudget * 100)
  // An own travel-cost scenario cannot silently follow a replaced source.
  const costSourceKey = JSON.stringify([
    reviewed?.planKey, reviewed?.stores.PLUS?.observedAt,
    reviewed?.stores.DekaMarkt?.observedAt, summary,
  ])
  const shownCost = secondStopCost.key === costSourceKey ? secondStopCost.raw : ''
  const parsedSecondStopCents = parsePrivateExtraVisitCostCents(shownCost)
  // The canonical basket supplies safe integer cents. A user's additional
  // stop cost can push their *sum* beyond Number.MAX_SAFE_INTEGER: retain
  // exact cents for all displayed travel and week-budget calculations.
  const mixedTripCents = summary.status === 'comparable' && summary.mixedRoute &&
    parsedSecondStopCents !== null
    ? BigInt(summary.mixedRoute.totalCents) + BigInt(parsedSecondStopCents) : null
  const mixedNetDifferenceCents = summary.status === 'comparable' && summary.mixedRoute &&
    parsedSecondStopCents !== null
    ? BigInt(summary.mixedRoute.possibleProductDifferenceCents) - BigInt(parsedSecondStopCents) : null
  const mixedBudgetDifferenceCents = mixedTripCents !== null && budgetCents !== null
    ? mixedTripCents - BigInt(budgetCents) : null

  const selected = currentSources?.stores[preferred] ? preferred : currentSources?.stores.PLUS ? 'PLUS' : currentSources?.stores.DekaMarkt ? 'DekaMarkt' : preferred
  function selectCurrentStore(store: OwnStore) {
    if (!freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store]) {
      setDownloadMessage('Deze winkelprijs is verlopen of veranderd. Herzie de originele bron in Vergelijk.')
      return
    }
    setDownloadMessage('')
    onSelect(store)
  }
  function openCurrentMixedRoute() {
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    if (ownStoreWeekComparison(current).status !== 'comparable') {
      setDownloadMessage('De winkelprijzen zijn verlopen of niet vergelijkbaar. Herzie de bronnen eerst.')
      return
    }
    // Do not silently discard an invalid entered travel/parking amount and
    // open the route as if no cost had been entered. Unspecified stays unknown.
    if (shownCost.trim() && parsedSecondStopCents === null) {
      setDownloadMessage('Corrigeer eerst de extra winkelstopkosten (€ 0,00 tot € 1.000,00, maximaal twee decimalen). De route is niet gewijzigd.')
      return
    }
    setDownloadMessage('')
    onOpenMixedRoute(shownCost.trim() ? shownCost : undefined)
  }
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
  async function copyReviewQueue() {
    setDownloadMessage('')
    try {
      if (!captureProgress) throw new Error('Er zijn nog geen eigen winkelopnames.')
      if (!navigator.clipboard?.writeText)
        throw new Error('Klembord niet beschikbaar in deze browser.')
      const { pendingOwnSourceReviewText } = await import('./pendingOwnSourceReviewCsv.ts')
      const output = pendingOwnSourceReviewText(captureProgress, captureProgress.planKey, Date.now())
      await navigator.clipboard.writeText(output)
      setDownloadMessage('Je openstaande PLUS/Deka-winkelcontroles gekopieerd. Geen onbekende prijzen als bedragen overgenomen.')
    } catch {
      setDownloadMessage('Mobiel kopiëren niet beschikbaar. Download de privé-CSV voor dezelfde openstaande controles.')
    }
  }
  async function downloadReviewQueue() {
    setDownloadMessage('')
    try {
      if (!captureProgress) throw new Error('Importeer eerst je eigen winkelbronnen in Vergelijk.')
      const { pendingOwnSourceReviewCsv } = await import('./pendingOwnSourceReviewCsv.ts')
      const csv = pendingOwnSourceReviewCsv(captureProgress, captureProgress.planKey, Date.now())
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-openstaande-eigen-winkelcontroles.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage('Openstaande PLUS/Deka-productcontroles lokaal opgeslagen, zonder verzonnen winkelprijs.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Controlelijst downloaden mislukt.')
    }
  }
  async function downloadFieldSheet(kind: 'csv' | 'csv-excel' | 'tsv' | 'guide') {
    setDownloadMessage('')
    try {
      const stores: readonly CaptureStore[] = captureTarget === 'both'
        ? ['PLUS', 'DekaMarkt'] : [captureTarget]
      const source = kind !== 'guide'
        ? (await import('../comparison/plannerPriceCaptureSheet.ts'))
          .makeBlankPlannerCaptureCsv(captureNeeds, stores, kind === 'csv-excel' ? ';' : kind === 'tsv' ? '\t' : ',')
        : (await import('../comparison/plannerPriceCaptureGuide.ts'))
          .makePlannerCaptureGuide(captureNeeds, stores)
      const url = URL.createObjectURL(new Blob([source], {
        type: kind === 'tsv' ? 'text/tab-separated-values;charset=utf-8' :
          kind === 'guide' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-planner-' + captureTarget.toLowerCase() +
          (kind === 'csv' ? '-lege-winkelopname.csv' :
            kind === 'csv-excel' ? '-lege-winkelopname-spreadsheet.csv' :
            kind === 'tsv' ? '-lege-winkelopname.tsv' : '-opnamegids.txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage('Leeg ' + (kind !== 'guide' ? 'prijsinvulblad' : 'opnameformulier') +
        ' van dit weekmenu gedownload. Vul werkelijk waargenomen bronproducten in en importeer ze in Vergelijk.')
    } catch {
      setDownloadMessage('Prijsinvulblad niet beschikbaar. Controleer de fysieke ingrediënten en weekdagen.')
    }
  }
  async function downloadPrivateComparison() {
    setDownloadMessage('')
    try {
      // Load the formatter before authorizing the export: asynchronous module
      // loading must not preserve a price that has since passed its deadline.
      const { printableOwnStoreComparison, downloadOwnStoreText } = await import('./downloadOwnStoreComparison.ts')
      if (!reviewed) throw new Error('Geen persoonlijke bronopnames beschikbaar.')
      const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
      const fresh = ownStoreWeekComparison(current)
      if (fresh.status !== 'comparable' || !current?.stores.PLUS || !current.stores.DekaMarkt) {
        throw new Error('De bronopnames zijn verlopen of niet meer vergelijkbaar. Werk ze bij in Vergelijk.')
      }
      if (shownCost.trim() && parsedSecondStopCents === null) {
        throw new Error('Corrigeer de extra winkelstopkosten vóór je de privévergelijking deelt.')
      }
      downloadOwnStoreText(printableOwnStoreComparison(fresh, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      }, shownCost.trim() ? parsedSecondStopCents : null))
      setDownloadMessage('Je eigen twee-winkelvergelijking is lokaal gedownload.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Download is niet gelukt.')
    }
  }
  async function copyPrivateComparison() {
    setDownloadMessage('')
    setCopyableComparison(null)
    try {
      // A price can cross the seven-day boundary while this tab stays open.
      // Clipboard emission is a new action: re-admit both original sources
      // and their same-demand whole-pack comparison at the time of copying.
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const fresh = ownStoreWeekComparison(current)
      if (!current?.stores.PLUS || !current.stores.DekaMarkt || fresh.status !== 'comparable') {
        throw new Error('De winkelprijzen zijn verlopen of niet volledig gecontroleerd. Herzie eerst de originele bronnen.')
      }
      // Read the clock again immediately before the clipboard operation.
      const latest = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const checked = ownStoreWeekComparison(latest)
      if (!latest?.stores.PLUS || !latest.stores.DekaMarkt || checked.status !== 'comparable') {
        throw new Error('Je bronopnames zijn veranderd of verlopen; kopiëren is geannuleerd.')
      }
      const { printableOwnStoreComparison } = await import('./downloadOwnStoreComparison.ts')
      // Source can expire during a delayed module load; check again before copy.
      const currentAtCopy = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const copySummary = ownStoreWeekComparison(currentAtCopy)
      if (!currentAtCopy?.stores.PLUS || !currentAtCopy.stores.DekaMarkt ||
          copySummary.status !== 'comparable') throw Error('Winkelbron is verlopen')
      if (shownCost.trim() && parsedSecondStopCents === null) {
        throw new Error('Corrigeer de extra winkelstopkosten vóór het kopiëren.')
      }
      const content = printableOwnStoreComparison(copySummary, {
        PLUS: currentAtCopy.stores.PLUS.observedAt,
        DekaMarkt: currentAtCopy.stores.DekaMarkt.observedAt,
      }, shownCost.trim() ? parsedSecondStopCents : null)
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content)
          setDownloadMessage('Eigen PLUS/Deka-weekvergelijking met bronmomenten en originele SKU’s gekopieerd. Deel alleen bewust je privébrondata.')
          return
        } catch { /* Browsers can deny clipboard access, including on mobile. */ }
      }
      // Never expose a printable fallback when original reviewed sources have
      // expired during an asynchronous clipboard permission prompt.
      const currentFallback = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      if (currentFallback?.stores.PLUS !== currentAtCopy.stores.PLUS ||
          currentFallback?.stores.DekaMarkt !== currentAtCopy.stores.DekaMarkt ||
          ownStoreWeekComparison(currentFallback).status !== 'comparable') {
        throw Error('Originele bronprijzen verlopen tijdens kopiëren.')
      }
      setCopyableComparison({ plus: currentAtCopy.stores.PLUS, deka: currentAtCopy.stores.DekaMarkt,
        costRaw: shownCost, text: content })
      setDownloadMessage('Klembordtoegang ontbreekt. Selecteer de actuele privévergelijking hieronder en kopieer handmatig.')
    } catch {
      setDownloadMessage('Deze vergelijking of de ingevulde kosten zijn ongeldig of verlopen. Controleer je eigen bronnen en kosten, of download opnieuw.')
    }
  }
  /** Native opt-in share only for the original reviewed same-demand 2-store
   * result. The existing formatter retains the private-source disclaimer and
   * exact whole-pack prices; this path never creates a public savings claim. */
  async function sharePrivateComparison() {
    setDownloadMessage('')
    if (typeof navigator.share !== 'function') {
      await copyPrivateComparison()
      return
    }
    try {
      // Browser share needs a synchronous click-to-chooser path: re-admit
      // original timestamps and complete same-demand baskets immediately.
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const exact = ownStoreWeekComparison(current)
      if (exact.status !== 'comparable' || !current?.stores.PLUS || !current.stores.DekaMarkt)
        throw new Error('De originele winkelbronnen zijn niet meer actueel en volledig vergelijkbaar.')
      const text = printableOwnStoreComparison(exact, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      })
      if (new TextEncoder().encode(text).length > 128_000)
        throw new Error('De privévergelijking is te groot om direct te delen. Gebruik TXT-download.')
      // The OS chooser is a deliberate user handoff; no endpoint, recipient or
      // cloud transmission is selected or triggered by Supa itself.
      await navigator.share({
        title: 'Supa · eigen privé PLUS/DekaMarkt-vergelijking', text,
      })
      setDownloadMessage('Je eigen gecontroleerde vergelijking is via je gekozen app gedeeld; dit is geen kassagarantie of publieke besparingsclaim.')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setDownloadMessage(cause instanceof Error ? cause.message :
        'Delen van de privévergelijking is mislukt; gebruik de bestaande TXT-download.')
    }
  }

  async function downloadPrivateCsv() {
    setDownloadMessage('')
    try {
      const { downloadOwnStoreCsv } = await import('./downloadOwnStoreComparison.ts')
      // Re-admit both original captures at the actual emission instant.
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const fresh = ownStoreWeekComparison(current)
      if (!current?.stores.PLUS || !current.stores.DekaMarkt || fresh.status !== 'comparable') {
        throw new Error('Voor deze CSV zijn twee actuele en volledig gecontroleerde winkelmandjes nodig.')
      }
      downloadOwnStoreCsv(current, fresh)
      setDownloadMessage('De privévergelijking met originele SKU’s en gehele centprijzen is lokaal als CSV gedownload.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'CSV-download mislukt.')
    }
  }
  async function downloadPrivateJson() {
    setDownloadMessage('')
    try {
      // Loading the exporter must not keep a now-expired capture eligible.
      const { downloadPrivateOwnComparisonReceipt } = await import('./privateOwnComparisonReceipt.ts')
      downloadPrivateOwnComparisonReceipt(reviewed)
      setDownloadMessage('Privé-JSON met dezelfde fysieke weekvraag, originele SKU’s, bronmomenten, pakprijzen en het mandverschil lokaal opgeslagen. Dit rapport is geen opnieuw importeerbare bron of publiek besparingsbewijs.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Het privé-JSON-rapport kon niet worden gemaakt.')
    }
  }
  async function downloadPrivateHtml() {
    setDownloadMessage('')
    try {
      const { privateComparisonHtml } = await import('../comparison/PrivateBasketComparisonExport.tsx')
      // A slow lazy import cannot grandfather a stale, non-paired price.
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
          ownStoreWeekComparison(current).status !== 'comparable') {
        throw new Error('Er zijn twee actuele en volledig gecontroleerde mandjes nodig voor deze afdruk.')
      }
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
  /**
   * A complete single-store basket remains useful even when the other shop
   * cannot be compared. Export the existing canonical Lijst serializers,
   * not a parallel calculator with weaker price or physical-pack admission.
   */
  async function downloadSingleStoreBasket(store: OwnStore, kind: 'csv' | 'html') {
    setDownloadMessage('')
    try {
      const original = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store]
      if (!original) throw new Error('Deze winkelopname is niet meer actueel of volledig. Herzie de bron in Vergelijk.')
      const content = kind === 'html'
        ? (await import('../shopping-list/privateSingleStorePrintableHtml.ts'))
          .privateSingleStorePrintableHtml({
            basket: original.basket, observedAt: original.observedAt, done: new Set<string>(),
          })
        : (await import('../shopping-list/privateSourceShoppingCsv.ts'))
          .privateSingleStoreShoppingCsv({
            basket: original.basket, observedAt: original.observedAt, done: new Set<string>(),
          })
      // An asynchronously loaded formatter must not authorize a source that
      // expired or changed during its load. The same exact object stays valid.
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store]
      if (current !== original) throw new Error('De bronopname is gewijzigd of verlopen. Probeer de actuele winkelbron opnieuw.')
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'html' ? 'text/html;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() +
          '-eigen-weekboodschappen.' + kind
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setDownloadMessage(store + ': volledig privémandje met originele SKU’s, pakprijzen, bronmoment en eenheidsprijzen opgeslagen. Er is geen tweede winkelprijs of besparing verzonnen.')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Deze bron kan niet worden geëxporteerd.')
    }
  }

  async function copySingleStoreBasket(store: OwnStore) {
    setDownloadMessage('')
    setCopyableStore(null)
    try {
      const receipt = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store]
      if (!receipt) throw new Error('De eigen winkelbron is niet actueel of niet volledig gecontroleerd.')
      const { privateSingleStoreShoppingText } =
        await import('../shopping-list/privateSingleStoreShoppingText.ts')
      const content = privateSingleStoreShoppingText({
        basket: receipt.basket, observedAt: receipt.observedAt,
      })
      if (freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store] !== receipt)
        throw new Error('De winkelbron is gewijzigd of verlopen. Controleer opnieuw in Vergelijk.')
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content)
          setDownloadMessage(store + ': je volledige privéboodschappenlijst is gekopieerd. Geen tweede winkelprijs verzonnen.')
          return
        } catch { /* Use the same locally generated text below. */ }
      }
      if (freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())?.stores[store] !== receipt)
        throw new Error('De bron is verlopen tijdens het kopiëren. Herzie de winkelbron.')
      setCopyableStore({ store, receipt, text: content })
      setDownloadMessage(store + ': selecteer en kopieer de eigen lijst hieronder (klembordtoegang ontbreekt).')
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : 'Je winkelmandje kan niet worden gekopieerd.')
    }
  }

  async function downloadSelectedProductPrices(ids: string[], action: 'download' | 'copy' | 'csv' | 'print') {
    // Export the actual current reviewed pair, never stale rows held by a
    // filtered child view. A filtered selection is NOT a full basket total.
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const paired = ownStoreWeekComparison(current)
    if (paired.status !== 'comparable' || !current?.stores.PLUS || !current.stores.DekaMarkt) {
      setDownloadMessage('De twee winkelbronnen zijn verlopen of niet meer vergelijkbaar. Herzie de bron in Vergelijk.')
      return
    }
    const byId = new Map(paired.lines.map(line => [line.id, line]))
    const unique = [...new Set(ids)]
    if (!unique.length || unique.some(id => !byId.has(id))) {
      setDownloadMessage('Je productselectie is veranderd. Controleer de filters en probeer opnieuw.')
      return
    }
    const selected = unique.map(id => byId.get(id)!)
    // Product and ingredient names may originate in pasted personal data;
    // preserve content but never let embedded line breaks forge extra lines.
    const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029]/gu, ' ')
    const priceLine = (shop: OwnStore, line: typeof selected[number]['plus']) =>
      shop + ': ' + oneLine(line.productName) + ' · SKU ' + oneLine(line.productId) +
      ' · ' + line.packs + ' hele verpakkingen · ' +
      line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count +
      ' per pak · ' + exactEuro.formatCents(line.pricePerPackCents) + '/pak · ' +
      (line.packs + ' × ' + exactEuro.formatCents(line.pricePerPackCents)) +
      ' = ' + exactEuro.formatCents(line.lineTotalCents)
    const content = [
      'SUPA · eigen gecontroleerde productprijsselectie',
      'Dit is een FILTERSELECTIE, niet het hele mandje of een onafhankelijke besparingsclaim.',
      'De bedragen komen uitsluitend uit de twee persoonlijk bevestigde, nog actuele bronopnames.',
      'PLUS bronmoment: ' + current.stores.PLUS.observedAt,
      'DekaMarkt bronmoment: ' + current.stores.DekaMarkt.observedAt,
      'Geselecteerde ingrediënten: ' + selected.length + ' van ' + paired.lines.length,
      '',
      ...selected.flatMap(line => [
        oneLine(line.ingredientLabel) + ' · benodigde hoeveelheid: ' +
          String(line.plus.requirement.amount) + ' ' + line.plus.requirement.unit,
        priceLine('PLUS', line.plus),
        'PLUS indicatieve eenheidsprijs: ' + (privateUnitPrice(line.plus) ?? 'onbekend'),
        priceLine('DekaMarkt', line.deka),
        'DekaMarkt indicatieve eenheidsprijs: ' + (privateUnitPrice(line.deka) ?? 'onbekend'),
        'Indicatief eenheidsprijsverschil: ' + privateMatchedUnitPriceGap(line.plus, line.deka),
        line.deltaCents === 0 ? 'Regelprijs: gelijk' :
          'Regelprijsverschil: ' + exactEuro.formatCents(Math.abs(line.deltaCents)) +
          ' lager bij ' + (line.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'),
        '',
      ]),
      'Voor een betrouwbaar HEEL-MANDTOTAAL gebruik je de volledige vergelijking, niet deze selectie.',
      '',
    ].join('\n')
    const originalPlus = current.stores.PLUS
    const originalDeka = current.stores.DekaMarkt
    const sameSources = () => {
      const currentlyRendered = currentReviewedRef.current
      const latest = freshReviewedBaskets(
        currentlyRendered, currentlyRendered?.planKey ?? '', Date.now())
      return !!latest && latest.planKey === current.planKey &&
        latest.stores.PLUS === originalPlus && latest.stores.DekaMarkt === originalDeka &&
        ownStoreWeekComparison(latest).status === 'comparable'
    }
    if (action === 'print') {
      try {
        const { selectedOwnPricePrintHtml } = await import('./selectedOwnPricePrintHtml.ts')
        if (!sameSources()) throw Error('De originele winkelbronnen zijn veranderd of verlopen.')
        const html = selectedOwnPricePrintHtml({
          lines: selected, totalOriginalLines: paired.lines.length,
          plusObservedAt: originalPlus.observedAt,
          dekaObservedAt: originalDeka.observedAt,
        })
        if (!sameSources()) throw Error('De originele winkelbronnen zijn veranderd of verlopen.')
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        try {
          const link = document.createElement('a')
          link.href = url
          link.download = 'supa-eigen-geselecteerde-productprijzen-afdruk.html'
          document.body.append(link)
          try { link.click() } finally { link.remove() }
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
        setFilteredCopy(null)
        setDownloadMessage(selected.length + ' gecontroleerde productprijskaarten privé opgeslagen als afdrukbaar HTML-bestand. Geen mandtotaal.')
      } catch (error) {
        setFilteredCopy(null)
        setDownloadMessage(error instanceof Error ? error.message :
          'De gefilterde privéprijskaarten konden niet veilig worden opgeslagen.')
      }
      return
    }
    if (action === 'csv') {
      try {
        // CSV code can load separately; an expired/replaced source may NOT
        // survive that await as an authorized spreadsheet price.
        const { selectedOwnPriceCsv } = await import('./selectedOwnPriceCsv.ts')
        if (!sameSources()) throw Error('De originele winkelbronnen zijn veranderd of verlopen.')
        const csv = selectedOwnPriceCsv({
          lines: selected, totalOriginalLines: paired.lines.length,
          plusObservedAt: originalPlus.observedAt,
          dekaObservedAt: originalDeka.observedAt,
        })
        if (!sameSources()) throw Error('De originele winkelbronnen zijn veranderd of verlopen.')
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        try {
          const link = document.createElement('a')
          link.href = url
          link.download = 'supa-eigen-geselecteerde-productprijzen.csv'
          document.body.append(link)
          try { link.click() } finally { link.remove() }
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
        setFilteredCopy(null)
        setDownloadMessage(selected.length + ' oorspronkelijke productprijsregels als privé-CSV bewaard. Geen volledig mandtotaal.')
      } catch (error) {
        setFilteredCopy(null)
        setDownloadMessage(error instanceof Error ? error.message :
          'Het privéprijsblad kon niet veilig worden opgeslagen.')
      }
      return
    }
    if (action === 'copy') {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(content)
        if (!sameSources()) {
          setDownloadMessage('De winkelopnames zijn intussen verlopen of veranderd. Kopieer opnieuw na herziening.')
          setFilteredCopy(null)
          return
        }
        setFilteredCopy(null)
        setDownloadMessage(selected.length + ' gefilterde eigen prijsregels gekopieerd. Dit is geen volledig mandtotaal.')
      } catch {
        if (!sameSources()) {
          setFilteredCopy(null)
          setDownloadMessage('De bron is veranderd tijdens het kopiëren. Herzie de gegevens.')
          return
        }
        setFilteredCopy({ planKey: current.planKey, plus: originalPlus, deka: originalDeka, text: content })
        setDownloadMessage('Klembordtoegang ontbreekt. Selecteer de gefilterde privétekst hieronder om handmatig te kopiëren.')
      }
      return
    }
    if (!sameSources()) {
      setDownloadMessage('De bron is gewijzigd of verlopen voordat de selectie kon worden bewaard.')
      return
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-eigen-geselecteerde-productprijzen.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
      setDownloadMessage(selected.length + ' originele productprijsregels lokaal bewaard, zonder gefilterd mandtotaal.')
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    {hasDemand && <div className="own-store-planner__overview" aria-label="Mijn fysieke PLUS/Deka-weekmand in één oogopslag">
      <h3>Hetzelfde weekmandje · PLUS en DekaMarkt</h3>
      {summary.status === 'comparable'
        ? <>
          <div className="own-store-planner__overview-totals">
            <div><span>PLUS · eigen gecontroleerde bron</span>
              <strong>{exactEuro.formatCents(summary.plusCents)}</strong></div>
            <div><span>DekaMarkt · eigen gecontroleerde bron</span>
              <strong>{exactEuro.formatCents(summary.dekaCents)}</strong></div>
          </div>
          <p role="status"><strong>{summary.cheapest === null
            ? 'Beide winkels zijn even duur voor dit hele eigen mandje.'
            : summary.cheapest + ' heeft een ' + exactEuro.formatCents(summary.differenceCents) +
              ' lager heel-mandtotaal.'}</strong></p>
          <small>Alleen jouw oorspronkelijke, volledig gecontroleerde prijzen en dezelfde fysieke
            weekvraag met hele verpakkingen. Bronmomenten liggen maximaal 24 uur uiteen.
            Geen kassagarantie of onafhankelijk bewezen besparing.
            Eigen extra boodschappen zonder gecontroleerde SKU/prijs zijn niet in deze mandtotalen opgenomen.</small>
          {summary.mixedRoute && summary.mixedRoute.requiresTwoStops &&
            <p><strong>Optioneel combineren:</strong>
              {' '}{exactEuro.formatCents(summary.mixedRoute.totalCents)}
              {' '}aan origineel gecontroleerde boodschappenproducten in twee winkels.
              {' '}Dit is {exactEuro.formatCents(summary.mixedRoute.possibleProductDifferenceCents)}
              {' '}lager dan één complete winkel <strong>vóór</strong> extra reiskosten.
              Het netto voordeel is zonder eigen winkelstopkosten onbekend.</p>}
          {summary.mixedRoute?.requiresTwoStops && <div className="own-store-planner__route-choice" aria-label="Mijn voordeligste winkelroute">
            <label>Extra kosten voor een tweede winkelstop (€)
              <input type="text" inputMode="decimal" maxLength={9}
                placeholder="Bijvoorbeeld 2,50" value={shownCost}
                onChange={event => setSecondStopCost({ key: costSourceKey, raw: event.currentTarget.value })} />
            </label>
            {!shownCost.trim() ? <p role="status">Vul jouw extra bezoekkosten in om te beoordelen of twee winkels voordeliger zijn.</p>
              : parsedSecondStopCents === null || mixedNetDifferenceCents === null
                ? <p role="alert">Vul € 0,00 tot € 1.000,00 in, met maximaal twee decimalen.</p>
                : mixedNetDifferenceCents > 0n
                  ? <div role="status"><strong>Twee winkels kunnen goedkoper zijn.</strong>
                      <p>Na jouw extra stopkosten resteert {exactEuro.formatCents(mixedNetDifferenceCents)} productvoordeel.
                        Controleer jouw gekozen route en overige kosten in de Lijst.</p>
                      <button type="button" className="ghost-button" onClick={openCurrentMixedRoute}>Bekijk gecombineerde route</button>
                    </div>
                  : <div role="status"><strong>Eén winkel is minstens zo voordelig.</strong>
                      <p>De combinatie is {mixedNetDifferenceCents === 0n ? 'even duur' :
                        exactEuro.formatCents(-mixedNetDifferenceCents) + ' duurder'} inclusief jouw extra stopkosten.</p>
                      <button type="button" className="ghost-button"
                        onClick={() => openConfirmedStoreList(summary.cheapest ?? selected)}>
                        Open complete lijst bij {summary.cheapest ?? selected}
                      </button>
                    </div>}
            <small>Alleen jouw gecontroleerde productprijzen en opgegeven kosten. Geen kassagarantie of reistijdwaardering.</small>
          </div>}
          <div className="own-store-planner__overview-actions">
            <button type="button" className="ghost-button"
              onClick={() => openConfirmedStoreList(summary.cheapest ?? selected)}>
              Open {summary.cheapest ?? selected}-boodschappenlijst
            </button>
            <button type="button" className="ghost-button" onClick={() => {
              const details = document.querySelector<HTMLDetailsElement>('details.own-store-planner__details')
              if (!details) { onOpenComparison(); return }
              details.open = true
              window.requestAnimationFrame(() =>
                details.scrollIntoView({ block: 'start', behavior: 'smooth' }))
            }}>
              Bekijk originele productprijzen en regelverschillen
            </button>
            {summary.mixedRoute?.requiresTwoStops && <button type="button"
              className="ghost-button" onClick={openCurrentMixedRoute}>
              Bekijk twee-winkelroute in Lijst
            </button>}
          </div>
        </>
        : <>
          <p role="status"><strong>Prijsverschil nog onbekend.</strong>
            {' '}{summary.status === 'missing'
              ? 'Er zijn nog geen twee volledig gecontroleerde winkelmandjes voor dezelfde week.'
              : summary.status === 'different-moments'
                ? 'De originele winkelmomenten liggen meer dan 24 uur uiteen.'
                : 'De fysieke mandjes zijn nog niet aantoonbaar gelijkwaardig.'}</p>
          {captureProgress && <Suspense fallback={<p role="status">Oorspronkelijke losse winkelprijzen laden…</p>}>
            <PlannerKnownLinePrices progress={captureProgress} reviewed={reviewed}
              now={now} onReviewIngredient={onReviewIngredient} />
          </Suspense>}
          {summary.available.length > 0 && <div className="own-store-planner__overview-totals"
            aria-label="Losse complete eigen winkelmandjes, geen prijsvergelijking">
            {stores.map(store => {
              const capture = currentSources?.stores[store]
              return <div key={store}>
                <span>{store} · {capture ? 'alleen dit eigen gecontroleerde mandje' : 'nog geen complete bron'}</span>
                <strong>{capture ? exactEuro.formatCents(capture.basket.totalCents) : 'Prijs onbekend'}</strong>
              </div>
            })}
            <small>Deze afzonderlijke bedragen mogen NIET van elkaar worden afgetrokken
              zolang de huidige fysieke bronmandjes niet geldig vergelijkbaar zijn.</small>
          </div>}
          <small>Ontbrekende of verlopen winkelprijzen worden nooit geschat of als € 0 ingevuld.
            Je kunt de rest van je planning en ongeprijsde boodschappenlijst wel blijven gebruiken.
            Extra eigen boodschappen zonder geldige productprijs tellen niet mee in een getoond eenwinkelbedrag.</small>
          <div className="own-store-planner__overview-actions">
            <button type="button" className="ghost-button" onClick={onOpenComparison}>
              {summary.status === 'different-moments'
                ? 'Vernieuw originele winkelopname' : 'Ga naar bronimport en matching'}
            </button>
            {summary.available.length > 0 && <button type="button" className="ghost-button"
              onClick={() => openConfirmedStoreList(summary.available[0])}>
              Open compleet {summary.available[0]}-boodschappenmandje
            </button>}
            <button type="button" className="ghost-button" onClick={onOpenList}>
              Open mijn boodschappenlijst
            </button>
          </div>
        </>}
    </div>}
    <header className="own-store-planner__header">
      <div><span className="eyebrow">Eigen gecontroleerde winkelopnames</span>
        <h3 id="own-store-planner-heading">Jouw weekmand per winkel</h3></div>
      <button type="button" className="ghost-button" onClick={onOpenComparison}>Open prijsinvoer en productmatching</button>
      <div className={'supa-planner-source-drop' + (directDropActive ? ' is-dragging' : '')}
        onDragOver={event => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDirectDropActive(true)
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDirectDropActive(false)
        }}
        onDrop={event => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          setDirectDropActive(false)
          takeOwnSourceFiles(Array.from(event.dataTransfer.files))
        }}>
      <label className="supa-planner-direct-source">
        Direct eigen winkelopname(s) openen in Vergelijk
        <input type="file" multiple
          accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json"
          onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            takeOwnSourceFiles(files)
          }} />
        <small>Selecteer één of twee eigen PLUS-/Deka-bestanden. Broncontrole,
          productmatching en expliciete bevestiging blijven verplicht.
          Je kunt deze bestanden ook hierheen slepen (maximaal 256 kB per bestand).</small>
      </label>
      {directImportMessage && <p role="alert" className="supa-planner-source-error">
        {directImportMessage}
      </p>}
      </div>
    </header>
    {hasDemand && <Suspense fallback={<p role="status">Lokale plakimport laden…</p>}>
      <PlannerQuickSourcePaste onImport={onImportSourceFiles} hasDemand={hasDemand}
        needs={captureNeeds} onReviewIngredient={onReviewIngredient}
        onRecapture={store => {
          setCaptureTarget(store)
          window.requestAnimationFrame(() =>
            document.querySelector('.own-store-planner__capture')?.scrollIntoView({
              behavior: 'smooth', block: 'center',
            }))
        }} />
    </Suspense>}
    <Suspense fallback={<p role="status">Lokale rapportlezer laden…</p>}>
      <PrivateOwnReceiptViewer />
    </Suspense>
    <Suspense fallback={<p role="status">Historische privévergelijking laden…</p>}>
      <PrivateOwnReceiptHistory reviewed={reviewed} />
    </Suspense>
    <p className="own-store-planner__history-link">
      <a href="./private-receipt-history.html" rel="nofollow">
        Optioneel openen in afzonderlijke offline browserpagina →
      </a>
      <small>Ook deze pagina gebruikt uitsluitend eigen historische rapporten.
        Geen winkelgegevens worden bijgeladen of als nieuw bewijs opgeslagen.</small>
    </p>
    {captureNeeds.length > 0 && <div className="own-store-planner__capture" aria-label="Mijn lokale winkelprijsopname">
      <strong>Zelf winkelprijzen vastleggen voor dit weekmenu</strong>
      <p>Download een leeg invulblad of opnamegids voor {captureNeeds.length} fysieke ingrediënten. Productcodes, bronmomenten en prijzen moet je werkelijk vastleggen. CSV met puntkomma of komma en gekopieerde tabgescheiden spreadsheetcellen worden lokaal herkend; decimalen mogen een komma bevatten. Prijzen blijven hele eurocenten.</p>
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
        <button type="button" className="ghost-button" onClick={() => void downloadFieldSheet('csv-excel')}>Download spreadsheet-CSV (puntkomma)</button>
        <button type="button" className="ghost-button" onClick={() => void downloadFieldSheet('tsv')}>Download tabgescheiden werkblad (TSV)</button>
        <button type="button" className="ghost-button" onClick={() => void downloadFieldSheet('guide')}>Download opnamegids (TXT)</button>
      </div>
      <Suspense fallback={<p role="status">Gerichte opnamebladen laden…</p>}>
        <PlannerMissingCapturePanel captureNeeds={captureNeeds} captureProgress={captureProgress}
          reviewed={reviewed} now={now} onOpenComparison={onOpenComparison} />
      </Suspense>
    </div>}
    {captureNeeds.length > 0 && <Suspense fallback={<p role="status">Winkelcontroles laden…</p>}>
      <PlannerTwoStoreCoverage needs={captureNeeds} progress={captureProgress}
        reviewed={reviewed} now={now} comparisonStatus={summary.status}
        onOpenComparison={onOpenComparison}
        onReviewIngredient={onReviewIngredient} />
    </Suspense>}
    {captureProgress && <Suspense fallback={<p role="status">Eigen producten laden…</p>}>
      <PlannerReviewedSourceLines progress={captureProgress} now={now}
        hasCompleteComparison={summary.status === 'comparable'}
        onReviewIngredient={onReviewIngredient} onOpenComparison={onOpenComparison} />
    </Suspense>}
    {captureProgress && <div className="own-store-planner__review-download">
      <p>Neem een privéoverzicht mee van alle nog ontbrekende winkelbronnen, productkoppelingen
        en persoonlijke SKU-/prijscontroles. Verlopen bronnen komen afzonderlijk op de lijst;
        onbekende prijzen blijven onbekend.</p>
      <button type="button" className="ghost-button" onClick={() => void downloadReviewQueue()}>
        Download openstaande winkelcontroles (CSV)
      </button>
      <button type="button" className="ghost-button" onClick={() => void copyReviewQueue()}>
        Kopieer openstaande winkelcontroles (mobiel)
      </button>
    </div>}
    <div className="own-store-planner__cards">
      {stores.map(store => {
        const capture = currentSources?.stores[store]
        const cents = capture?.basket.totalCents
        return <div className="own-store-planner__card" key={store}>
          <strong>{store}</strong>
          <span className="own-store-planner__price">{capture && typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0
            ? exactEuro.formatCents(cents) : 'Prijs onbekend'}</span>
          <small>{capture ? `Eigen opname: ${capture.observedAt}` : 'Nog geen complete, gecontroleerde opname'}</small>
          {captureProgress?.stores[store] && !capture && (() => {
            const progress = captureProgress.stores[store]!
            const sourceFresh = progress.fresh && recentOwnCaptureInstant(progress.observedAt, now)
            const partial = confirmedPartialBasket(captureProgress, store, now)
            return <div className="own-store-planner__capture-status" role="status">
              <small>Eigen bron: {progress.observedAt} · {progress.originalProductCount} originele SKU’s.</small>
              <small>{progress.pricedProductCount}/{progress.originalProductCount} bronproducten met
                daadwerkelijk vastgelegde beschikbare pakprijs.
                {' '}{progress.originalProductCount - progress.pricedProductCount} bronproducten zonder bruikbare pakprijs.</small>
              <small>{progress.matchedLineCount}/{progress.demandLineCount} ingrediënten hebben een voorgestelde match;
                {' '}{progress.reviewedLineCount}/{progress.demandLineCount} fysiek gecontroleerd.</small>
              {partial && <div className="own-store-planner__partial-amount"
                aria-label={store + ': alleen persoonlijk gecontroleerde prijzen'}>
                <strong>Al gecontroleerde artikelregels: {exactEuro.formatCents(partial.knownCents)}</strong>
                <small>{partial.confirmedCount} van {partial.physicalLineCount} ingrediënten bevestigd.
                  {' '}{partial.remainingCount} nog niet volledig in deze deelberekening.
                  Dit is <strong>geen volledig mandtotaal</strong>, geen winkelwinnaar en
                  geen betrouwbare budget- of besparingsvergelijking.</small>
                <button type="button" className="ghost-button"
                  onClick={() => progress.nextIngredientId
                    ? onReviewIngredient(store, progress.nextIngredientId)
                    : onOpenComparison()}>
                  Volgende productprijs controleren
                </button>
              </div>}
              {progress.demandLineCount > 0 && <div className="own-store-planner__progress-meters"
                aria-label={'Voortgang eigen ' + store + '-winkelopname'}>
                <label>Ingrediënten met voorgesteld product
                  <progress value={Math.min(progress.demandLineCount, Math.max(0, progress.matchedLineCount))}
                    max={progress.demandLineCount} />
                  <span>{progress.matchedLineCount} van {progress.demandLineCount}</span>
                </label>
                <label>Automatisch gekoppeld of door jou bevestigd
                  <progress value={Math.min(progress.demandLineCount, Math.max(0, progress.reviewedLineCount))}
                    max={progress.demandLineCount} />
                  <span>{progress.reviewedLineCount} van {progress.demandLineCount}</span>
                </label>
              </div>}
              {progress.originalProductCount > 0 && <div className="own-store-planner__progress-meters">
                <label>Originele bronartikelen met bruikbare pakprijs
                  <progress value={Math.min(progress.originalProductCount, Math.max(0, progress.pricedProductCount))}
                    max={progress.originalProductCount} />
                  <span>{progress.pricedProductCount} van {progress.originalProductCount}</span>
                </label>
              </div>}
              {progress.autoMatchedLineCount > 0 && <small>
                {progress.autoMatchedLineCount} eenduidige productmatch(es) automatisch gekoppeld.
                {' '}Alleen onzekere artikelen moet je nog beoordelen.
              </small>}
              <small>{sourceFresh
                ? 'Nog niet volledig gekoppeld: prijs en budget blijven onbekend.'
                : 'Bronopname te oud of toekomstig: vernieuw de echte bron voordat prijzen meetellen.'}</small>
              {sourceFresh && progress.missingIngredients.length > 0 &&
                <div className="own-store-planner__review-queue" aria-label={'Ontbrekende bronproducten bij ' + store}>
                  <strong>Zoek echte bronproducten</strong>
                  {progress.missingIngredients.slice(0, 5).map(item =>
                    <button type="button" key={item.id} className="ghost-button"
                      onClick={() => onReviewIngredient(store, item.id)}
                      aria-label={'Zoek bij ' + store + ' een product voor ' + item.label}>
                      Zoek {item.label} in Vergelijk
                    </button>)}
                  {progress.missingIngredients.length > 5 &&
                    <small>En {progress.missingIngredients.length - 5} andere zonder match.</small>}
                </div>}
              {sourceFresh && progress.awaitingReviewIngredients.length > 0 &&
                <div className="own-store-planner__review-queue" aria-label={'Te controleren winkelproducten bij ' + store}>
                  <strong>Controleer originele SKU, verpakking en pakprijs</strong>
                  {progress.awaitingReviewIngredients.slice(0, 5).map(item =>
                    <button type="button" key={item.id} className="ghost-button"
                      onClick={() => onReviewIngredient(store, item.id)}
                      aria-label={'Controleer bij ' + store + ' de originele SKU voor ' + item.label}>
                      Controleer {item.label} in Vergelijk
                    </button>)}
                  {progress.awaitingReviewIngredients.length > 5 &&
                    <small>En {progress.awaitingReviewIngredients.length - 5} andere productkeuzes zonder controle.</small>}
                </div>}
              <button type="button" className="ghost-button"
                onClick={() => progress.fresh && progress.nextIngredientId
                  ? onReviewIngredient(store, progress.nextIngredientId) : onOpenComparison()}>
                {!progress.fresh ? 'Vernieuw winkelbron in Vergelijk'
                  : progress.nextIngredientId ? 'Open volgende controle in Vergelijk'
                  : 'Open winkelbron in Vergelijk'}
              </button>
            </div>
          })()}
          {capture && privatePriceAgeNotice(capture.capturedMs, Date.now()) && (
            <small className="own-store-planner__age" role="status">
              {privatePriceAgeNotice(capture.capturedMs, Date.now())}
            </small>
          )}
          {capture && typeof cents === 'number' && Number.isSafeInteger(cents) && cents >= 0 && budgetCents !== null &&
            <small className="own-store-planner__budget-gap">{cents > budgetCents
              ? `${exactEuro.formatCents(cents - budgetCents)} boven je ingestelde weekbudget`
              : `${exactEuro.formatCents(budgetCents - cents)} binnen je ingestelde weekbudget`}</small>}
          {capture && <button type="button" onClick={() => selectCurrentStore(store)}
            className="ghost-button" aria-pressed={selected === store}>
            {selected === store ? 'Gekozen voor mijn budget' : 'Gebruik voor mijn budget'}
          </button>}
          {capture && <button type="button" className="ghost-button"
            onClick={() => openConfirmedStoreList(store)}>
            Open mijn {store}-boodschappenlijst
          </button>}
          {capture && <div className="own-store-planner__single-exports"
            aria-label={store + ' eigen winkelmand exporteren'}>
            <button type="button" className="ghost-button"
              onClick={() => void downloadSingleStoreBasket(store, 'csv')}>
              Download {store}-mandje (CSV)
            </button>
            <button type="button" className="ghost-button"
              onClick={() => void downloadSingleStoreBasket(store, 'html')}>
              Print {store}-boodschappen (HTML)
            </button>
            <button type="button" className="ghost-button"
              onClick={() => void copySingleStoreBasket(store)}>
              Kopieer {store}-boodschappen (mobiel)
            </button>
            <small>Werkt zonder tweede winkel; uitsluitend je originele, gecontroleerde en
              actuele pakprijzen. Geen winkelverschil of besparingsclaim.</small>
            {copyableStore?.store === store && copyableStore.receipt === capture &&
              <label className="own-store-planner__copy-fallback">
                Selecteer en kopieer deze privéboodschappenlijst
                <textarea readOnly value={copyableStore.text} rows={9}
                  onFocus={event => event.currentTarget.select()} />
              </label>}
          </div>}
        </div>
      })}
    </div>
    {expiredSources && <p className="own-store-planner__age" role="status">
      Een of meer persoonlijke winkelopnames zijn verlopen of niet meer bruikbaar.
      Oude bedragen zijn verborgen; controleer de originele bronproducten opnieuw in Vergelijk.
    </p>}
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
            : `${summary.cheapest} is ${exactEuro.formatCents(summary.differenceCents)} voordeliger voor jouw mandje.`}</strong>
          <p>Dezelfde gecontroleerde fysieke vraag en benodigde hele verpakkingen, eigen bronmomenten maximaal 24 uur uit elkaar. Geen kassagarantie of onafhankelijk bewezen besparing.</p>
          {summary.cheapest && selected !== summary.cheapest && <button type="button" className="ghost-button"
            onClick={() => selectCurrentStore(summary.cheapest!)}>Kies {summary.cheapest} voor mijn weekbudget</button>}
          <button type="button" className="ghost-button" onClick={() => openConfirmedStoreList(selected)}>Open eigen boodschappenlijst</button>
          <button type="button" className="ghost-button" onClick={downloadPrivateComparison}>
            Download privévergelijking (TXT)
          </button>
          <button type="button" className="ghost-button" onClick={() => void copyPrivateComparison()}>
            Kopieer mijn prijsvergelijking (tekst)
          </button>
          <button type="button" className="ghost-button" onClick={() => void sharePrivateComparison()}>
            Deel mijn privéprijsvergelijking (met eigen SKU’s en prijzen)
          </button>
          <button type="button" className="ghost-button" onClick={downloadPrivateCsv}>
            Download privévergelijking met originele SKU's (CSV)
          </button>
          <button type="button" className="ghost-button" onClick={() => void downloadPrivateJson()}>
            Download volledig eigen prijsrapport (JSON)
          </button>
          <button type="button" className="ghost-button" onClick={downloadPrivateHtml}>
            Download afdrukbaar volledig prijsvergelijkingsblad (HTML)
          </button>
          {summary.mixedRoute && <div className="own-store-planner__mix-preview">
            <h4>Combineren van goedkoopste artikelen</h4>
            <p><strong>{exactEuro.formatCents(summary.mixedRoute.totalCents)} aan winkelproducten</strong>
              {' '}als je per ingrediënt het goedkoopste gecontroleerde hele-verpakkingenbedrag neemt.
              {summary.mixedRoute.requiresTwoStops
                ? <> Dit is {exactEuro.formatCents(summary.mixedRoute.possibleProductDifferenceCents)}
                    {' '}lager dan de goedkoopste volledige winkel, <strong>vóór extra bezoekkosten</strong>.
                    Het werkelijke voordeel is onbekend zolang reistijd of extra kosten niet zijn ingevuld.</>
                : <> Deze selectie past bij één winkel; een tweede winkelstop is niet nodig.</>}</p>
            {summary.mixedRoute.requiresTwoStops && <div className="own-store-planner__second-stop">
              <p>Vul bovenaan jouw eigen omrij-/parkeerkosten in. Zonder die kosten is het
                netto voordeel onbekend. Dit is geen kassaprijs- of besparingsbewijs.</p>
              <p className="own-store-planner__break-even">
                <strong>Wanneer loont die tweede winkelstop?</strong>{' '}
                {summary.mixedRoute.possibleProductDifferenceCents > 0
                  ? <>De twee winkels zijn voor jouw gecontroleerde producten alleen voordeliger
                      dan de goedkoopste complete winkel als jouw <em>extra</em> bezoekkosten
                      lager zijn dan{' '}
                      <strong>{exactEuro.formatCents(summary.mixedRoute.possibleProductDifferenceCents)}</strong>.
                      {' '}Bij precies dat bedrag speel je quitte; hogere kosten maken één winkel
                      voordeliger. Reistijd is niet in euro's omgerekend.</>
                  : <>Deze combinatie bespaart vóór extra bezoekkosten niets ten opzichte
                      van één complete winkel. Met positieve extra kosten is één winkel
                      voor dit mandje voordeliger.</>}
              </p>
              {shownCost.trim() && parsedSecondStopCents === null && <p role="alert">
                Vul € 0,00 tot € 1.000,00 in, met maximaal twee decimalen.</p>}
              {parsedSecondStopCents !== null && mixedTripCents !== null &&
                mixedNetDifferenceCents !== null && <>
                <p role="status">Twee winkelstops inclusief extra kosten:
                  {' '}<strong>{exactEuro.formatCents(mixedTripCents)}</strong>.
                  {' '}{mixedNetDifferenceCents > 0n
                    ? exactEuro.formatCents(mixedNetDifferenceCents) + ' minder dan één hele winkel.'
                    : mixedNetDifferenceCents === 0n
                      ? 'Gelijk aan één hele winkel.'
                      : exactEuro.formatCents(-mixedNetDifferenceCents) + ' duurder dan één hele winkel.'}</p>
                {mixedBudgetDifferenceCents !== null && <p>Weekbudget:
                  {' '}{mixedBudgetDifferenceCents > 0n
                    ? exactEuro.formatCents(mixedBudgetDifferenceCents) + ' overschreden.'
                    : exactEuro.formatCents(-mixedBudgetDifferenceCents) + ' over.'}</p>}
              </>}
            </div>}
            <button type="button" className="ghost-button" onClick={openCurrentMixedRoute}>
              Open mijn gecombineerde winkelroute in Lijst
            </button>
          </div>}
          <Suspense fallback={<p role="status">Winkelprijsregels laden…</p>}><PlannerOwnProductDeltas lines={summary.lines} onChooseLine={chooseConfirmedLine} onExportSelection={downloadSelectedProductPrices} /></Suspense>
          {filteredCopy && filteredCopy.planKey === currentSources?.planKey &&
            filteredCopy.plus === currentSources?.stores.PLUS &&
            filteredCopy.deka === currentSources?.stores.DekaMarkt &&
            <label className="own-store-planner__copy-fallback">
              Alleen eerder geselecteerde eigen productprijsregels. Selecteer tekst om handmatig te kopiëren.
              <textarea readOnly rows={10} value={filteredCopy.text}
                onFocus={() => {
                  const latest = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
                  if (latest?.stores.PLUS !== filteredCopy.plus ||
                      latest?.stores.DekaMarkt !== filteredCopy.deka)
                    setFilteredCopy(null)
                }} />
            </label>}
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
    {copyableComparison && summary.status === 'comparable' &&
      copyableComparison.plus === currentSources?.stores.PLUS &&
      copyableComparison.deka === currentSources?.stores.DekaMarkt &&
      copyableComparison.costRaw === shownCost &&
      <label className="own-store-planner__copy-fallback">
        Privé PLUS/Deka-prijsvergelijking met jouw eigen kosten: selecteer en kopieer
        <textarea readOnly rows={12} value={copyableComparison.text}
          onFocus={event => {
            const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
            if (current?.stores.PLUS !== copyableComparison.plus ||
                current?.stores.DekaMarkt !== copyableComparison.deka ||
                ownStoreWeekComparison(current).status !== 'comparable') {
              setCopyableComparison(null)
              setDownloadMessage('Bronopnames zijn verlopen: herzie originele winkelprijzen voor je deelt.')
              return
            }
            event.currentTarget.select()
          }}
          onCopy={event => {
            const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
            if (current?.stores.PLUS !== copyableComparison.plus ||
                current?.stores.DekaMarkt !== copyableComparison.deka ||
                ownStoreWeekComparison(current).status !== 'comparable') {
              event.preventDefault()
              setCopyableComparison(null)
              setDownloadMessage('Je bronopnames zijn verouderd: kopiëren geannuleerd.')
            }
          }} />
      </label>}
    {downloadMessage && <p role="status" aria-live="polite">{downloadMessage}</p>}
  </section>
}
