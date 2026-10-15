import { useEffect, useMemo, useState } from 'react'
import { euro } from '../../lib/money.ts'
import {
  OBSERVATION_DRAFT_STORAGE_KEY,
  restoreObservationSheetDraft,
  type ObservationSheet,
} from '../../domain/m3ObservationSheet.ts'
import {
  buildObservedComparisonPreview,
  type ObservedPriceLine,
} from './observedStoreComparison.ts'
import './ObservedStoreComparisonView.css'

type StoredComparisonDraft = {
  sheet: ObservationSheet | null
  unreadable: boolean
}

function readSavedObservations(): StoredComparisonDraft {
  if (typeof window === 'undefined') return { sheet: null, unreadable: false }
  try {
    const raw = window.localStorage.getItem(OBSERVATION_DRAFT_STORAGE_KEY)
    if (!raw) return { sheet: null, unreadable: false }
    const sheet = restoreObservationSheetDraft(raw)
    return { sheet, unreadable: sheet === null }
  } catch {
    return { sheet: null, unreadable: true }
  }
}

function priceLabel(line: ObservedPriceLine) {
  if (line.status === 'priced' && line.totalCents !== null) {
    return euro.formatCents(line.totalCents)
  }
  if (line.status === 'unavailable') return 'Niet beschikbaar'
  if (line.status === 'untrusted') return 'Controle nodig'
  return 'Nog geen prijs'
}

function rowDetail(line: ObservedPriceLine) {
  if (line.status !== 'priced' || line.packs === null) return null
  return `${line.packs} verpakking${line.packs === 1 ? '' : 'en'} · ${line.productName ?? ''}`
}

export function ObservedStoreComparisonView({
  onOpenObservation,
}: {
  onOpenObservation: () => void
}) {
  const [saved, setSaved] = useState(readSavedObservations)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => {
      setSaved(readSavedObservations())
      setNowMs(Date.now())
    }
    // Re-read after the user edits Meten in another tab or returns to the app.
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(timer)
    }
  }, [])

  const preview = useMemo(
    () => saved.sheet ? buildObservedComparisonPreview(saved.sheet, nowMs) : null,
    [saved.sheet, nowMs],
  )
  const statusText = !preview
    ? 'Nog geen winkelprijzen ingevoerd'
    : preview.comparable
      ? preview.outcome === 'better'
        ? `DekaMarkt is ${euro.formatCents(preview.savingsCents ?? 0)} goedkoper`
        : preview.outcome === 'worse'
          ? `PLUS is ${euro.formatCents(-(preview.savingsCents ?? 0))} goedkoper`
          : 'Beide winkels zijn even duur'
      : 'Nog geen betrouwbare volledige vergelijking'

  return (
    <section className="screen observed-compare-screen" data-observed-comparison="true">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Dezelfde boodschappen · twee winkels</span>
          <h2>PLUS vs DekaMarkt</h2>
        </div>
      </div>
      <p className="disclaimer">
        Vergelijk de werkelijk genoteerde prijzen van dezelfde 11 ingrediënten.
        Geen voorbeeldprijzen en geen verzonnen winkeldata.
      </p>

      <div className="observed-compare-summary" data-comparison-ready={preview?.comparable ? 'true' : 'false'}>
        <span className="eyebrow">{preview?.comparable ? 'Uitkomst van deze meting' : 'Vergelijking in opbouw'}</span>
        <strong role="status" aria-live="polite">{statusText}</strong>
        <div className="observed-compare-totals">
          <div>
            <span>PLUS</span>
            <strong data-store="plus">
              {preview?.plus.knownSubtotalCents === null || !preview
                ? '—'
                : euro.formatCents(preview.plus.knownSubtotalCents)}
            </strong>
            <small>
              {preview ? `${preview.plus.matched}/${preview.plus.total} prijzen bruikbaar` : '0 prijzen'}
            </small>
          </div>
          <div>
            <span>DekaMarkt</span>
            <strong data-store="dekamarkt">
              {preview?.dekamarkt.knownSubtotalCents === null || !preview
                ? '—'
                : euro.formatCents(preview.dekamarkt.knownSubtotalCents)}
            </strong>
            <small>
              {preview ? `${preview.dekamarkt.matched}/${preview.dekamarkt.total} prijzen bruikbaar` : '0 prijzen'}
            </small>
          </div>
        </div>
        <p className="disclaimer" data-comparison-evidence-boundary>
          {preview?.comparable
            ? 'Dit zijn de volledige mandbedragen van deze ene vastgelegde meting. Eén meting bewijst geen algemene besparing.'
            : 'Getoonde bedragen zijn uitsluitend subtotalen van ingevulde, herkenbare producten. Ontbrekende of ongeschikte prijzen tellen niet mee; er wordt geen prijswinnaar bepaald.'}
        </p>
        {saved.unreadable && (
          <p role="alert" className="disclaimer">
            Het bestaande lokale meetconcept kan niet veilig worden gelezen. Het is niet gewijzigd.
            Gebruik Meten om het concept te herstellen.
          </p>
        )}
        {!preview?.comparable && preview && preview.reasons.length > 0 && (
          <p className="disclaimer" data-comparison-open-checks>
            {preview.reasons.length} controles open. {preview.reasons[0]}
          </p>
        )}
        <button type="button" className="primary-button" onClick={onOpenObservation}>
          {preview?.comparable ? 'Prijzen controleren in Meten' : 'Prijzen invullen in Meten'}
        </button>
      </div>

      <div className="observed-compare-lines" aria-label="Prijsverschil per ingrediënt">
        <div className="observed-compare-header" aria-hidden="true">
          <span>Ingrediënt</span><span>PLUS</span><span>DekaMarkt</span>
        </div>
        {preview ? preview.rows.map((row) => (
          <div className="observed-compare-row" key={row.id} data-ingredient-id={row.id}>
            <div className="observed-compare-ingredient">
              <strong>{row.ingredientLabel}</strong>
              <small>Benodigd: {row.amount} {row.unit}</small>
              {row.differenceCents !== null && (
                <small className="observed-compare-row-delta" data-observed-row-delta>
                  {row.differenceCents === 0
                    ? 'Zelfde regelprijs'
                    : row.differenceCents > 0
                      ? `DekaMarkt ${euro.formatCents(row.differenceCents)} voordeliger op deze regel`
                      : `PLUS ${euro.formatCents(-row.differenceCents)} voordeliger op deze regel`}
                </small>
              )}
            </div>
            <div className="observed-compare-price" data-price-side="plus" data-price-status={row.plus.status}>
              <span className="observed-compare-mobile-label">PLUS</span>
              <strong>{priceLabel(row.plus)}</strong>
              {rowDetail(row.plus) && <small>{rowDetail(row.plus)}</small>}
            </div>
            <div className="observed-compare-price" data-price-side="dekamarkt" data-price-status={row.dekamarkt.status}>
              <span className="observed-compare-mobile-label">DekaMarkt</span>
              <strong>{priceLabel(row.dekamarkt)}</strong>
              {rowDetail(row.dekamarkt) && <small>{rowDetail(row.dekamarkt)}</small>}
            </div>
          </div>
        )) : (
          <p className="disclaimer">Je hebt nog geen meting opgeslagen. Vul de prijzen van PLUS en DekaMarkt in via Meten.</p>
        )}
      </div>
      <p className="disclaimer">
        De bedragen komen alleen van gegevens die op dit apparaat zijn ingevoerd. Supa haalt voor
        deze vergelijking niet automatisch live prijzen op; controleer je meting en kassabon.
      </p>
    </section>
  )
}
