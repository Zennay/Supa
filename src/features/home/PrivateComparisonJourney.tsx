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
import './privateComparisonJourney.css'

const PlannerQuickSourcePaste = lazy(async () => {
  const mod = await import('../planner/PlannerQuickSourcePaste.tsx')
  return { default: mod.PlannerQuickSourcePaste }
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
    })))
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
        </div>
      })}
    </div>

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
      <ul>{partialPairs.slice(0, 3).map(item =>
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
        </li>)}</ul>
      {partialPairs.length > 3 && <small>En nog {partialPairs.length - 3} andere
        gedeeltelijk vergelijkbare ingrediënten in Producten.</small>}
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
