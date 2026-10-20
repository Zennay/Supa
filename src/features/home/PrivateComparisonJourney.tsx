import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { privateKnownPricePairs, privateProgressProductRows, formatKnownUnitGap, type PrivateKnownProduct, type PrivateKnownUnitGap } from '../products/privateProgressProductRows.ts'
import { euro } from '../../lib/money.ts'
import { downloadPrivateKnownLinePriceCsv } from '../products/privateKnownLinePriceCsv.ts'
import { downloadPrivateKnownLinePricePrint } from '../products/privateKnownLinePricePrint.ts'
import {
  privateReviewedPairWithin24Hours, freshReviewedBaskets,
  recentOwnCaptureInstant, partialReviewedLinePairs,
  type OwnStore, type PrivateCaptureProgress, type PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'
import { makeBlankPlannerCaptureCsv } from '../comparison/plannerPriceCaptureSheet.ts'
import { pendingOwnSourceReviewCsv, pendingOwnSourceReviewText } from '../planner/pendingOwnSourceReviewCsv.ts'
import './privateComparisonJourney.css'

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
  const [showPasteSource, setShowPasteSource] = useState(false)
  const [captureMessage, setCaptureMessage] = useState('')
  const [partialQuery, setPartialQuery] = useState('')
  const [showAllPartial, setShowAllPartial] = useState(false)
  const [showTargetedCapture, setShowTargetedCapture] = useState(false)
  const [pendingCopyText, setPendingCopyText] = useState('')
  const [pendingMessage, setPendingMessage] = useState('')
  const captureKey = JSON.stringify(captureNeeds.map(need =>
    [need.id, need.label, need.amount, need.unit, need.query]))
  const liveCaptureKey = useRef(captureKey)
  liveCaptureKey.current = captureKey

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
  // Use the exact same canonical outcome as Planner's source progress view.
  // A two-shop "covered" UI state alone cannot make an unsafe basket claimable.
  const comparisonStatus = ready ? 'comparable'
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
      plusObservedAt: plus?.observedAt, dekaObservedAt: deka?.observedAt,
    })))
  }
  // Only preexisting source pairs qualify. Search/filter never changes the
  // canonical basket or promotes a partial sum into a whole-week estimate.
  const foldPartial = (value: string) => value.normalize('NFKC')
    .toLocaleLowerCase('nl-NL')
  const normalizedPartialQuery = foldPartial(partialQuery.trim())
  const filteredPartialPairs = partialPairs.filter(row =>
    !normalizedPartialQuery || [row.name, row.id, row.plusProduct?.productName ?? '',
      row.plusProduct?.productId ?? '', row.dekaProduct?.productName ?? '',
      row.dekaProduct?.productId ?? ''].some(value =>
      foldPartial(value).includes(normalizedPartialQuery)))
  const orderedPartialPairs = [...filteredPartialPairs].sort((a, b) =>
    Math.abs(b.dekaCents - b.plusCents) - Math.abs(a.dekaCents - a.plusCents) ||
    a.name.localeCompare(b.name, 'nl-NL'))
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

  async function downloadCompleteOwnComparison(format: 'csv' | 'txt') {
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
      else formatter.downloadOwnStoreText(formatter.printableOwnStoreComparison(summary, {
        PLUS: current.stores.PLUS.observedAt,
        DekaMarkt: current.stores.DekaMarkt.observedAt,
      }))
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
                <small>{need.amount !== null && Number.isFinite(need.amount) && need.amount > 0
                  ? 'Planner-vraag: ' + need.amount + ' ' + need.unit
                  : 'Planner-hoeveelheid nog controleren'}</small>
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
                <small>{need.amount !== null && need.amount !== undefined &&
                  Number.isFinite(need.amount) && need.amount > 0
                    ? need.amount + ' ' + (need.unit ?? 'eenheid')
                    : 'Hoeveelheid nog controleren'}</small>
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

    {captureNeeds.length > 0 && <Suspense fallback={
      <p role="status">Twee-winkelcontrolelijst openen…</p>
    }>
      <PlannerTwoStoreCoverage
        needs={captureNeeds} progress={progress} reviewed={reviewed}
        comparisonStatus={comparisonStatus} now={nowMs}
        onOpenComparison={onOpenImport} onReviewIngredient={onReview} />
    </Suspense>}

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
        </div>
        <div className="private-comparison-journey__store-route-actions"
          role="group" aria-label="Kies een gecontroleerde winkel voor je fysieke boodschappenlijst">
          {stores.map(shop => <button key={shop} type="button"
            onClick={() => onOpenList(shop)}>
            Open {shop}-boodschappenlijst
          </button>)}
        </div>
        {exportMessage && <p role="status">{exportMessage}</p>}
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
      <details>
        <summary>Bekijk alle {fullLinePairs.length} oorspronkelijke prijsregels</summary>
        <ul>{fullLinePairs.map(row => <li key={row.id}>
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
              </div>
            })}
          </div>
        </li>)}</ul>
        <p>Bedragen uit je eigen volledige bronmandje; eenheidsprijzen zijn indicatief.
          Geen kassagarantie of onafhankelijk aangetoonde besparing.</p>
        <button type="button" onClick={onOpenProducts}>
          Controleer originele SKU’s en winkelkeuzes in Producten
        </button>
      </details>
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
          placeholder="Ingrediënt, PLUS/Deka productnaam of SKU" />
      </label>
      <small role="status">{filteredPartialPairs.length} van {partialPairs.length}
        {' '}persoonlijk vergelijkbare ingrediëntregels · grootste hele-pakverschil eerst.
        Geen optelling tot weektotaal.</small>
      {shownPartialPairs.length === 0 && <p>Geen prijsregels gevonden. Wis de zoekterm
        om alle bekende oorspronkelijke winkelproducten te zien.</p>}
      <ul>{shownPartialPairs.map(item =>
        <li key={item.id}>
          <strong>{item.name} · {item.amount} {item.unit}</strong>
          {item.plusProduct && <small>
            PLUS · {item.plusProduct.productName} · SKU {item.plusProduct.productId} ·
            {' '}{item.plusProduct.unitRate ?? 'eenheidsprijs onbekend'}
          </small>}
          {item.dekaProduct && <small>
            DekaMarkt · {item.dekaProduct.productName} · SKU {item.dekaProduct.productId} ·
            {' '}{item.dekaProduct.unitRate ?? 'eenheidsprijs onbekend'}
          </small>}
          <span>PLUS {item.plusPacks} hele pakken: {euro.formatCents(item.plusCents)}</span>
          <span>DekaMarkt {item.dekaPacks} hele pakken: {euro.formatCents(item.dekaCents)}</span>
          <small>Alleen dit ingrediënt: {item.plusCents === item.dekaCents
            ? 'zelfde hele-pakprijs'
            : (item.plusCents < item.dekaCents ? 'PLUS' : 'DekaMarkt') +
              ' heeft ' + euro.formatCents(Math.abs(item.plusCents - item.dekaCents)) +
              ' lagere hele-pakkosten'}.</small>
          {item.unitGap !== undefined && <small>{formatKnownUnitGap(item.unitGap)}</small>}
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
      <button type="button" className="ghost-button" onClick={() => {
        try {
          downloadPrivateKnownLinePricePrint(progress, reviewed)
          setExportMessage('Alleen de bekende vergelijkbare ingredientprijzen staan nu in een lokaal, afdrukbaar HTML-bestand.')
        } catch {
          setExportMessage('De originele bron is verlopen of gewijzigd; controleer je winkelopnames opnieuw.')
        }
      }}>Bewaar mijn bekende winkelprijzen als offline afdruk (HTML)</button>
      {exportMessage && <p role="status">{exportMessage}</p>}
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
