import { useState } from 'react'
import { privateTwoStoreCoverageCsv, privateTwoStoreCoverageText, type CoverageExportLine } from './twoStoreCoverageExport.ts'
import { freshReviewedBaskets, recentOwnCaptureInstant, type PrivateCaptureProgress, type PrivateReviewedBaskets, type OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import './plannerTwoStoreCoverage.css'

const STORES = ['PLUS', 'DekaMarkt'] as const
type Cell = { kind: 'ready' | 'reviewed' | 'review' | 'missing' | 'source' | 'expired'; text: string }


/** This is a work queue over the canonical physical Planner demand, never a
 * second financial calculation. One shop may be ready while the paired total
 * remains unknown; neither readiness nor a unit price is a savings claim. */
function cellFor(
  store: OwnStore, id: string, progress: PrivateCaptureProgress | null,
  reviewed: PrivateReviewedBaskets | null, now: number,
): Cell {
  // Re-evaluate the original nanosecond timestamp, the physical rows and the
  // whole-pack ledger for each export action. An old React prop is no longer
  // enough to call an otherwise visible store "ready".
  const receipt = freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', now)?.stores[store]
  if (receipt) return { kind: 'ready', text: 'Heel mandje gecontroleerd' }
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
  if (capture.demandLineCount < 1) return { kind: 'review', text: 'Koppeling nog niet beoordeeld' }
  return { kind: 'reviewed', text: 'SKU gekoppeld · mandje nog onvolledig' }
}

function amountText(need: PlannerCaptureGuideNeed): string {
  return typeof need.amount === 'number' && Number.isFinite(need.amount) &&
    need.amount > 0 && need.amount <= 1_000_000
    ? `${need.amount.toLocaleString('nl-NL', { useGrouping: false, maximumFractionDigits: 3 })} ${need.unit}`
    : 'Hoeveelheid nog controleren'
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
  const items = needs.map(need => ({
    need,
    cells: STORES.map(store => cellFor(store, need.id, safeProgress, safeReviewed, now)),
  }))
  const ready = STORES.map((_, index) => items.filter(item =>
    ['ready', 'reviewed'].includes(item.cells[index].kind)).length)
  const pending = items.filter(item => item.cells.some(cell =>
    cell.kind !== 'ready' && cell.kind !== 'reviewed'))
  const normalizedSearch = ingredientSearch.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const visible = (showAll ? items : pending).filter(item => {
    if (normalizedSearch &&
        ![item.need.label, item.need.id].some(value =>
          value.normalize('NFKC').toLocaleLowerCase('nl').includes(normalizedSearch))) return false
    if (storeFilter === 'both') return true
    const cell = item.cells[storeFilter === 'PLUS' ? 0 : 1]
    return cell.kind !== 'ready' && cell.kind !== 'reviewed'
  })
  function exportRows(at: number): CoverageExportLine[] {
    return needs.map(need => {
      const plus = cellFor('PLUS', need.id, safeProgress, safeReviewed, at)
      const deka = cellFor('DekaMarkt', need.id, safeProgress, safeReviewed, at)
      return {
        ingredientId: need.id, ingredient: need.label, demand: amountText(need),
        plusStatus: plus.text,
        plusObservedAt: safeProgress?.stores.PLUS?.observedAt ??
          safeReviewed?.stores.PLUS?.observedAt ?? '',
        dekaStatus: deka.text,
        dekaObservedAt: safeProgress?.stores.DekaMarkt?.observedAt ??
          safeReviewed?.stores.DekaMarkt?.observedAt ?? '',
      }
    })
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
    <div className="supa-two-store-coverage__export-actions">
      <button type="button" className="ghost-button" onClick={downloadCoverage}>
        Download complete twee-winkelstatus (CSV)
      </button>
      <button type="button" className="ghost-button" onClick={() => void copyCoverage()}>
        Kopieer mijn twee-winkelcontrolelijst
      </button>
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
                  cell.kind === 'source' || cell.kind === 'expired'
                    ? onOpenComparison() : onReviewIngredient(store, need.id)}>
                {cell.kind === 'source' ? 'Importeer bron' : cell.kind === 'expired'
                  ? 'Vernieuw bron' : 'Bekijk oorspronkelijke SKU'}
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
