import { useEffect, useState } from 'react'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { euro } from '../../lib/money.ts'
import {
  privateReviewedPairWithin24Hours, freshReviewedBaskets,
  recentOwnCaptureInstant, partialReviewedLinePairs,
  type OwnStore, type PrivateCaptureProgress, type PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import './privateComparisonJourney.css'

const stores: OwnStore[] = ['PLUS', 'DekaMarkt']

/**
 * A prominent route from Home to the existing source importer and exact SKU
 * review. Only live, complete owner-reviewed baskets may produce a number.
 * Partial price sources are guidance, not a financial estimate.
 */
export function PrivateComparisonJourney({
  reviewed, progress, onOpenPlanner, onOpenImport, onOpenProducts, onOpenList, onReview, onImportFiles, fileWarning,
}: {
  reviewed: PrivateReviewedBaskets | null
  progress: PrivateCaptureProgress | null
  onOpenPlanner: () => void
  onOpenImport: () => void
  onOpenProducts: () => void
  onOpenList: () => void
  onReview: (store: OwnStore, ingredientId: string) => void
  onImportFiles: (files: File[]) => void
  fileWarning: string
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
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
  const singleReady = !!plus || !!deka
  const partialPairs = ready ? [] : partialReviewedLinePairs(plus, deka)
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

    <div className="private-comparison-journey__shops" aria-label="Brondekking per winkel">
      {stores.map(store => {
        const source = valid?.stores[store]
        const complete = !!source && source.basket.lines.length > 0 &&
          source.basket.unresolvedLineCount === 0 &&
          source.basket.matchedLineCount === source.basket.lines.length
        const partial = progress?.stores[store]
        const fresh = !!source || (!!partial &&
          recentOwnCaptureInstant(partial.observedAt, nowMs))
        const outdated = (!!reviewed?.stores[store] && !source) ||
          (!!partial && !fresh)
        const total = partial?.demandLineCount ?? source?.basket.lines.length ?? 0
        const confirmed = partial?.reviewedLineCount ?? source?.basket.matchedLineCount ?? 0
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
            onClick={() => next ? onReview(store, next) : onOpenImport()}>
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
    {!ready && partialPairs.length > 0 && <section
      className="private-comparison-journey__partial"
      aria-label="Gedeeltelijk vergelijkbare eigen bronproducten">
      <h3>{partialPairs.length} ingrediënten al met twee originele pakprijzen</h3>
      <p>Dezelfde fysieke weekvraag en twee bronmomenten binnen 24 uur:
        onderstaande prijzen zijn per ingrediënt te vergelijken.
        <strong> Het volledige prijsverschil blijft onbekend.</strong>
        {' '}Geen winkelwinnaar of onafhankelijk bewezen besparing.</p>
      <ul>{partialPairs.slice(0, 3).map(({ plus: a, deka: b }) =>
        <li key={a.id}>
          <strong>{a.ingredientLabel} · {a.requirement.amount} {a.requirement.unit}</strong>
          <span>PLUS {a.packs} hele pakken: {euro.formatCents(a.lineTotalCents)}</span>
          <span>DekaMarkt {b.packs} hele pakken: {euro.formatCents(b.lineTotalCents)}</span>
          <small>Alleen dit ingrediënt: {a.lineTotalCents === b.lineTotalCents
            ? 'zelfde hele-pakprijs'
            : (a.lineTotalCents < b.lineTotalCents ? 'PLUS' : 'DekaMarkt') +
              ' heeft ' + euro.formatCents(Math.abs(a.lineTotalCents - b.lineTotalCents)) +
              ' lagere hele-pakkosten'}.</small>
        </li>)}</ul>
      {partialPairs.length > 3 && <small>En nog {partialPairs.length - 3} andere
        gedeeltelijk vergelijkbare ingrediënten in Producten.</small>}
      <button type="button" onClick={onOpenProducts}>
        Bekijk alle gecontroleerde regels en ontbrekende bronprijzen in Producten
      </button>
    </section>}
    <div className="private-comparison-journey__actions">
      <button type="button" onClick={onOpenPlanner}>Open weekplanner</button>
      <button type="button" onClick={onOpenImport}>Importeer of controleer prijzen</button>
      {singleReady && <button type="button" onClick={onOpenList}>Bekijk mijn echte winkellijst</button>}
    </div>
    <small>Geen fictieve prijzen, automatische retaileropvraging of publieke besparingsclaim.
      Ontbrekende en verlopen bronprijzen blijven onbekend.</small>
  </section>
}
