import { useRef, useState } from 'react'
import { freshReviewedBaskets, type PrivateCaptureProgress, type PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import type { CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import './plannerMissingCapture.css'

const stores = ['PLUS', 'DekaMarkt'] as const

export function PlannerMissingCapturePanel({ captureNeeds, captureProgress, reviewed, now }: {
  captureNeeds: readonly PlannerCaptureGuideNeed[]
  captureProgress: PrivateCaptureProgress | null
  reviewed: PrivateReviewedBaskets | null
  now: number
}) {
  const [localMessage, setLocalMessage] = useState('')
  const [copyableMissingGuide, setCopyableMissingGuide] = useState<{
    store: CaptureStore; text: string; fingerprint: string
  } | null>(null)
  // Existing SKU reviews are not fresh source captures. Only missing physical
  // source candidates require this deliberately blank partial input sheet.
  const missingCaptureFor = (store: CaptureStore, at = now): PlannerCaptureGuideNeed[] => {
    if (freshReviewedBaskets(reviewed, reviewed?.planKey ?? '', at)?.stores[store]) return []
    const progress = captureProgress?.stores[store]
    if (!progress || !progress.fresh || !Number.isFinite(Date.parse(progress.observedAt)) ||
        at < Date.parse(progress.observedAt) - 300_000 ||
        at - Date.parse(progress.observedAt) > 604_800_000) return [...captureNeeds]
    const missing = new Set(progress.missingIngredients.map(need => need.id))
    return captureNeeds.filter(need => missing.has(need.id))
  }

  const captureFingerprint = JSON.stringify([
    captureNeeds.map(need => [need.id, need.label, need.unit, need.amount]),
    captureProgress?.planKey, captureProgress?.stores, reviewed?.planKey,
    reviewed?.stores.PLUS?.observedAt, reviewed?.stores.DekaMarkt?.observedAt,
  ])
  const latestCaptureFingerprint = useRef(captureFingerprint)
  latestCaptureFingerprint.current = captureFingerprint
  async function copyMissingCaptureFor(store: CaptureStore) {
    setLocalMessage('')
    setCopyableMissingGuide(null)
    try {
      const needs = missingCaptureFor(store, Date.now())
      if (!needs.length) throw new Error(store + ': er zijn geen ontbrekende producten om te kopiëren.')
      const fingerprint = captureFingerprint
      const { makePlannerCaptureGuide } = await import('../comparison/plannerPriceCaptureGuide.ts')
      if (latestCaptureFingerprint.current !== fingerprint)
        throw new Error('Het weekmenu is gewijzigd. Kopieer de nieuwe opnamebehoefte opnieuw.')
      const content = makePlannerCaptureGuide(needs, [store])
      if (navigator.clipboard?.writeText) {
        try {
          if (latestCaptureFingerprint.current !== fingerprint ||
              JSON.stringify(missingCaptureFor(store, Date.now())) !== JSON.stringify(needs)) {
            throw new Error('Brondata gewijzigd tijdens kopiëren.')
          }
          await navigator.clipboard.writeText(content)
          setLocalMessage(store + ': je ongeprijsde meeneemlijst met alle ontbrekende ingrediënten is gekopieerd.')
          return
        } catch { /* Fallback exposes same sanitized, selectable content. */ }
      }
      if (latestCaptureFingerprint.current !== fingerprint) return
      setCopyableMissingGuide({ store, text: content, fingerprint })
      setLocalMessage('Klembord niet toegestaan: selecteer de meeneemlijst van ' + store + ' hieronder.')
    } catch (cause) {
      setLocalMessage(cause instanceof Error ? cause.message : 'Mobiele meeneemlijst niet beschikbaar.')
    }
  }
  async function downloadCombinedMissingCapture(kind: 'csv' | 'csv-excel' | 'guide') {
    setLocalMessage('')
    try {
      const fingerprint = captureFingerprint
      const byStore = {
        PLUS: missingCaptureFor('PLUS', Date.now()),
        DekaMarkt: missingCaptureFor('DekaMarkt', Date.now()),
      }
      if (!byStore.PLUS.length && !byStore.DekaMarkt.length) {
        throw new Error('Er zijn geen ontbrekende winkelproducten. Bevestig bestaande SKU’s in Vergelijk.')
      }
      const { selectiveTwoStoreCaptureCsv, selectiveTwoStoreCaptureGuide } =
        await import('./selectiveTwoStoreCapture.ts')
      const content = kind === 'guide'
        ? selectiveTwoStoreCaptureGuide(byStore)
        : selectiveTwoStoreCaptureCsv(byStore, kind === 'csv-excel' ? ';' : ',')
      if (latestCaptureFingerprint.current !== fingerprint ||
          JSON.stringify(byStore) !== JSON.stringify({
            PLUS: missingCaptureFor('PLUS', Date.now()),
            DekaMarkt: missingCaptureFor('DekaMarkt', Date.now()),
          })) throw new Error('Je weekmenu of winkelbron is gewijzigd. Download het actuele blad opnieuw.')
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'guide' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-plus-deka-alleen-ontbrekende-producten' +
          (kind === 'csv-excel' ? '-spreadsheet.csv' :
            kind === 'guide' ? '-meeneemlijst.txt' : '.csv')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setLocalMessage('Een gecombineerd leeg blad voor ' + byStore.PLUS.length +
        ' PLUS- en ' + byStore.DekaMarkt.length + ' DekaMarkt-producten is lokaal gedownload. ' +
        'De originele weekvraag blijft gelijk en ontbrekende bronprijzen blijven onbekend.')
    } catch (cause) {
      setLocalMessage(cause instanceof Error ? cause.message : 'Het gecombineerde invulblad is niet beschikbaar.')
    }
  }
  async function downloadMissingCaptureFor(store: CaptureStore, kind: 'csv' | 'csv-excel' | 'guide' | 'print') {
    setLocalMessage('')
    try {
      const needs = missingCaptureFor(store, Date.now())
      const fingerprint = captureFingerprint
      if (!needs.length) throw new Error(store + ': geen ontbrekende productmatches. Beoordeel bestaande SKU’s in Vergelijk.')
      const content = kind === 'csv' || kind === 'csv-excel'
        ? (await import('../comparison/plannerPriceCaptureSheet.ts'))
          .makeBlankPlannerCaptureCsv(needs, [store], kind === 'csv-excel' ? ';' : ',')
        : kind === 'print'
          ? (await import('../comparison/plannerPriceCapturePrint.ts'))
            .makePrintablePlannerCaptureHtml(needs, [store])
          : (await import('../comparison/plannerPriceCaptureGuide.ts'))
            .makePlannerCaptureGuide(needs, [store])
      if (latestCaptureFingerprint.current !== fingerprint ||
          JSON.stringify(missingCaptureFor(store, Date.now())) !== JSON.stringify(needs)) {
        throw new Error('Het weekmenu of de winkelbron is gewijzigd. Maak het lege opnameblad opnieuw.')
      }
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'csv' || kind === 'csv-excel' ? 'text/csv;charset=utf-8' :
          kind === 'print' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-' + needs.length +
          '-ontbrekende-producten' + (kind === 'csv-excel' ? '-spreadsheet' : '') + '.' +
          (kind === 'csv' || kind === 'csv-excel' ? 'csv' : kind === 'print' ? 'html' : 'txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setLocalMessage(store + ': leeg blad voor ' + needs.length +
        ' ontbrekende originele producten gedownload. Vul uitsluitend werkelijk geobserveerde SKU, verpakking, beschikbaarheid, tijd en prijs in; importeer daarna via Vergelijk.')
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Gerichte bronopname mislukt.')
    }
  }
  return (
      <div className="own-store-planner__targeted-capture" aria-label="Gericht ontbrekende productbronnen vastleggen">
        <strong>Alleen ontbrekende producten aanvullen</strong>
        <p>Vul ontbrekende bronproducten opnieuw in zonder de complete week over te schrijven.
          Nog niet bevestigde SKU’s controleer je direct in Vergelijk.</p>
        {(missingCaptureFor('PLUS').length > 0 || missingCaptureFor('DekaMarkt').length > 0) &&
          <div className="own-store-planner__targeted-combined" aria-label="Eén opnameblad voor beide winkels">
            <strong>Beide winkels in één invulbestand</strong>
            <span>{missingCaptureFor('PLUS').length} ontbrekende PLUS-producten ·
              {' '}{missingCaptureFor('DekaMarkt').length} ontbrekende DekaMarkt-producten</span>
            <button type="button" className="ghost-button" onClick={() => void downloadCombinedMissingCapture('csv')}>
              Download gecombineerd importeerbaar CSV
            </button>
            <button type="button" className="ghost-button" onClick={() => void downloadCombinedMissingCapture('csv-excel')}>
              Gecombineerd spreadsheet-CSV (puntkomma)
            </button>
            <button type="button" className="ghost-button" onClick={() => void downloadCombinedMissingCapture('guide')}>
              Download één bijbehorende rijgids (TXT)
            </button>
            <small>De winkels mogen verschillende aantallen lege regels hebben.
              De gids vermeldt exact welke rij bij welk Planner-ingrediënt hoort.
              Importeer het ingevulde bestand via de bestaande Vergelijk-knop.</small>
          </div>}
        {stores.map(store => {
          const pending = missingCaptureFor(store)
          return <div key={store} className="own-store-planner__targeted-store">
            <span><strong>{store}</strong> · {pending.length
              ? pending.length + ' behoeften zonder actuele match'
              : 'geen nieuwe bronproducten nodig'}</span>
            {pending.length > 0 && <>
              <button type="button" className="ghost-button" onClick={() => void downloadMissingCaptureFor(store, 'csv')}>
                Download ontbrekende {store}-producten (CSV)
              </button>
              <button type="button" className="ghost-button" onClick={() => void downloadMissingCaptureFor(store, 'csv-excel')}>
                Spreadsheet-CSV {store} (puntkomma)
              </button>
              <button type="button" className="ghost-button" onClick={() => void downloadMissingCaptureFor(store, 'guide')}>
                Meeneemlijst {store} (TXT)
              </button>
              <button type="button" className="ghost-button" onClick={() => void copyMissingCaptureFor(store)}>
                Kopieer ontbrekende {store}-producten (mobiel)
              </button>
              <button type="button" className="ghost-button" onClick={() => void downloadMissingCaptureFor(store, 'print')}>
                Printbaar {store}-opnameblad (HTML)
              </button>
              {copyableMissingGuide?.store === store &&
        copyableMissingGuide.fingerprint === captureFingerprint && <label className="own-store-planner__targeted-copy">
                Mobiele ongeprijsde meeneemlijst · selecteer alle tekst
                <textarea readOnly rows={Math.min(15, Math.max(6, pending.length + 8))}
                  value={copyableMissingGuide.text} onFocus={event => event.currentTarget.select()} />
              </label>}
              <details className="own-store-planner__targeted-guide">
                <summary>Welke CSV-rij hoort bij welk ontbrekend ingrediënt?</summary>
                <p>De importeerbare CSV heeft eerst een kopregel en daarna onderstaande
                  winkelregels. Vul echte originele winkelproducten in, niet de Planner-namen
                  als vervanging van een artikelcode.</p>
                <ol start={2}>{pending.map((need, index) =>
                  <li key={need.id} value={index + 2}>
                    <strong>{need.label}</strong> · nodig:
                    {' '}{need.amount === null ? 'hoeveelheid controleren' :
                      need.amount.toLocaleString('nl-NL', { useGrouping: false, maximumFractionDigits: 3 }) +
                      ' ' + need.unit}
                  </li>)}</ol>
              </details>
            </>}
          </div>
        })}
        <small>Geen bestaande bron? Dan bevat dit lege blad de hele fysieke Planner-behoefte.
          Prijzen blijven onbekend tot jij echte productgegevens in Vergelijk controleert.</small>
        {localMessage && <p role="status" aria-live="polite">{localMessage}</p>}
      </div>
  )
}
