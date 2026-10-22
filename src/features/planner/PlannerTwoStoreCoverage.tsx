import { useState } from 'react'
import { privateTwoStoreCoverageCsv, privateTwoStoreCoverageText, type CoverageExportLine } from './twoStoreCoverageExport.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant, type PrivateCaptureProgress, type PrivateReviewedBaskets, type OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { readablePlannerDemandAmount, type PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import './plannerTwoStoreCoverage.css'

const STORES = ['PLUS', 'DekaMarkt'] as const
type Cell = { kind: 'ready' | 'reviewed' | 'review' | 'missing' | 'source' | 'expired'; text: string }


/** This is a work queue over the canonical physical Planner demand, never a
 * second financial calculation. One shop may be ready while the paired total
 * remains unknown; neither readiness nor a unit price is a savings claim. */
function cellFor(
  store: OwnStore, id: string, progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null,
  admitted: PrivateReviewedBaskets | null, now: number,
): Cell {
  // Re-evaluate the original nanosecond timestamp, the physical rows and the
  // whole-pack ledger for each export action. An old React prop is no longer
  // enough to call an otherwise visible store "ready".
  const receipt = admitted?.stores[store]
  if (receipt) {
    // A canonical source may be partially priced. Do not turn admission
    // of the envelope into an approval for every physical ingredient.
    const matches = receipt.basket.lines.filter(line => line.id === id)
    if (matches.length !== 1) return {
      kind: 'review', text: 'Ingrediënt ontbreekt in deze bronmand: controle vereist',
    }
    const line = matches[0]
    if (line.status === 'matched') {
      const full = receipt.basket.unresolvedLineCount === 0 &&
        receipt.basket.matchedLineCount === receipt.basket.lines.length &&
        receipt.basket.lines.length > 0
      return { kind: 'ready', text: full
        ? 'SKU, verpakking en volledig mandje bevestigd'
        : 'SKU en verpakking bevestigd · ander ingrediënt nog ongeprijsd' }
    }
    const previous = progress?.stores[store]
    if (previous?.fresh && previous.observedAt === receipt.observedAt &&
        previous.awaitingReviewIngredients.some(item => item.id === id)) return {
      kind: 'review', text: 'Controleer originele SKU en verpakking',
    }
    return { kind: 'missing', text: 'Fysiek ingrediënt nog zonder bevestigde prijs' }
  }
  if (reviewed?.stores[store]) return {
    kind: 'expired', text: 'Bron verlopen of mandregels gewijzigd: controle vereist',
  }
  const capture = progress?.stores[store]
  if (!capture) return { kind: 'source', text: 'Bronbestand ontbreekt' }
  if (!capture.fresh || !recentOwnCaptureInstant(capture.observedAt, now)) {
    return { kind: 'expired', text: 'Bron verouderd of ongeldig' }
  }
  if (capture.missingIngredients.some(item => item.id === id)) {
    return { kind: 'missing', text: 'Nog geen passend bronproduct' }
  }
  if (capture.awaitingReviewIngredients.some(item => item.id === id)) {
    return { kind: 'review', text: 'Controleer originele SKU en verpakking' }
  }
  // Only the actual admitted and owner-reviewed SKU detail may count as a
  // locally linked ingredient. Non-missing progress counters are not proof.
  const confirmed = capture.confirmedSourceLines?.filter(item => item.ingredientId === id) ?? []
  if (confirmed.length === 1) return {
    kind: 'reviewed',
    text: 'Originele SKU gekoppeld · volledig mandtotaal nog onbekend',
  }
  return { kind: 'review', text: 'Productmatch nog niet persoonlijk bevestigd' }
}

function amountText(need: PlannerCaptureGuideNeed): string {
  const amount = readablePlannerDemandAmount(need.amount)
  return amount === 'hoeveelheid nog controleren'
    ? 'Hoeveelheid nog controleren' : amount + ' ' + need.unit
}

export function PlannerTwoStoreCoverage({
  needs, progress, reviewed, comparisonStatus, onReviewIngredient, onOpenComparison, now,
}: {
  needs: readonly PlannerCaptureGuideNeed[]
  progress: PrivateCaptureProgress | null
  reviewed: PrivateReviewedBaskets | null
  comparisonStatus: 'missing' | 'different-moments' | 'not-comparable' | 'comparable'
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onOpenComparison: () => void
  now: number
}) {
  const [showAll, setShowAll] = useState(false)
  const [storeFilter, setStoreFilter] = useState<'both' | OwnStore>('both')
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [selectableText, setSelectableText] = useState('')
  if (!needs.length) return null
  // The admission bridge is plan-bound. Never mix two versions of a week.
  const samePlan = !progress || !reviewed || progress.planKey === reviewed.planKey
  const safeReviewed = samePlan ? reviewed : null
  const safeProgress = samePlan ? progress : null
  // Revalidate each complete source only ONCE per render/CSV generation.
  // Repeating its whole-pack calculation for each of up to 1,000 ingredient
  // cells would turn the progress view into a quadratic UI bottleneck.
  const admitted = freshReviewedBaskets(safeReviewed, safeReviewed?.planKey ?? '', now)
  const items = needs.map(need => ({
    need,
    cells: STORES.map(store => cellFor(store, need.id, safeProgress, safeReviewed, admitted, now)),
  }))
  const ready = STORES.map((_, index) => items.filter(item =>
    ['ready', 'reviewed'].includes(item.cells[index].kind)).length)
  const pending = items.filter(item => item.cells.some(cell =>
    cell.kind !== 'ready' && cell.kind !== 'reviewed'))
  // Prefer an actionable existing original-SKU review over a new empty
  // capture. This is navigation only: no SKU is approved by this choice.
  const nextAction = (
    pending.flatMap(({ need, cells }) => STORES.map((store, index) => ({
      need, store, cell: cells[index],
    })).filter(item => storeFilter === 'both' || item.store === storeFilter)).find(item => item.cell.kind === 'review' || item.cell.kind === 'missing') ??
    pending.flatMap(({ need, cells }) => STORES.map((store, index) => ({
      need, store, cell: cells[index],
    })).filter(item => storeFilter === 'both' || item.store === storeFilter)).find(item => item.cell.kind === 'source' || item.cell.kind === 'expired') ??
    null
  )
  function openNextAction() {
    if (!nextAction) return
    // Re-admit all source freshness at click time: a long-open tab cannot
    // silently authorize an expired product or invent a new price.
    const latest = freshReviewedBaskets(safeReviewed, safeReviewed?.planKey ?? '', Date.now())
    const current = cellFor(nextAction.store, nextAction.need.id,
      safeProgress, safeReviewed, latest, Date.now())
    if (current.kind === 'ready' || current.kind === 'reviewed') return
    if (current.kind === 'source' || current.kind === 'expired' || current.kind === 'missing') {
      onOpenComparison()
    } else {
      onReviewIngredient(nextAction.store, nextAction.need.id)
    }
  }
  const normalizedSearch = ingredientSearch.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const visible = (showAll ? items : pending).filter(item => {
    if (normalizedSearch &&
        ![item.need.label, item.need.id].some(value =>
          value.normalize('NFKC').toLocaleLowerCase('nl').includes(normalizedSearch))) return false
    if (storeFilter === 'both') return true
    const cell = item.cells[storeFilter === 'PLUS' ? 0 : 1]
    return cell.kind !== 'ready' && cell.kind !== 'reviewed'
  })
  function exportRows(
    at: number, onlyOpen = false, selected: 'both' | OwnStore = 'both',
  ): CoverageExportLine[] {
    // A previously rendered tab may have crossed its freshness boundary.
    // Recheck before emitting the private, locally downloadable status list.
    const current = freshReviewedBaskets(safeReviewed, safeReviewed?.planKey ?? '', at)
    return needs.map(need => {
      const plus = cellFor('PLUS', need.id, safeProgress, safeReviewed, current, at)
      const deka = cellFor('DekaMarkt', need.id, safeProgress, safeReviewed, current, at)
      const plusOpen = plus.kind !== 'ready' && plus.kind !== 'reviewed'
      const dekaOpen = deka.kind !== 'ready' && deka.kind !== 'reviewed'
      if (onlyOpen && !(selected === 'both' ? plusOpen || dekaOpen :
        selected === 'PLUS' ? plusOpen : dekaOpen)) return null
      return {
        ingredientId: need.id, ingredient: need.label, demand: amountText(need),
        plusStatus: plus.text,
        plusObservedAt: safeProgress?.stores.PLUS?.observedAt ??
          safeReviewed?.stores.PLUS?.observedAt ?? '',
        dekaStatus: deka.text,
        dekaObservedAt: safeProgress?.stores.DekaMarkt?.observedAt ??
          safeReviewed?.stores.DekaMarkt?.observedAt ?? '',
      }
    }).filter((line): line is CoverageExportLine => line !== null)
  }
  function downloadCoverage() {
    setExportMessage('')
    setSelectableText('')
    try {
      const csv = privateTwoStoreCoverageCsv(exportRows(Date.now()))
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-dezelfde-weekmand-twee-winkels-broncontroles.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setExportMessage('Alle fysieke ingrediënten en beide winkelstatussen lokaal geëxporteerd; geen prijzen verzonnen.')
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'Lijst downloaden mislukt.')
    }
  }
  async function copyCoverage() {
    setExportMessage('')
    try {
      const output = privateTwoStoreCoverageText(exportRows(Date.now()))
      if (!navigator.clipboard?.writeText) {
        setSelectableText(output)
        setExportMessage('Klembord niet beschikbaar. Selecteer de getoonde tekst op je apparaat.')
        return
      }
      await navigator.clipboard.writeText(output)
      setSelectableText('')
      setExportMessage('De complete fysieke weekmand en beide bronstatussen zijn gekopieerd, zonder onbevestigde prijzen.')
    } catch {
      try {
        setSelectableText(privateTwoStoreCoverageText(exportRows(Date.now())))
        setExportMessage('Kopiëren geweigerd door je browser. Selecteer de tekst hieronder.')
      } catch { setExportMessage('Lijst is gewijzigd of te groot. Open de actuele Planner opnieuw.') }
    }
  }
  // Export a worklist, not the filtered screen slice: no ingredient is lost
  // because the user happened to search for another product before leaving.
  // Recalculate original SKU/source freshness *at click time*.
  const openForFilter = items.filter(item =>
    storeFilter === 'both' ? item.cells.some(cell =>
      cell.kind !== 'ready' && cell.kind !== 'reviewed')
      : (() => {
          const target = item.cells[storeFilter === 'PLUS' ? 0 : 1]
          return target.kind !== 'ready' && target.kind !== 'reviewed'
        })()).length
  const worklistTarget = storeFilter === 'both' ? 'beide winkels' : storeFilter

  function exportWorklist(kind: 'csv' | 'copy' | 'share') {
    const rows = exportRows(Date.now(), true, storeFilter)
    setExportMessage('')
    setSelectableText('')
    if (!rows.length) {
      setExportMessage('Geen openstaande broncontroles voor deze winkelkeuze. Er is geen werkblad gemaakt.')
      return
    }
    if (kind === 'csv') {
      try {
        const csv = privateTwoStoreCoverageCsv(rows)
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        try {
          const link = document.createElement('a')
          link.href = url
          link.download = 'supa-openstaande-broncontroles-' +
            (storeFilter === 'both' ? 'PLUS-DekaMarkt' : storeFilter) + '.csv'
          document.body.append(link)
          try { link.click() } finally { link.remove() }
        } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
        setExportMessage(rows.length + ' nog te controleren ingrediënten voor ' +
          worklistTarget + ' lokaal opgeslagen. Dit werkblad bevat geen prijzen.')
      } catch (error) {
        setExportMessage(error instanceof Error ? error.message : 'Werkblad downloaden mislukt.')
      }
      return
    }
    let text: string
    try { text = privateTwoStoreCoverageText(rows) }
    catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Werkblad niet beschikbaar.')
      return
    }
    if (kind === 'share' && typeof navigator.share === 'function') {
      void navigator.share({ title: 'Mijn openstaande supermarktbroncontroles', text })
        .then(() => setExportMessage(rows.length + ' openstaande broncontroles aangeboden aan het deelmenu.'))
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setExportMessage('Delen geannuleerd. Je originele brongegevens zijn behouden.')
          } else {
            setSelectableText(text)
            setExportMessage('Delen geweigerd. Kopieer de tekst hieronder handmatig.')
          }
        })
      return
    }
    if (!navigator.clipboard?.writeText) {
      setSelectableText(text)
      setExportMessage('Klembord niet beschikbaar. Selecteer de openstaande broncontroles hieronder.')
      return
    }
    void navigator.clipboard.writeText(text)
      .then(() => setExportMessage(rows.length + ' openstaande broncontroles gekopieerd zonder prijzen.'))
      .catch(() => {
        setSelectableText(text)
        setExportMessage('Kopiëren niet toegestaan. Selecteer de lijst hieronder.')
      })
  }
  return <section className="supa-two-store-coverage" aria-labelledby="supa-coverage-heading">
    <div className="supa-two-store-coverage__heading">
      <div>
        <h4 id="supa-coverage-heading">Hetzelfde weekmandje bij twee winkels</h4>
        <p>Voor elk oorspronkelijk ingrediënt zie je welke bron of productcontrole nog ontbreekt.
          Groene status is geen nieuwe prijs of bewijs van besparing.</p>
      </div>
      <button type="button" className="ghost-button" onClick={onOpenComparison}>
        Open mijn bronimport
      </button>
    </div>
    <div className="supa-two-store-coverage__next" role="status">
      {comparisonStatus === 'comparable' && pending.length === 0
        ? <p><strong>Je eigen twee-winkelmandje is compleet gecontroleerd.</strong>
          Bekijk het werkelijke voorwaardelijke prijsverschil en de route in Planner
          of open je huidige Lijst.</p>
        : nextAction
          ? <>
            <p><strong>Volgende stap · {nextAction.store}</strong> —
              {' '}{nextAction.need.label}: {nextAction.cell.text.toLowerCase()}.
              De originele bron en de productcontrole blijven verplicht.</p>
            <button type="button" className="ghost-button" onClick={openNextAction}>
              {nextAction.cell.kind === 'source' || nextAction.cell.kind === 'expired' || nextAction.cell.kind === 'missing'
                ? 'Open originele ' + nextAction.store + '-bronimport'
                : 'Controleer ' + nextAction.need.label + ' bij ' + nextAction.store}
            </button>
          </>
          : <p>Alle ingrediënten lijken gekoppeld, maar een betrouwbaar volledig
            prijsverschil is nog onbekend. Controleer de bronmomenten en volledige
            verpakkingen via Vergelijk.</p>}
    </div>
    <div className="supa-two-store-coverage__export-actions">
      <button type="button" className="ghost-button" onClick={downloadCoverage}>
        Download complete twee-winkelstatus (CSV)
      </button>
      <button type="button" className="ghost-button" onClick={() => void copyCoverage()}>
        Kopieer mijn twee-winkelcontrolelijst
      </button>
    </div>
    <div className="supa-two-store-coverage__export-actions"
      role="group" aria-label="Alleen openstaande winkelbroncontroles meenemen">
      <strong>{openForFilter} openstaande ingrediënten voor {worklistTarget}</strong>
      <p>Neem uitsluitend nog te controleren originele PLUS-/DekaMarkt-ingrediënten mee.
        Deze selectie is gebaseerd op de actuele bronstatus en niet op een zoekfilter;
        het andere winkelresultaat blijft per ingrediënt ter context zichtbaar.</p>
      <button type="button" className="ghost-button" disabled={openForFilter === 0}
        onClick={() => exportWorklist('csv')}>Download openstaande controles (Excel-CSV)</button>
      <button type="button" className="ghost-button" disabled={openForFilter === 0}
        onClick={() => exportWorklist('copy')}>Kopieer mijn openstaande controles</button>
      <button type="button" className="ghost-button" disabled={openForFilter === 0}
        onClick={() => exportWorklist('share')}>Deel openstaande controles (mobiel)</button>
    </div>
    {exportMessage && <p role="status">{exportMessage}</p>}
    {selectableText && <textarea readOnly rows={10} value={selectableText}
      aria-label="Selecteer volledige twee-winkelcontrolelijst"
      onFocus={event => event.currentTarget.select()} />}
    <div className="supa-two-store-coverage__totals" aria-label="Ingrediëntenstatus per winkel">
      {STORES.map((store, index) => <div key={store}>
        <strong>{store}</strong>
        <span>{ready[index]} / {needs.length} ingrediënten gekoppeld</span>
      </div>)}
    </div>
    {comparisonStatus === 'different-moments' && <p className="supa-two-store-coverage__warning" role="status">
      De twee echte bronmomenten liggen meer dan 24 uur uit elkaar. Een prijsverschil
      is daarom onbekend, ook als alle individuele SKU’s gekoppeld zijn.
      Vernieuw een van je winkelopnames in Vergelijk.
    </p>}
    {comparisonStatus === 'not-comparable' && <p className="supa-two-store-coverage__warning" role="status">
      De fysieke mandregels zijn nog niet aantoonbaar gelijkwaardig.
      Controleer de oorspronkelijke productkeuzes opnieuw in Vergelijk.
    </p>}
    <div className="supa-two-store-coverage__toolbar">
      <p role="status">{pending.length === 0
        ? comparisonStatus === 'comparable'
          ? 'Alle originele fysieke ingrediënten zijn voor beide winkels volledig gecontroleerd.'
          : 'De ingrediëntkoppelingen zijn compleet, maar er is nog geen betrouwbaar twee-winkelprijsverschil.'
        : `${pending.length} van ${needs.length} ingrediënten hebben nog een controle nodig bij minstens één winkel.`}</p>
      <label>Zoek ingrediënt
        <input type="search" maxLength={120} value={ingredientSearch}
          placeholder="Bijvoorbeeld rijst"
          onChange={event => setIngredientSearch(event.currentTarget.value)} />
      </label>
      <label>Winkel met openstaande controles
        <select value={storeFilter}
          onChange={event => setStoreFilter(event.currentTarget.value as 'both' | OwnStore)}>
          <option value="both">Beide winkels</option>
          <option value="PLUS">Alleen PLUS</option>
          <option value="DekaMarkt">Alleen DekaMarkt</option>
        </select>
      </label>
      <label><input type="checkbox" checked={showAll}
        onChange={event => setShowAll(event.currentTarget.checked)} />
        Toon ook volledig gekoppelde ingrediënten</label>
    </div>
    <p role="status">{visible.length} ingrediënt(en) zichtbaar met deze filters.
      De oorspronkelijke fysieke Planner-vraag wordt hierdoor niet gewijzigd.</p>
    {visible.length > 0 ? <div className="supa-two-store-coverage__rows">
      {visible.map(({ need, cells }) => <article key={need.id}
        className="supa-two-store-coverage__row">
        <header><strong>{need.label}</strong><small>{amountText(need)}</small></header>
        <div className="supa-two-store-coverage__shops">
          {STORES.map((store, index) => {
            const cell = cells[index]
            return <section key={store} aria-label={store + ': ' + cell.text}>
              <strong>{store}</strong>
              <span data-status={cell.kind}>{cell.text}</span>
              {cell.kind !== 'ready' && cell.kind !== 'reviewed' && <button
                type="button" onClick={() =>
                  cell.kind === 'source' || cell.kind === 'expired' || cell.kind === 'missing'
                    ? onOpenComparison() : onReviewIngredient(store, need.id)}>
                {cell.kind === 'source' ? 'Importeer bron' : cell.kind === 'expired'
                  ? 'Vernieuw bron' : cell.kind === 'missing' ? 'Voeg origineel bronproduct toe' : 'Bekijk oorspronkelijke SKU'}
              </button>}
            </section>
          })}
        </div>
      </article>)}
    </div> : <div role="status" className="supa-two-store-coverage__empty">
      <p>Geen ingrediënten voor deze zoekterm en winkelkeuze.</p>
      <button type="button" className="ghost-button" onClick={() => {
        setIngredientSearch(''); setStoreFilter('both'); setShowAll(true)
      }}>Toon het complete fysieke mandje</button>
    </div>}
    <small>Alle prijzen blijven onbekend zolang één of beide hele mandjes onvolledig,
      onveilig of verouderd zijn. Geen automatische goedkeuring van producten.</small>
  </section>
}
