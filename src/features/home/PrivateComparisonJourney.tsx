import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { privateKnownPricePairs, privateProgressProductRows, formatKnownUnitGap, privateMatchedUnitPriceGap, type PrivateKnownProduct, type PrivateKnownUnitGap } from '../products/privateProgressProductRows.ts'
import { euro } from '../../lib/money.ts'
import { privateKnownLinePriceCsv, downloadPrivateKnownLinePriceCsv } from '../products/privateKnownLinePriceCsv.ts'
import { downloadPrivateKnownLinePricePrint } from '../products/privateKnownLinePricePrint.ts'
import {
  privateReviewedPairWithin24Hours, freshReviewedBaskets,
  recentOwnCaptureInstant, partialReviewedLinePairs,
  type OwnStore, type PrivateCaptureProgress, type PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { makePlannerCaptureGuide, readablePlannerDemandAmount } from '../comparison/plannerPriceCaptureGuide.ts'
import { makeBlankPlannerCaptureCsv } from '../comparison/plannerPriceCaptureSheet.ts'
import { pendingOwnSourceReviewCsv, pendingOwnSourceReviewText } from '../planner/pendingOwnSourceReviewCsv.ts'
import { ownStoreWeekComparison } from '../planner/ownStoreBudgetComparison.ts'
import { printableOwnStoreComparison } from '../planner/downloadOwnStoreComparison.ts'
import './privateComparisonJourney.css'
import './privateComparisonComplete.css'

const PlannerQuickSourcePaste = lazy(async () => {
  const mod = await import('../planner/PlannerQuickSourcePaste.tsx')
  return { default: mod.PlannerQuickSourcePaste }
})

const PlannerTwoStoreCoverage = lazy(async () => {
  const mod = await import('../planner/PlannerTwoStoreCoverage.tsx')
  return { default: mod.PlannerTwoStoreCoverage }
})

const PlannerMissingCapturePanel = lazy(async () => {
  const mod = await import('../planner/PlannerMissingCapturePanel.tsx')
  return { default: mod.PlannerMissingCapturePanel }
})

const stores: OwnStore[] = ['PLUS', 'DekaMarkt']

/**
 * A prominent route from Home to the existing source importer and exact SKU
 * review. Only live, complete owner-reviewed baskets may produce a number.
 * Partial price sources are guidance, not a financial estimate.
 */
export function PrivateComparisonJourney({
  reviewed, progress, captureNeeds, onOpenPlanner, onOpenImport, onOpenProducts, onOpenList, onReview, onImportFiles, fileWarning,
}: {
  reviewed: PrivateReviewedBaskets | null
  progress: PrivateCaptureProgress | null
  captureNeeds: readonly PlannerCaptureGuideNeed[]
  onOpenPlanner: () => void
  onOpenImport: () => void
  onOpenProducts: () => void
  onOpenList: (store?: OwnStore) => void
  onReview: (store: OwnStore, ingredientId: string) => void
  onImportFiles: (files: File[]) => void
  fileWarning: string
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [exportMessage, setExportMessage] = useState('')
  const [shareFallback, setShareFallback] = useState<{ source: PrivateReviewedBaskets | null; week: string; text: string } | null>(null)
  const [partialCopyFallback, setPartialCopyFallback] = useState<{ source: PrivateCaptureProgress | null; reviewed: PrivateReviewedBaskets | null; week: string; text: string } | null>(null)
  const [showPasteSource, setShowPasteSource] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [partialQuery, setPartialQuery] = useState('')
  const [partialStoreFilter, setPartialStoreFilter] = useState<'all' | 'plus' | 'deka' | 'equal'>('all')
  const [partialSort, setPartialSort] = useState<'impact' | 'name' | 'plus-price' | 'deka-price'>('impact')
  // Search is presentation-only; source admission and basket totals are unchanged.
  const [completeQuery, setCompleteQuery] = useState('')
  const [showAllComplete, setShowAllComplete] = useState(false)
  const [completeStoreFilter, setCompleteStoreFilter] = useState<'all' | 'plus' | 'deka' | 'equal'>('all')
  const [completeSort, setCompleteSort] = useState<'impact' | 'name' | 'plus-price' | 'deka-price'>('impact')
  const [showAllPartial, setShowAllPartial] = useState(false)
  const [showTargetedCapture, setShowTargetedCapture] = useState(false)
  const [showTwoStoreCoverage, setShowTwoStoreCoverage] = useState(false)
  const [pendingCopyText, setPendingCopyText] = useState('')
  const [pendingMessage, setPendingMessage] = useState('')
  const captureKey = JSON.stringify(captureNeeds.map(need =>
    [need.id, need.label, need.amount, need.unit, need.query]))
  const liveCaptureKey = useRef(captureKey)
  liveCaptureKey.current = captureKey

  // New original source capture or another selected physical week must not
  // inherit a hidden old search/filter and make valid paired products disappear.
  useEffect(() => {
    setCompleteQuery('')
    setCompleteStoreFilter('all')
    setCompleteSort('impact')
    setShowAllComplete(false)
  }, [captureKey, reviewed])

  // A newly imported original source or a different Planner week must not
  // inherit a retailer filter that silently hides newly confirmed price rows.
  // These are visual preferences only: the stored basket and original source
  // facts are never mutated.
  useEffect(() => {
    setPartialQuery('')
    setPartialStoreFilter('all')
    setPartialSort('impact')
    setShowAllPartial(false)
  }, [captureKey, progress, reviewed])

  useEffect(() => {
    const refresh = () => setNowMs(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const valid = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', nowMs)
  const plus = valid?.stores.PLUS
  const deka = valid?.stores.DekaMarkt
  const paired = !!plus && !!deka && privateReviewedPairWithin24Hours(plus, deka)
  const comparison = paired
    ? compareFullBaskets({ baseline: plus.basket, candidate: deka.basket }) : null
  const ready = paired && comparison?.claimable === true
  // Both individual captures can still be valid for private review while
  // their original collection instants are too far apart for a comparison.
  // Use the canonical nanosecond parser, not rounded Date arithmetic.
  const progressForCurrentPlan = !reviewed || progress?.planKey === reviewed.planKey
    ? progress : null
  const originalSourceAt = (store: OwnStore): string | null => {
    const full = valid?.stores[store]
    if (full) return full.observedAt
    const own = progressForCurrentPlan?.stores[store]
    return own?.fresh && recentOwnCaptureInstant(own.observedAt, nowMs)
      ? own.observedAt : null
  }
  const plusOriginalAt = originalSourceAt('PLUS')
  const dekaOriginalAt = originalSourceAt('DekaMarkt')
  const plusInstant = plusOriginalAt ? observedInstant(plusOriginalAt) : null
  const dekaInstant = dekaOriginalAt ? observedInstant(dekaOriginalAt) : null
  const originalSourceGapNs = plusInstant && dekaInstant
    ? plusInstant.ns >= dekaInstant.ns
      ? plusInstant.ns - dekaInstant.ns
      : dekaInstant.ns - plusInstant.ns
    : null
  const captureMomentsDiffer = originalSourceGapNs !== null &&
    originalSourceGapNs > 86_400_000_000_000n
  // Reuse Planner's existing actionable status and source review rather than
  // building a second freshness/matching authority on Home.
  const comparisonStatus = ready ? 'comparable'
    : captureMomentsDiffer ? 'different-moments'
      : plus && deka ? (paired ? 'not-comparable' : 'different-moments')
        : 'missing'
  const cheaper = ready
    ? plus!.basket.totalCents === deka!.basket.totalCents ? null
      : plus!.basket.totalCents < deka!.basket.totalCents ? 'PLUS' : 'DekaMarkt'
    : null
  const delta = ready
    ? Math.abs(plus!.basket.totalCents - deka!.basket.totalCents) : null
  // The validated complete basket is the sole source of detailed prices.
  // Never infer an extra price from a demo listing or unfinished match.
  const fullLinePairs = ready && comparison && plus && deka
    ? comparison.lineDeltas.flatMap(row => {
        const one = plus.basket.lines.find(line =>
          line.status === 'matched' && line.id === row.id)
        const other = deka.basket.lines.find(line =>
          line.status === 'matched' && line.id === row.id)
        return one?.status === 'matched' && other?.status === 'matched'
          ? [{ ...row, plusLine: one, dekaLine: other }] : []
      }).sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents) ||
        a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl-NL'))
    : []
  const completeWords = completeQuery.normalize('NFKC').toLocaleLowerCase('nl-NL')
    .trim().split(/\s+/u).filter(Boolean).slice(0, 12)
  const filteredFullLinePairs = fullLinePairs.filter(row => {
    // The canonical comparator's Deka-minus-PLUS delta is the only basis for
    // these per-item presentation filters; no partial sum or fake offer data.
    if (completeStoreFilter === 'plus' && row.deltaCents <= 0) return false
    if (completeStoreFilter === 'deka' && row.deltaCents >= 0) return false
    if (completeStoreFilter === 'equal' && row.deltaCents !== 0) return false
    const formatPack = (line: typeof row.plusLine) =>
      [line.pack.amount, line.pack.unit, line.pack.count + ' per pak',
        line.packs + ' hele pakken'].join(' ')
    const haystack = [row.id, row.ingredientLabel,
      row.plusLine.productId, row.plusLine.productName, formatPack(row.plusLine),
      row.dekaLine.productId, row.dekaLine.productName, formatPack(row.dekaLine),
    ].join(' ').normalize('NFKC').toLocaleLowerCase('nl-NL')
    return completeWords.every(word => haystack.includes(word))
  }).sort((a, b) => {
    if (completeSort === 'name')
      return a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl-NL')
    if (completeSort === 'plus-price')
      return b.plusLine.lineTotalCents - a.plusLine.lineTotalCents
    if (completeSort === 'deka-price')
      return b.dekaLine.lineTotalCents - a.dekaLine.lineTotalCents
    return Math.abs(b.deltaCents) - Math.abs(a.deltaCents) ||
      a.ingredientLabel.localeCompare(b.ingredientLabel, 'nl-NL')
  })
  const visibleFullLinePairs = showAllComplete || completeWords.length
    ? filteredFullLinePairs : filteredFullLinePairs.slice(0, 3)
  const singleReady = !!plus || !!deka
  // The workbench emits partial source rows via captureProgress, never as a
  // falsely complete reviewed basket. Reuse the same admission logic used by
  // Planner and Producten for per-ingredient source prices.
  const admittedPartialRows = privateProgressProductRows(progress, nowMs)
  const originalNeeds = new Map(admittedPartialRows.map(({ line }) =>
    [line.ingredientId, line]))
  const partialPairs: Array<{
    id: string; name: string; amount: number; unit: string;
    plusPacks: number; dekaPacks: number; plusCents: number; dekaCents: number;
    plusProduct?: PrivateKnownProduct; dekaProduct?: PrivateKnownProduct;
    plusObservedAt?: string; dekaObservedAt?: string;
    unitGap?: PrivateKnownUnitGap | null;
    restoredUnitGapText?: string;
  }> = ready ? [] : privateKnownPricePairs(progress, reviewed, nowMs)
    .flatMap(pair => {
      const need = originalNeeds.get(pair.ingredientId)
      if (!need) return []
      return [{
        id: pair.ingredientId, name: need.ingredientLabel,
        amount: need.requiredAmount, unit: need.requiredUnit,
        plusPacks: pair.plusPacks, dekaPacks: pair.dekaPacks,
        plusCents: pair.plusCents, dekaCents: pair.dekaCents,
        plusProduct: pair.plusProduct, dekaProduct: pair.dekaProduct,
        plusObservedAt: pair.plusObservedAt, dekaObservedAt: pair.dekaObservedAt,
        unitGap: pair.unitGap,
      }]
    })
  // A complete reviewed basket may be available independently of the current
  // progress snapshot (e.g. during a tab restoration), but do not double show.
  if (!ready && partialPairs.length === 0) {
    partialPairs.push(...partialReviewedLinePairs(plus, deka).map(({ plus: one, deka: other }) => ({
      id: one.id, name: one.ingredientLabel, amount: one.requirement.amount,
      unit: one.requirement.unit, plusPacks: one.packs, dekaPacks: other.packs,
      plusCents: one.lineTotalCents, dekaCents: other.lineTotalCents,
      // Restoring a complete but not claimable comparison must not discard
      // original captured SKU/pack evidence merely because an older partial
      // progress snapshot is missing. Use only the already-admitted matched
      // line facts; never re-match, invent or promote a basket price.
      plusProduct: {
        productId: one.productId, productName: one.productName,
        packAmount: one.pack.amount, packUnit: one.pack.unit,
        packCount: one.pack.count, pricePerPackCents: one.pricePerPackCents,
        unitRate: privateUnitPrice(one),
      },
      dekaProduct: {
        productId: other.productId, productName: other.productName,
        packAmount: other.pack.amount, packUnit: other.pack.unit,
        packCount: other.pack.count, pricePerPackCents: other.pricePerPackCents,
        unitRate: privateUnitPrice(other),
      },
      plusObservedAt: plus?.observedAt, dekaObservedAt: deka?.observedAt,
      // Same canonical original package-unit comparison as full reviewed
      // lines, still advisory only and never a new shopping-basket total.
      restoredUnitGapText: privateMatchedUnitPriceGap(one, other),
    })))
  }
  // Only preexisting source pairs qualify. Search/filter never changes the
  // canonical basket or promotes a partial sum into a whole-week estimate.
  const foldPartial = (value: string) => value.normalize('NFKC')
    .toLocaleLowerCase('nl-NL')
  // Each word may match a different original fact (ingredient, retailer,
  // SKU, pack, observation time). Never search demo prices or fabricated
  // matches; a search result is still only an individually reviewed pair.
  const partialWords = foldPartial(partialQuery.trim()).split(/\s+/u)
    .filter(Boolean).slice(0, 12)
  const filteredPartialPairs = partialPairs.filter(row => {
    const productFacts = (store: OwnStore, product?: PrivateKnownProduct,
      capturedAt?: string) => !product ? '' : [
        store, product.productName, product.productId, product.packAmount,
        product.packUnit, product.packCount, product.unitRate ?? '',
        capturedAt ?? '',
      ].join(' ')
    const searchable = foldPartial([
      row.name, row.id, row.amount, row.unit,
      productFacts('PLUS', row.plusProduct, row.plusObservedAt),
      productFacts('DekaMarkt', row.dekaProduct, row.dekaObservedAt),
    ].join(' '))
    if (partialStoreFilter === 'plus' && row.plusCents >= row.dekaCents) return false
    if (partialStoreFilter === 'deka' && row.dekaCents >= row.plusCents) return false
    if (partialStoreFilter === 'equal' && row.plusCents !== row.dekaCents) return false
    return partialWords.every(word => searchable.includes(word))
  })
  const orderedPartialPairs = [...filteredPartialPairs].sort((a, b) => {
    if (partialSort === 'name') return a.name.localeCompare(b.name, 'nl-NL')
    if (partialSort === 'plus-price') return b.plusCents - a.plusCents
    if (partialSort === 'deka-price') return b.dekaCents - a.dekaCents
    return Math.abs(b.dekaCents - b.plusCents) - Math.abs(a.dekaCents - a.plusCents) ||
      a.name.localeCompare(b.name, 'nl-NL')
  })
  const shownPartialPairs = showAllPartial ? orderedPartialPairs
    : orderedPartialPairs.slice(0, 3)

  async function handOffPendingSourceWork(action: 'csv' | 'copy' | 'share') {
    setPendingMessage('')
    setPendingCopyText('')
    try {
      if (!progress || !progress.planKey)
        throw new Error('Importeer eerst je eigen winkelopnames in Vergelijk.')
      // The canonical Planner pending-task exporter is shared with Home:
      // missing/stale prices remain unknown, never become purchasable SKUs.
      // Build synchronously to keep the mobile share user gesture.
      const now = Date.now()
      const content = action === 'csv'
        ? pendingOwnSourceReviewCsv(progress, progress.planKey, now)
        : pendingOwnSourceReviewText(progress, progress.planKey, now)
      if (action === 'share' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: 'Supa · openstaande PLUS/Deka-broncontroles',
            text: content,
          })
          setPendingMessage('Je persoonlijke lijst met ontbrekende broncontroles is gedeeld.')
          return
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return
          // Unsupported share targets can still use ordinary clipboard copy.
        }
      }
      if (action !== 'csv') {
        try {
          if (!navigator.clipboard?.writeText)
            throw new Error('Klembord niet beschikbaar.')
          await navigator.clipboard.writeText(content)
          setPendingMessage('De originele ontbrekende PLUS/Deka-broncontroles zijn gekopieerd.')
        } catch {
          setPendingCopyText(content)
          setPendingMessage('Selecteer de persoonlijke controlelijst hieronder en kopieer handmatig.')
        }
        return
      }
      const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-openstaande-eigen-winkelcontroles.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setPendingMessage('Openstaande broncontroles lokaal als CSV opgeslagen; zonder onbekende prijzen.')
    } catch (error) {
      setPendingMessage(error instanceof Error ? error.message : 'Openstaande controles niet beschikbaar.')
    }
  }

  async function downloadBlankHomeCapture(format: 'csv' | 'html' | 'txt') {
    const selectedWeek = captureKey
    setCaptureMessage('')
    try {
      if (!captureNeeds.length || captureNeeds.length > 200)
        throw new Error('Kies eerst een weekmenu met 1–200 fysieke ingrediënten.')
      const text = format === 'csv'
        ? (await import('../comparison/plannerPriceCaptureSheet.ts'))
            .makeBlankPlannerCaptureCsv(captureNeeds, stores, ';')
        : format === 'html'
          ? (await import('../comparison/plannerPriceCapturePrint.ts'))
              .makePrintablePlannerCaptureHtml(captureNeeds, stores)
          : (await import('../comparison/plannerPriceCaptureGuide.ts'))
              .makePlannerCaptureGuide(captureNeeds, stores)
      if (selectedWeek !== liveCaptureKey.current)
        throw new Error('Je weekmenu is veranderd; maak het opnameblad opnieuw.')
      if (new TextEncoder().encode(text).length > 800000)
        throw new Error('Het opnameblad is te groot; kies minder ingrediënten.')
      const url = URL.createObjectURL(new Blob([text], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' :
          format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = format === 'csv' ?
          'supa-leeg-eigen-plus-deka-prijsblad.csv' : format === 'html' ?
            'supa-eigen-plus-deka-opnameformulier.html' :
            'supa-eigen-plus-deka-csv-rijnummers.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCaptureMessage(format === 'txt' ?
        'Gids met originele ingrediënten en CSV-rijnummers bewaard. Dit is geen importbestand.' :
        'Leeg lokaal opnameformulier bewaard; vul uitsluitend werkelijk geobserveerde bronnen en prijzen in.')
    } catch (error) {
      setCaptureMessage(error instanceof Error ? error.message : 'Kon het opnameblad niet downloaden.')
    }
  }
  function downloadSingleStoreCapture(store: OwnStore, format: 'csv' | 'txt') {
    const selectedWeek = captureKey
    setCaptureMessage('')
    try {
      if (!captureNeeds.length || captureNeeds.length > 200)
        throw new Error('Kies eerst een geldig weekmenu met maximaal 200 ingrediënten.')
      // The ordinary one-store CSV remains usable by the existing private
      // converter. An unvisited second shop is never silently fabricated.
      const text = format === 'csv'
        ? makeBlankPlannerCaptureCsv(captureNeeds, [store], ';')
        : makePlannerCaptureGuide(captureNeeds, [store])
      if (selectedWeek !== liveCaptureKey.current)
        throw new Error('Het weekmenu is gewijzigd. Maak een nieuw opnameblad.')
      if (new TextEncoder().encode(text).length > 256000)
        throw new Error('Het winkelblad is groter dan de veilige importlimiet.')
      const url = URL.createObjectURL(new Blob([text], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() +
          (format === 'csv' ? '-leeg-winkelopnameblad.csv' : '-ingredient-rijnummers.txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setCaptureMessage(format === 'csv'
        ? store + ': apart leeg CSV-blad gedownload. Vul uitsluitend originele productprijzen en bronmomenten in.'
        : store + ': persoonlijke ingrediënten en de juiste CSV-rijnummers gedownload.')
    } catch (error) {
      setCaptureMessage(error instanceof Error ? error.message : 'Kon het winkelblad niet downloaden.')
    }
  }

  async function handOffBlankHomeCapture(action: 'copy' | 'share') {
    // User-initiated handoff of the exact SAME blank two-store worksheet that
    // the download uses. It contains personal planned demand, never prices.
    const selectedWeek = captureKey
    setCaptureMessage('')
    try {
      if (!captureNeeds.length || captureNeeds.length > 200)
        throw new Error('Kies eerst een weekmenu met 1–200 fysieke ingrediënten.')
      // Build synchronously before Web Share / clipboard: mobile browsers
      // require transient activation from the original button click.
      const csv = makeBlankPlannerCaptureCsv(captureNeeds, stores, ';')
      const guide = makePlannerCaptureGuide(captureNeeds, stores)
      if (selectedWeek !== liveCaptureKey.current)
        throw new Error('Je weekmenu is veranderd; maak het opnameblad opnieuw.')
      const bytes = new TextEncoder().encode(csv).length
      const guideBytes = new TextEncoder().encode(guide).length
      if (bytes > 256000 || guideBytes > 256000)
        throw new Error('Het opnameblad is te groot om te delen. Download het als bestand.')
      if (action === 'copy') {
        if (!navigator.clipboard?.writeText)
          throw new Error('Kopiëren is in deze browser niet beschikbaar. Download de CSV.')
        await navigator.clipboard.writeText(guide)
        setCaptureMessage('Gids met originele ingrediënten en CSV-rijnummers gekopieerd. ' +
          'Download ook de aparte lege CSV om de werkelijk waargenomen winkelproducten in te vullen.')
        return
      }
      if (typeof navigator.share !== 'function')
        throw new Error('Mobiel delen is niet beschikbaar. Gebruik kopiëren of download de CSV.')
      const title = 'Supa · PLUS/DekaMarkt-opnameblad en persoonlijke gids'
      const files = [
        new File([csv], 'supa-leeg-plus-deka-opnameblad.csv',
          { type: 'text/csv;charset=utf-8' }),
        new File([guide], 'supa-plus-deka-csv-rijnummers.txt',
          { type: 'text/plain;charset=utf-8' }),
      ]
      if (navigator.canShare?.({ files })) {
        await navigator.share({ title, files })
        setCaptureMessage('Lege import-CSV en gids met dezelfde CSV-rijnummers gedeeld. ' +
          'Vul uitsluitend werkelijk geobserveerde brongegevens in.')
      } else {
        if (guideBytes > 64000)
          throw new Error('De gids is te groot om als tekst te delen. Download de TXT-gids.')
        await navigator.share({ title, text: guide })
        setCaptureMessage('Gids gedeeld; download daarnaast de aparte lege import-CSV. ' +
          'Er zijn geen winkelprijzen of bronproductcodes verzonnen.')
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setCaptureMessage('Delen geannuleerd; je winkelprijzen zijn niet gewijzigd.')
      } else {
        setCaptureMessage(error instanceof Error ? error.message : 'Overdragen is niet gelukt.')
      }
    }
  }

  // Re-evaluate both original captures when the shopper deliberately shares.
  // Never reuse a stale screenshot, preview or financial total.
  function personalComparisonReceipt(): string {
    const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
    const summary = ownStoreWeekComparison(current)
    if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
        summary.status !== 'comparable')
      throw new Error('Bronnen verlopen of mandjes niet meer volledig vergelijkbaar.')
    const content = printableOwnStoreComparison(summary, {
      PLUS: current.stores.PLUS.observedAt,
      DekaMarkt: current.stores.DekaMarkt.observedAt,
    })
    if (new TextEncoder().encode(content).length > 128000)
      throw new Error('De persoonlijke vergelijking is te groot om te delen.')
    return content
  }

  async function handOffCompleteComparison(action: 'copy' | 'share') {
    setExportMessage('')
    setShareFallback(null)
    try {
      // Build synchronously in the original user gesture for mobile Web Share.
      const content = personalComparisonReceipt()
      if (action === 'share' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: 'Supa · mijn persoonlijke PLUS/DekaMarkt-weekmand', text: content,
          })
          setExportMessage('Je persoonlijke vergelijking is met de gekozen app gedeeld.')
          return
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setExportMessage('Delen geannuleerd; je winkelbronnen zijn behouden.')
            return
          }
        }
      }
      try {
        if (!navigator.clipboard?.writeText) throw Error('Geen klembord')
        await navigator.clipboard.writeText(content)
        setExportMessage('Volledige eigen vergelijking met bronmomenten en SKU’s gekopieerd.')
      } catch {
        setShareFallback({ source: reviewed, week: captureKey, text: content })
        setExportMessage('Selecteer hieronder de privévergelijking en kopieer handmatig.')
      }
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message :
        'Vergelijking niet meer geldig; controleer je bronnen opnieuw.')
    }
  }

  async function handOffPartialPriceRows(action: 'copy' | 'share') {
    setExportMessage('')
    setPartialCopyFallback(null)
    try {
      // Reuse the exact same admission as the private partial CSV export.
      // No unknown prices, subtotal or store winner may enter this message.
      const csv = privateKnownLinePriceCsv(progress, reviewed, Date.now())
      if (new TextEncoder().encode(csv).length > 128000)
        throw Error('Teveel persoonlijke bronregels om te delen. Download de CSV.')
      if (action === 'share' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: 'Supa · mijn afzonderlijk vergelijkbare winkelregels', text: csv,
          })
          setExportMessage('Alleen afzonderlijk vergelijkbare bronregels gedeeld; totaalprijs blijft onbekend.')
          return
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setExportMessage('Delen geannuleerd; eigen bronprijzen zijn behouden.')
            return
          }
        }
      }
      try {
        if (!navigator.clipboard?.writeText) throw Error('Geen klembord')
        await navigator.clipboard.writeText(csv)
        setExportMessage('Eigen vergelijkbare regels als CSV gekopieerd. Ontbrekende winkelprijzen blijven onbekend.')
      } catch {
        setPartialCopyFallback({ source: progress, reviewed, week: captureKey, text: csv })
        setExportMessage('Selecteer de eigen CSV hieronder en kopieer handmatig.')
      }
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message :
        'Bronprijzen verlopen of niet meer afzonderlijk vergelijkbaar.')
    }
  }

  async function downloadCompleteOwnComparison(format: 'csv' | 'txt' | 'html') {
    setExportMessage('')
    try {
      // Formatters are loaded only on demand. Re-check the exact personal
      // capture instants AFTER loading, not just when Home was rendered.
      const [{ ownStoreWeekComparison }, formatter] = await Promise.all([
        import('../planner/ownStoreBudgetComparison.ts'),
        import('../planner/downloadOwnStoreComparison.ts'),
      ])
      const current = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', Date.now())
      const summary = ownStoreWeekComparison(current)
      if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
          summary.status !== 'comparable') {
        throw new Error('Deze winkelprijzen zijn verlopen of niet meer volledig vergelijkbaar.')
      }
      if (format === 'csv') formatter.downloadOwnStoreCsv(current, summary)
      else if (format === 'txt') formatter.downloadOwnStoreText(formatter.printableOwnStoreComparison(summary, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      }))
      else {
        // Existing workbench HTML is the single source of markup, money and
        // physical-demand admission, never a second invented export contract.
        const { privateComparisonHtml } = await import('../comparison/PrivateBasketComparisonExport.tsx')
        const fresh = freshReviewedBaskets(current, current.planKey, Date.now())
        const latest = ownStoreWeekComparison(fresh)
        if (!fresh?.stores.PLUS || !fresh.stores.DekaMarkt ||
            latest.status !== 'comparable') {
          throw new Error('Een bronopname is verlopen tijdens het maken van het afdrukblad.')
        }
        const html = privateComparisonHtml(
          fresh.stores.PLUS.basket, fresh.stores.DekaMarkt.basket,
          fresh.stores.PLUS.observedAt, fresh.stores.DekaMarkt.observedAt,
          true, new Date().toISOString(),
        )
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
        try {
          const a = document.createElement('a')
          a.href = url
          a.download = 'supa-persoonlijke-plus-deka-weekvergelijking.html'
          document.body.append(a)
          try { a.click() } finally { a.remove() }
        } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      }
      setExportMessage('Alleen je eigen volledig gecontroleerde, actuele mandje is als privé-' +
        format.toUpperCase() + ' gedownload. Geen onafhankelijke besparingsclaim.')
    } catch (error) {
      setExportMessage((error instanceof Error ? error.message : 'Download geweigerd.') +
        ' Controleer de echte bronprijzen opnieuw in Vergelijk.')
    }
  }
  const availablePartialProducts = admittedPartialRows.length
  const hasAnySource = singleReady || stores.some(store =>
    !!progress?.stores[store] || !!reviewed?.stores[store])

  // Reuse Planner's targeted missing-source worksheet rather than asking for
  // a new full capture on every visit. An unreviewed original SKU is NOT a
  // missing retailer article and must be checked in the existing workbench.
  const hasMissingOriginalSource = captureNeeds.length > 0 && hasAnySource && !ready &&
    stores.some(store => {
      if (valid?.stores[store]) return false
      const source = progress?.stores[store]
      return !source || !source.fresh ||
        !recentOwnCaptureInstant(source.observedAt, nowMs) ||
        source.missingIngredients.length > 0
    })

  return <section className="private-comparison-journey" aria-label="Mijn echte winkelvergelijking">
    <div className="private-comparison-journey__heading">
      <div>
        <span className="private-comparison-journey__eyebrow">SUPA · JOUW WINKELMANDJE</span>
        <h2>Vergelijk dezelfde boodschappen</h2>
        <p>Plan je maaltijden, voeg zelf toegestane PLUS- en DekaMarkt-bronprijzen toe
          en controleer de gekozen verpakkingen. Je gegevens blijven lokaal in deze sessie.</p>
      </div>
      <button type="button" onClick={onOpenImport}>Open prijsvergelijking</button>
    </div>

    <label className="private-comparison-journey__upload">
      <strong>Eigen PLUS/Deka-prijsbestanden meteen openen</strong>
      <span>Kies één of twee oorspronkelijke CSV, TSV, TXT of Supa JSON-bestanden.
        De bestaande Vergelijk-werkbank controleert de volledige bron en vraagt
        bevestiging voordat bestaande winkelgegevens worden vervangen.</span>
      <input type="file" multiple
        accept=".csv,.tsv,.txt,.json,text/csv,text/plain,text/tab-separated-values,application/json"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          onImportFiles(files)
        }} />
    </label>
    {fileWarning && <p role="alert" className="private-comparison-journey__error">{fileWarning}</p>}
    <section className="private-comparison-journey__paste">
      <strong>Begin met hetzelfde winkelmandje bij PLUS en DekaMarkt</strong>
      <div className="private-comparison-journey__capture-buttons">
        <button type="button" disabled={!captureNeeds.length}
          onClick={() => void downloadBlankHomeCapture('csv')}>
          Download leeg prijsinvulblad voor beide winkels (CSV)
        </button>
        <button type="button" disabled={!captureNeeds.length}
          onClick={() => void downloadBlankHomeCapture('html')}>
          Print winkelopnameformulier (HTML)
        </button>
        <button type="button" disabled={!captureNeeds.length}
          onClick={() => void downloadBlankHomeCapture('txt')}>
          Download gids met ingrediënten per CSV-regel (TXT)
        </button>
        <button type="button" disabled={!captureNeeds.length}
          onClick={() => void handOffBlankHomeCapture('copy')}>
          Kopieer gids met ingrediënten en CSV-rijnummers
        </button>
        <button type="button" disabled={!captureNeeds.length}
          onClick={() => void handOffBlankHomeCapture('share')}>
          Deel opnameblad en gids met telefoon
        </button>
      </div>
      {captureMessage && <p role="status">{captureMessage}</p>}
      {captureNeeds.length > 0 && <details className="private-comparison-journey__field-guide">
        <summary>Bekijk mijn {captureNeeds.length} ingrediënten en de juiste CSV-rijnummers</summary>
        <p>Dit zijn je oorspronkelijke Planner-hoeveelheden bij allebei de winkels.
          De CSV heeft bewust lege productcodes, verpakkingen, bronmomenten en prijzen.
          Koppel de waargenomen producten aan deze rijnummers; vul géén receptnamen
          als zogenaamd geobserveerde winkelproductnamen in.
          De onderstaande rijnummers gelden voor de gecombineerde twee-winkel-CSV.
          In een apart winkelbestand beginnen de regels opnieuw bij 2; gebruik
          de TXT-gids van die winkel voor de juiste nummers.</p>
        <div className="private-comparison-journey__field-guide-shops">
          {stores.map((store, storeIndex) => <section key={store} aria-label={store + ' CSV-rijnummers'}>
            <h3>{store}</h3>
            <div className="private-comparison-journey__single-store-buttons">
              <button type="button" onClick={() => downloadSingleStoreCapture(store, 'csv')}>
                {store}-opnameblad (CSV)
              </button>
              <button type="button" onClick={() => downloadSingleStoreCapture(store, 'txt')}>
                Ingrediëntengids (TXT)
              </button>
            </div>
            <ol start={2 + storeIndex * captureNeeds.length}>
              {captureNeeds.map((need, index) => <li key={store + '-' + index + '-' + need.id}>
                <strong>{need.label}</strong>
                <small>{readablePlannerDemandAmount(need.amount) === 'hoeveelheid nog controleren'
                  ? 'Planner-hoeveelheid nog controleren'
                  : 'Planner-vraag: ' + readablePlannerDemandAmount(need.amount) + ' ' + need.unit}</small>
              </li>)}
            </ol>
          </section>)}
        </div>
      </details>}
      <small>Bij delen kies je zelf een ontvangende app. Die krijgt dan je
        persoonlijke ingrediëntenlijst; Supa voegt geen winkelprijzen toe.</small>
      <button type="button" aria-expanded={showPasteSource}
        onClick={() => setShowPasteSource(open => !open)}>
        {showPasteSource ? 'Sluit spreadsheet-invoer' : 'Plak mijn eigen winkelprijzen uit CSV of JSON'}
      </button>
      <small>Gebruik dezelfde persoonlijke bronimport als in Planner en Producten.
        Eerst een voorbeeld van oorspronkelijke SKU, bronmoment en eenheidsprijs;
        daarna pas expliciet kiezen en controleren in Vergelijk.</small>
      {showPasteSource && <Suspense fallback={<p role="status">Lokale prijsinvoer openen…</p>}>
        <PlannerQuickSourcePaste initiallyOpen hasDemand={captureNeeds.length > 0}
          needs={captureNeeds} onImport={onImportFiles}
          onRecapture={() => onOpenImport()} onReviewIngredient={onReview} />
      </Suspense>}
    </section>

    <div className="private-comparison-journey__shops" aria-label="Brondekking per winkel">
      {stores.map(store => {
        const source = valid?.stores[store]
        const complete = !!source && source.basket.lines.length > 0 &&
          source.basket.unresolvedLineCount === 0 &&
          source.basket.matchedLineCount === source.basket.lines.length
        const partial = progress?.stores[store]
        const fresh = !!source || (!!partial && partial.fresh &&
          recentOwnCaptureInstant(partial.observedAt, nowMs))
        const outdated = (!!reviewed?.stores[store] && !source) ||
          (!!partial && !fresh)
        const total = source?.basket.lines.length ?? partial?.demandLineCount ?? 0
        const confirmed = source?.basket.matchedLineCount ??
          (fresh ? partial?.reviewedLineCount : 0) ?? 0
        const next = !complete && fresh ? partial?.nextIngredientId : null
        const pendingNeeds = !complete && fresh && partial ? [
          ...partial.awaitingReviewIngredients.map(item => ({
            ...item, reason: 'Product of verpakking nog persoonlijk bevestigen',
          })),
          ...partial.missingIngredients.map(item => ({
            ...item, reason: 'Nog geen passend, bevestigd bronartikel',
          })),
        ] : []
        return <div key={store} className="private-comparison-journey__shop">
          <strong>{store}</strong>
          <span>{complete
            ? 'Volledig persoonlijk gecontroleerd'
            : outdated ? 'Bronopname verouderd of toekomstig'
              : partial || source ? 'Nog producten of verpakkingen controleren'
                : 'Nog geen gecontroleerde bronopname'}</span>
          {total > 0 && <>
            <progress max={total} value={Math.min(total, Math.max(0, confirmed))}
              aria-label={store + ' gecontroleerde producten'} />
            <small>{Math.min(total, Math.max(0, confirmed))} van {total} ingrediënten gecontroleerd</small>
          </>}
          <button type="button" className="private-comparison-journey__link"
            onClick={() => next ? onReview(store, next)
              : complete ? onOpenProducts() : onOpenImport()}>
            {next ? 'Controleer volgend bronartikel' :
              complete ? 'Bekijk bevestigde artikelen' :
                outdated ? 'Vernieuw bronopname' : 'Voeg eigen bronprijzen toe'}
          </button>
          {pendingNeeds.length > 0 && <details
            className="private-comparison-journey__review-queue">
            <summary>{pendingNeeds.length} openstaande ingrediënten bij {store}</summary>
            <p>Deze regels zijn nog niet volledig geprijsd en tellen daarom
              niet mee als een volledig winkelmandje.</p>
            <ul>{pendingNeeds.map((need, index) => <li
              key={JSON.stringify([store, need.id, index])}>
              <div>
                <strong>{need.label}</strong>
                <small>{readablePlannerDemandAmount(need.amount ?? null) === 'hoeveelheid nog controleren'
                  ? 'Hoeveelheid nog controleren'
                  : readablePlannerDemandAmount(need.amount ?? null) + ' ' + (need.unit ?? 'eenheid')}</small>
                <small>{need.reason}</small>
              </div>
              <button type="button" onClick={() => onReview(store, need.id)}>
                Controleer dit ingrediënt
              </button>
            </li>)}</ul>
          </details>}
        </div>
      })}
    </div>

    {progress && !ready && <section className="private-comparison-journey__pending-export"
      aria-label="Mijn openstaande winkelbroncontroles">
      <div>
        <h3>Neem ontbrekende winkelproducten mee</h3>
        <p>Download of deel de controlepunten uit jouw huidige winkelopnames.
          Nog niet gevonden artikelen en verouderde bronnen hebben geen prijs.
          De lijst is geen winkelcatalogus of compleet mandje.</p>
      </div>
      <div className="private-comparison-journey__pending-actions">
        <button type="button" onClick={() => void handOffPendingSourceWork('csv')}>
          Bewaar openstaande PLUS/Deka-controles (CSV)
        </button>
        <button type="button" onClick={() => void handOffPendingSourceWork('copy')}>
          Kopieer controles voor onderweg
        </button>
        <button type="button" onClick={() => void handOffPendingSourceWork('share')}>
          Deel mijn ontbrekende winkelproducten
        </button>
      </div>
      {pendingMessage && <p role="status">{pendingMessage}</p>}
      {pendingCopyText && <textarea readOnly rows={8} value={pendingCopyText}
        aria-label="Selecteerbare privé-lijst met ontbrekende winkelbroncontroles"
        onFocus={event => event.currentTarget.select()} />}
    </section>}

    {!ready && captureMomentsDiffer && <section
      className="private-comparison-journey__source-window"
      role="status" aria-label="Originele winkelmomenten niet vergelijkbaar">
      <strong>De twee winkelopnames liggen meer dan 24 uur uit elkaar</strong>
      <p>Er zijn individuele, actuele originele winkelmomenten, maar die zijn
        niet gelijktijdig genoeg voor een eerlijk prijsverschil van hetzelfde mandje.
        Bestaande bevestigde productregels blijven afzonderlijk zichtbaar;
        het twee-winkelprijsverschil blijft onbekend.</p>
      <small>PLUS: {plusOriginalAt} · DekaMarkt: {dekaOriginalAt}</small>
      <button type="button" onClick={onOpenImport}>
        Vernieuw de oorspronkelijke bron van één winkel
      </button>
    </section>}
    {captureNeeds.length > 0 && <section
      className="private-comparison-journey__coverage"
      aria-label="Hetzelfde fysieke mandje bij PLUS en DekaMarkt">
      <strong>Van weekmenu naar twee gecontroleerde winkelmandjes</strong>
      <p>Volg per ingrediënt welke originele SKU en verpakking bij beide winkels
        zijn gekoppeld, en welke prijs of broncontrole nog ontbreekt.
        Download de openstaande PLUS-/Deka-controles per winkel als werkblad voor onderweg.
        Deze status maakt een onvolledig mandje niet alsnog geprijsd.</p>
      <button type="button" aria-expanded={showTwoStoreCoverage}
        onClick={() => setShowTwoStoreCoverage(value => !value)}>
        {showTwoStoreCoverage ? 'Verberg de complete twee-winkelcontrole'
          : 'Bekijk ' + captureNeeds.length + ' ingrediënten en mijn openstaande winkelcontroles'}
      </button>
      {showTwoStoreCoverage && <Suspense fallback={
        <p role="status">Twee-winkelcontrolelijst openen…</p>
      }>
        <PlannerTwoStoreCoverage
          needs={captureNeeds} progress={progress} reviewed={reviewed}
          comparisonStatus={comparisonStatus} now={nowMs}
          onOpenComparison={onOpenImport} onReviewIngredient={onReview} />
      </Suspense>}
    </section>}

    {hasMissingOriginalSource && <section
      className="private-comparison-journey__targeted"
      aria-label="Gericht ontbrekende originele winkelbronnen aanvullen">
      <strong>Je bestaande winkelopnames behouden</strong>
      <p>Er missen nog originele PLUS- of DekaMarkt-producten.
        Maak alleen voor die ontbrekende fysieke ingrediënten een
        nieuw leeg importblad. Reeds gekoppelde bronproducten worden
        niet tot nieuwe prijzen of een nieuw bronmoment omgezet.</p>
      <button type="button" aria-expanded={showTargetedCapture}
        onClick={() => setShowTargetedCapture(value => !value)}>
        {showTargetedCapture ? 'Sluit gerichte bronopname'
          : 'Maak invulbladen voor alleen ontbrekende winkelproducten'}
      </button>
      {showTargetedCapture && <Suspense fallback={
        <p role="status">Gerichte winkelopname openen…</p>
      }>
        <PlannerMissingCapturePanel captureNeeds={captureNeeds}
          captureProgress={progress} reviewed={reviewed}
          now={nowMs} onOpenComparison={onOpenImport} />
      </Suspense>}
    </section>}

    <div className="private-comparison-journey__result" role="status" aria-live="polite">
      {ready && delta !== null ? <>
        <span>Vergelijking van hetzelfde volledige eigen mandje</span>
        <strong>{cheaper
          ? cheaper + ' is ' + euro.formatCents(delta) + ' goedkoper in jouw bronopnames'
          : 'Beide eigen mandjes hebben hetzelfde hele-pakbedrag'}</strong>
        <p>PLUS: {euro.formatCents(plus!.basket.totalCents)} · DekaMarkt: {euro.formatCents(deka!.basket.totalCents)}.
          Alleen voor jouw geselecteerde, volledig gecontroleerde producten en bronmomenten.
          Dit is geen kassagarantie of onafhankelijk bewezen besparing.</p>
        <p className="private-comparison-journey__capture-times">
          Originele bronmomenten: PLUS <time dateTime={plus!.observedAt}>{plus!.observedAt}</time>
          {' '}· DekaMarkt <time dateTime={deka!.observedAt}>{deka!.observedAt}</time>.
          {' '}De prijzen zijn uitsluitend jouw eigen opnames, niet live opgehaald.
        </p>
        <div className="private-comparison-journey__actions">
          <button type="button" onClick={() => void downloadCompleteOwnComparison('csv')}>
            Download volledig vergelijkbaar mandje (CSV)
          </button>
          <button type="button" className="ghost-button"
            onClick={() => void downloadCompleteOwnComparison('txt')}>
            Bewaar persoonlijk prijs- en SKU-overzicht (TXT)
          </button>
          <button type="button" className="ghost-button"
            onClick={() => void downloadCompleteOwnComparison('html')}>
            Download afdrukbaar privévergelijkingsblad (HTML)
          </button>
          <button type="button" className="ghost-button"
            onClick={() => void handOffCompleteComparison('copy')}>
            Kopieer mijn volledige winkelvergelijking
          </button>
          <button type="button" className="ghost-button"
            onClick={() => void handOffCompleteComparison('share')}>
            Deel mijn privévergelijking (mobiel)
          </button>
        </div>
        <div className="private-comparison-journey__store-route-actions"
          role="group" aria-label="Kies een gecontroleerde winkel voor je fysieke boodschappenlijst">
          {stores.map(shop => <button key={shop} type="button"
            onClick={() => onOpenList(shop)}>
            Open {shop}-boodschappenlijst
          </button>)}
        </div>
        <small>Bij kopiëren of delen bevat de tekst jouw originele winkel-SKU’s,
          bronmomenten en eigen prijsregels. Alleen jij bepaalt welke app de
          gegevens ontvangt. Geen onafhankelijke besparingsclaim.</small>
        {exportMessage && <p role="status">{exportMessage}</p>}
        {ready && shareFallback?.source === reviewed && shareFallback.week === captureKey &&
          <label>Mijn vergelijking handmatig kopiëren
          <textarea rows={8} readOnly spellCheck={false} value={shareFallback.text}
            onFocus={event => event.currentTarget.select()} />
        </label>}
      </> : <>
        <span>Werkelijke prijsvergelijking</span>
        <strong>Volledig prijsverschil nog onbekend</strong>
        <p>{plus && deka && !paired
          ? 'Beide winkels zijn afzonderlijk gecontroleerd, maar de bronmomenten liggen meer dan 24 uur uiteen. Vernieuw de oudere opname.'
          : singleReady
            ? 'Er zijn eigen bronregels, maar het volledige twee-winkelmandje ontbreekt of bevat nog openstaande productkeuzes.'
            : hasAnySource
              ? 'Je hebt eigen brondata, maar nog niet voor beide winkels een volledig bevestigd mandje.'
              : 'Nog geen eigen actuele PLUS- en DekaMarkt-prijzen gekoppeld. Voorbeeldprijzen tellen niet mee.'}</p>
      </>}
    </div>
    {ready && fullLinePairs.length > 0 && <section
      className="private-comparison-journey__complete-lines"
      aria-label="Prijsverschil per ingrediënt in het eigen weekmandje">
      <div className="private-comparison-journey__complete-head">
        <div><h3>Prijsverschillen per ingrediënt</h3>
          <p>{fullLinePairs.length} gecontroleerde fysieke ingrediënten uit beide winkels.</p>
        </div>
        <button type="button" onClick={() => onOpenList(cheaper ?? undefined)}>Open winkellijst</button>
      </div>
      <p className="disclaimer">De grootste controleerbare hele-pakverschillen staan bovenaan.
        Bekijk of zoek oorspronkelijke productregels; dit verandert het mandtotaal niet.</p>
      <label className="private-comparison-journey__partial-search">
        <span>Zoek ingrediënt, PLUS/Deka-product, SKU of verpakking</span>
        <input type="search" value={completeQuery}
          onChange={event => { setCompleteQuery(event.currentTarget.value); setShowAllComplete(true) }}
          placeholder="Bijvoorbeeld tomaten 500 g" />
      </label>
      <div className="private-comparison-journey__partial-search">
        <label>Toon verschillen
          <select value={completeStoreFilter} onChange={event => {
            setCompleteStoreFilter(event.currentTarget.value as typeof completeStoreFilter)
            setShowAllComplete(true)
          }}>
            <option value="all">Alle gecontroleerde producten</option>
            <option value="plus">PLUS heeft lagere hele-pakkosten</option>
            <option value="deka">DekaMarkt heeft lagere hele-pakkosten</option>
            <option value="equal">Beide winkels even duur</option>
          </select>
        </label>
        <label>Volgorde
          <select value={completeSort} onChange={event =>
            setCompleteSort(event.currentTarget.value as typeof completeSort)}>
            <option value="impact">Grootste prijsverschil eerst</option>
            <option value="name">Ingrediëntnaam A–Z</option>
            <option value="plus-price">Hoogste PLUS-regelbedrag eerst</option>
            <option value="deka-price">Hoogste Deka-regelbedrag eerst</option>
          </select>
        </label>
      </div>
      <small role="status">{filteredFullLinePairs.length} van {fullLinePairs.length}
        {' '}fysieke ingrediënten zichtbaar · filters veranderen nooit het volledige mandbedrag.</small>
      {(completeWords.length > 0 || completeStoreFilter !== 'all' || completeSort !== 'impact') &&
        <button type="button" onClick={() => {
          setCompleteQuery(''); setCompleteStoreFilter('all')
          setCompleteSort('impact'); setShowAllComplete(false)
        }}>
          Wis zoekterm en filters · grootste echte prijsverschillen
        </button>}
      {visibleFullLinePairs.length === 0 && <div role="status">
        <p>Geen gecontroleerde productregels gevonden met deze zoekterm of dit filter.</p>
        <button type="button" onClick={() => {
          setCompleteQuery(''); setCompleteStoreFilter('all')
          setCompleteSort('impact'); setShowAllComplete(false)
        }}>
          Wis filters en toon grootste verschillen
        </button>
      </div>}
      <ul>{visibleFullLinePairs.map(row => <li key={row.id}>
          <div className="private-comparison-journey__complete-ingredient">
            <strong>{row.ingredientLabel}</strong>
            <small>Nodig: {row.plusLine.requirement.amount} {row.plusLine.requirement.unit}</small>
            <span>{row.deltaCents === 0 ? 'Zelfde hele-pakbedrag' :
              euro.formatCents(Math.abs(row.deltaCents)) + ' lagere hele-pakkosten bij ' +
              (row.deltaCents > 0 ? 'PLUS' : 'DekaMarkt')}</span>
          </div>
          <div className="private-comparison-journey__complete-stores">
            {(['PLUS', 'DekaMarkt'] as const).map(shop => {
              const line = shop === 'PLUS' ? row.plusLine : row.dekaLine
              return <div key={shop}>
                <strong>{shop}</strong>
                <small>{line.productName} · SKU {line.productId}</small>
                <small>{line.packs} hele verpakking(en) × {euro.formatCents(line.pricePerPackCents)}
                  {' '}· {line.pack.amount} {line.pack.unit} × {line.pack.count}</small>
                <span>{euro.formatCents(line.lineTotalCents)} voor deze hoeveelheid</span>
                <small>{privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
                <button type="button" className="private-comparison-journey__link"
                  onClick={() => onReview(shop, row.id)}>
                  Controleer originele {shop}-SKU, verpakking en bronprijs
                </button>
              </div>
            })}
          </div>
          <p className="disclaimer">Indicatieve prijs per gelijke hoeveelheid:
            {' '}{privateMatchedUnitPriceGap(row.plusLine, row.dekaLine)}
            {' '}Een voordelige eenheidsprijs kan door andere hele verpakkingseenheden
            toch een duurder mandje opleveren.</p>
        </li>)}</ul>
      {!showAllComplete && !completeWords.length && completeStoreFilter === 'all' && fullLinePairs.length > 3 &&
        <button type="button" onClick={() => setShowAllComplete(true)}>
          Bekijk alle {fullLinePairs.length} prijsverschillen per ingrediënt
        </button>}
      {showAllComplete && !completeWords.length && fullLinePairs.length > 3 &&
        <button type="button" onClick={() => setShowAllComplete(false)}>
          Toon alleen de drie grootste prijsverschillen
        </button>}
      <p>Bedragen uit je eigen volledige bronmandje; eenheidsprijzen zijn indicatief.
        Geen kassagarantie of onafhankelijk aangetoonde besparing.</p>
      <button type="button" onClick={onOpenProducts}>
        Controleer originele SKU’s en winkelkeuzes in Producten
      </button>
    </section>}
    {!ready && partialPairs.length > 0 && <section
      className="private-comparison-journey__partial"
      aria-label="Gedeeltelijk vergelijkbare eigen bronproducten">
      <h3>{partialPairs.length} ingrediënten al met twee originele pakprijzen</h3>
      <p>Dezelfde fysieke weekvraag en twee bronmomenten binnen 24 uur:
        onderstaande prijzen zijn per ingrediënt te vergelijken.
        <strong> Het volledige prijsverschil blijft onbekend.</strong>
        {' '}Geen winkelwinnaar of onafhankelijk bewezen besparing.</p>
      <label className="private-comparison-journey__partial-search">
        <span>Zoek in de vergelijkbare originele productregels</span>
        <input type="search" value={partialQuery}
          onChange={event => { setPartialQuery(event.target.value); setShowAllPartial(true) }}
          placeholder="Bijvoorbeeld rijst PLUS 1 kg" />
      </label>
      <div className="private-comparison-journey__partial-search">
        <label>Toon mijn losse prijsregels
          <select value={partialStoreFilter} onChange={event => {
            setPartialStoreFilter(event.currentTarget.value as typeof partialStoreFilter)
            setShowAllPartial(true)
          }}>
            <option value="all">Alle afzonderlijk gecontroleerde bronparen</option>
            <option value="plus">PLUS heeft lagere hele-pakkosten</option>
            <option value="deka">DekaMarkt heeft lagere hele-pakkosten</option>
            <option value="equal">Beide winkelregels even duur</option>
          </select>
        </label>
        <label>Volgorde
          <select value={partialSort} onChange={event =>
            setPartialSort(event.currentTarget.value as typeof partialSort)}>
            <option value="impact">Grootste hele-pakverschil eerst</option>
            <option value="name">Ingrediënt A–Z</option>
            <option value="plus-price">Hoogste PLUS-regelbedrag eerst</option>
            <option value="deka-price">Hoogste Deka-regelbedrag eerst</option>
          </select>
        </label>
      </div>
      {(partialWords.length > 0 || partialStoreFilter !== 'all' || partialSort !== 'impact') &&
        <button type="button" onClick={() => {
          setPartialQuery('')
          setPartialStoreFilter('all')
          setPartialSort('impact')
          setShowAllPartial(false)
        }}>
          Wis zoekterm en filters · alle eigen prijsregels
        </button>}
      <small role="status">{filteredPartialPairs.length} van {partialPairs.length}
        {' '}persoonlijk vergelijkbare ingrediëntregels · grootste hele-pakverschil eerst.
        Geen optelling tot weektotaal.</small>
      {shownPartialPairs.length === 0 && <p>Geen afzonderlijk vergelijkbare regels gevonden.
        Wis de zoekterm en filters om alle bekende oorspronkelijke winkelproducten te zien.
        Het complete mandtotaal blijft onbekend.</p>}
      <ul>{shownPartialPairs.map(item =>
        <li key={item.id}>
          <strong>{item.name} · {readablePlannerDemandAmount(item.amount)} {item.unit}</strong>
          {item.plusProduct && <div className="private-comparison-journey__partial-product">
            <strong>PLUS · {item.plusProduct.productName}</strong>
            <small>Originele SKU {item.plusProduct.productId} ·
              {' '}per verpakking {item.plusProduct.packAmount} {item.plusProduct.packUnit}
              {' '}× {item.plusProduct.packCount} ·
              {' '}pakprijs {euro.formatCents(item.plusProduct.pricePerPackCents)}</small>
            <small>Indicatief {item.plusProduct.unitRate ?? 'eenheidsprijs onbekend'}</small>
            <button type="button" className="private-comparison-journey__link"
              onClick={() => onReview('PLUS', item.id)}>
              Controleer originele PLUS-verpakking
            </button>
          </div>}
          {item.dekaProduct && <div className="private-comparison-journey__partial-product">
            <strong>DekaMarkt · {item.dekaProduct.productName}</strong>
            <small>Originele SKU {item.dekaProduct.productId} ·
              {' '}per verpakking {item.dekaProduct.packAmount} {item.dekaProduct.packUnit}
              {' '}× {item.dekaProduct.packCount} ·
              {' '}pakprijs {euro.formatCents(item.dekaProduct.pricePerPackCents)}</small>
            <small>Indicatief {item.dekaProduct.unitRate ?? 'eenheidsprijs onbekend'}</small>
            <button type="button" className="private-comparison-journey__link"
              onClick={() => onReview('DekaMarkt', item.id)}>
              Controleer originele Deka-verpakking
            </button>
          </div>}
          <span>PLUS {item.plusPacks} hele pakken: {euro.formatCents(item.plusCents)}</span>
          <span>DekaMarkt {item.dekaPacks} hele pakken: {euro.formatCents(item.dekaCents)}</span>
          <small>Alleen dit ingrediënt: {item.plusCents === item.dekaCents
            ? 'zelfde hele-pakprijs'
            : (item.plusCents < item.dekaCents ? 'PLUS' : 'DekaMarkt') +
              ' heeft ' + euro.formatCents(Math.abs(item.plusCents - item.dekaCents)) +
              ' lagere hele-pakkosten'}.</small>
          {item.unitGap !== undefined && <small>{formatKnownUnitGap(item.unitGap)}</small>}
          {item.restoredUnitGapText && <small>{item.restoredUnitGapText}</small>}
          <small>Dit is het bedrag voor de benodigde <strong>hele verpakkingen</strong>.
            Een lagere prijs per kg, liter of stuk betekent niet vanzelf lagere
            kosten voor deze hoeveelheid; incomplete mandjes hebben geen totaalwinnaar.</small>
          {(item.plusObservedAt || item.dekaObservedAt) && <small>
            Originele opnametijden: PLUS {item.plusObservedAt ?? 'onbekend'} ·
            {' '}DekaMarkt {item.dekaObservedAt ?? 'onbekend'}.
          </small>}
          <div className="private-comparison-journey__partial-review">
            <button type="button" onClick={() => onReview('PLUS', item.id)}>
              Controleer PLUS-bronartikel
            </button>
            <button type="button" onClick={() => onReview('DekaMarkt', item.id)}>
              Controleer Deka-bronartikel
            </button>
          </div>
        </li>)}</ul>
      {!showAllPartial && filteredPartialPairs.length > 3 &&
        <button type="button" onClick={() => setShowAllPartial(true)}>
          Bekijk alle {filteredPartialPairs.length} vergelijkbare ingrediënten
        </button>}
      {showAllPartial && filteredPartialPairs.length > 3 &&
        <button type="button" onClick={() => setShowAllPartial(false)}>
          Toon alleen de eerste drie prijsverschillen
        </button>}
      <button type="button" onClick={onOpenProducts}>
        Bekijk alle gecontroleerde regels en ontbrekende bronprijzen in Producten
      </button>
      <button type="button" className="ghost-button" onClick={() => {
        try {
          const count = downloadPrivateKnownLinePriceCsv(progress, reviewed)
          setExportMessage(count + ' individueel vergelijkbare eigen ingrediënten lokaal als CSV opgeslagen. Geen volledig mandbedrag.')
        } catch {
          setExportMessage('De bron of prijsvergelijking is gewijzigd of verlopen. Open Producten of Vergelijk voor een actuele controle.')
        }
      }}>Download mijn bekende regelprijzen voor beide winkels (CSV)</button>
      <button type="button" className="ghost-button"
        onClick={() => void handOffPartialPriceRows('copy')}>
        Kopieer bekende PLUS/Deka-regelprijzen voor Excel
      </button>
      <button type="button" className="ghost-button"
        onClick={() => void handOffPartialPriceRows('share')}>
        Deel alleen bekende winkelregels (mobiel)
      </button>
      <button type="button" className="ghost-button" onClick={() => {
        try {
          downloadPrivateKnownLinePricePrint(progress, reviewed)
          setExportMessage('Alleen de bekende vergelijkbare ingredientprijzen staan nu in een lokaal, afdrukbaar HTML-bestand.')
        } catch {
          setExportMessage('De originele bron is verlopen of gewijzigd; controleer je winkelopnames opnieuw.')
        }
      }}>Bewaar mijn bekende winkelprijzen als offline afdruk (HTML)</button>
      <small>Deelbare CSV bevat alleen persoonlijke bronregels die individueel
        met beide winkels vergelijkbaar zijn. Dit is nooit een mandtotaal of besparingsbewijs.
        Alleen jij kiest welke app je eigen brondata ontvangt.</small>
      {exportMessage && <p role="status">{exportMessage}</p>}
      {!ready && partialPairs.length > 0 && partialCopyFallback?.source === progress &&
        partialCopyFallback?.reviewed === reviewed && partialCopyFallback.week === captureKey &&
        <label>Mijn losse bronregels handmatig kopiëren
        <textarea rows={8} readOnly spellCheck={false} value={partialCopyFallback.text}
          onFocus={event => event.currentTarget.select()} />
      </label>}
    </section>}
    {!hasAnySource && captureNeeds.length > 0 && <section
      className="private-comparison-journey__unpriced-start"
      aria-label="Weekboodschappen zonder winkelprijzen">
      <div>
        <h3>Je weekboodschappen zijn al bruikbaar</h3>
        <p>{captureNeeds.length} oorspronkelijke fysieke ingrediëntvragen in
          jouw gekozen weekmenu. Open de ongeprijsde afvinklijst, ook als je nog
          geen toegestane PLUS- of DekaMarkt-prijsopnames hebt.
          Er worden geen winkelprijzen of producten verzonnen.</p>
      </div>
      <button type="button" onClick={() => onOpenList()}>
        Open mijn ongeprijsde weeklijst
      </button>
    </section>}
    <div className="private-comparison-journey__actions">
      <button type="button" onClick={onOpenPlanner}>Open weekplanner</button>
      <button type="button" onClick={onOpenImport}>Importeer of controleer prijzen</button>
      {hasAnySource && <button type="button" onClick={onOpenProducts}>
        Bekijk bronproducten en ontbrekende matches
      </button>}
      {(singleReady || availablePartialProducts > 0 || hasAnySource) &&
        <button type="button" onClick={() => onOpenList(ready && cheaper ? cheaper : undefined)}>
          {singleReady ? 'Bekijk mijn eigen winkellijst' :
            'Bekijk mijn ongeprijsde weeklijst en bevestigde losse producten'}
        </button>}
    </div>
    <small>Geen fictieve prijzen, automatische retaileropvraging of publieke besparingsclaim.
      Ontbrekende en verlopen bronprijzen blijven onbekend.</small>
  </section>
}
