import { useState } from 'react'
import type { OneStoreBasket, BasketTraceLine } from '../../domain/basket.ts'
import type { OfflineCapture } from '../../domain/offlineReviewedImport.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'

type StoreId = 'PLUS' | 'DekaMarkt'
type PendingSourceReview = Extract<BasketTraceLine, { status: 'matched' }>

function singleLine(value: string): string {
  return value.replace(/[\r\n\t\u0000-\u001f\u007f\u2028\u2029]/gu, ' ').trim().slice(0, 200)
}

/**
 * An actionable guide for private, already-admitted local price observations.
 * Never treats a technically complete comparison as independent field proof.
 */
export function ComparisonReadiness({
  plus, deka, sourceFresh, pairedWithin24h, comparable,
  captures, nowMs, onOpenPlanner, onReviewMissing, onOpenImport, pendingHumanReview = 0, pendingReviewByStore, onReviewFirstPending,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  sourceFresh: boolean
  pairedWithin24h: boolean
  comparable: boolean
  captures: { PLUS: OfflineCapture; DekaMarkt: OfflineCapture }
  nowMs: number
  pendingHumanReview?: number
  pendingReviewByStore?: Readonly<Record<StoreId, readonly PendingSourceReview[]>>
  onReviewFirstPending?: () => void
  onOpenPlanner?: () => void
  onReviewMissing: (store: StoreId, ingredientId: string) => void
  onOpenImport: () => void
}) {
  const [exportMessage, setExportMessage] = useState('')
  const sources = (['PLUS', 'DekaMarkt'] as const).map(store => {
    const observation = captures[store]
    const ageValid = Number.isFinite(nowMs) && Number.isFinite(observation.observedMs)
    const ageMs = ageValid ? nowMs - observation.observedMs : Number.NaN
    const olderThanWeek = !ageValid || ageMs > 7 * 24 * 60 * 60 * 1000
    const inFuture = ageValid && ageMs < -5 * 60 * 1000
    const readableAge = !ageValid ? 'ouderdom onbekend'
      : inFuture ? 'in de toekomst'
        : ageMs < 0 ? 'zojuist (kleine klokafwijking)'
          : ageMs < 60 * 60 * 1000 ? Math.max(0, Math.floor(ageMs / 60000)) + ' minuten oud'
            : ageMs < 24 * 60 * 60 * 1000
              ? (ageMs / (60 * 60 * 1000)).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' uur oud'
              : (ageMs / (24 * 60 * 60 * 1000)).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' dagen oud'
    return { store, at: observation.observedAt, ageValid, olderThanWeek, inFuture, readableAge }
  })
  // The imported pair is already canonical-admitted with nanosecond timestamps.
  // Show which source is older without altering its evidence timestamp.
  const plusInstant = captures.PLUS.observedNs
  const dekaInstant = captures.DekaMarkt.observedNs
  const refreshStore = plusInstant <= dekaInstant ? 'PLUS' : 'DekaMarkt'
  const observationGapNs = plusInstant >= dekaInstant
    ? plusInstant - dekaInstant : dekaInstant - plusInstant
  const observationGapHours = Number(observationGapNs) / 3_600_000_000_000
  const pairWithin24h = pairedWithin24h && observationGapNs <= 86_400_000_000_000n
  const sourcesFresh = sourceFresh && sources.every(item => item.ageValid && !item.olderThanWeek && !item.inFuture)
  const gapText = observationGapHours.toLocaleString('nl-NL', { maximumFractionDigits: 1 })

  const hasDemand = plus.selectedMealCount > 0 && deka.selectedMealCount > 0 &&
    plus.lines.length > 0 && deka.lines.length > 0
  const incomplete = (['PLUS', 'DekaMarkt'] as const).flatMap(store => {
    const basket = store === 'PLUS' ? plus : deka
    const first = basket.lines.find(line => line.status === 'unresolved')
    return first ? [{
      id: store, heading: store + ': ' + basket.unresolvedLineCount + ' ingrediënt(en) nog niet gekoppeld',
      detail: basket.matchedLineCount + ' van ' + basket.lines.length +
        ' zijn berekenbaar. Controleer de bronproducten of voer een eigen geldige opname met de ontbrekende artikelen in.',
      onClick: () => onReviewMissing(store, first.id),
      action: 'Koppel het eerste ontbrekende product',
      secondaryAction: 'Bronproducten aanvullen',
      onSecondaryClick: onOpenImport,
    }] : []
  })
  // Re-check the actual capture timestamps here; stale props must not
  // make an old/future source pair look ready after the evidence has aged.
  const needsSource = !sourcesFresh || !pairWithin24h
  const pendingByStoreCount =
    (pendingReviewByStore?.PLUS?.length ?? 0) +
    (pendingReviewByStore?.DekaMarkt?.length ?? 0)
  const pendingCountValid = Number.isSafeInteger(pendingHumanReview) && pendingHumanReview >= 0
  // Both the aggregate count and per-store detail are evidence. A stale zero
  // aggregate must not hide actual pending rows or mark the comparison ready.
  const pendingReviewCount = pendingCountValid
    ? Math.max(pendingHumanReview, pendingByStoreCount)
    : pendingByStoreCount
  const hasPendingHumanReview = !pendingCountValid || pendingReviewCount > 0
  const isReady = comparable && hasDemand && !needsSource &&
    incomplete.length === 0 && !hasPendingHumanReview
  // One portable, strictly unpriced follow-up round for BOTH retailers. This
  // preserves the original store and capture timestamp but never invents an
  // EAN/SKU, a comparable price or an independently observed source.
  const captureWorklist = [
    'Supa · mijn eigen twee-winkel broncontrole',
    'Alleen privé ingevoerde bronmomenten; geen actuele retailerclaim of besparing.',
    `PLUS: ${captures.PLUS.observedAt} (${sources[0].readableAge})`,
    `DekaMarkt: ${captures.DekaMarkt.observedAt} (${sources[1].readableAge})`,
    !sourcesFresh ? 'ACTIE: vernieuw verlopen, toekomstige of onbekende bronmomenten.' : '',
    !pairWithin24h ? `ACTIE: vernieuw ${refreshStore}; bronmomenten verschillen ${gapText} uur.` : '',
    !hasDemand ? 'ACTIE: kies eerst een weekmenu in Planner.' : '',
    ...(['PLUS', 'DekaMarkt'] as const).flatMap(store => {
      const basket = store === 'PLUS' ? plus : deka
      const unresolved = basket.lines.filter(line => line.status === 'unresolved')
      return [
        '', `${store} · ${unresolved.length} nog niet gekoppelde ingrediënten`,
        ...unresolved.map(line => `☐ ${singleLine(line.ingredientLabel)} · ${readablePlannerDemandAmount(line.requirement.amount)} ${line.requirement.unit} · ${singleLine(line.id)} · prijs en match onbekend`),
        ...(pendingReviewByStore?.[store].length
          ? [`${pendingReviewByStore[store].length} voorgestelde bronartikelregels wachten op jouw controle:`,
              ...pendingReviewByStore[store].map(item =>
                `☐ ${singleLine(item.ingredientLabel)} · ${singleLine(item.productName)} · originele SKU ${singleLine(item.productId)}` +
                ` · ${item.pack.count} × ${readablePlannerDemandAmount(item.pack.amount)} ${item.pack.unit} per pak` +
                ` · ${new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(item.pricePerPackCents / 100)} ingevoerde pakprijs` +
                ` · ${privateUnitPrice(item) ?? 'eenheidsprijs nog niet berekenbaar'} · NIET bevestigd`)]
          : []),
        ...(unresolved.length === 0 ? ['Geen onopgeloste productkoppelingen in dit mandje.'] : []),
      ]
    }),
    pendingReviewCount > 0
      ? `ACTIE: controleer nog ${pendingReviewCount} voorgestelde bronartikelregels handmatig (SKU, verpakking en prijs).`
      : !pendingCountValid
        ? 'ACTIE: open broncontrole-telling is ongeldig; laad de broncontrole opnieuw.'
        : '',
    '', 'Vul ontbrekende artikelen uitsluitend aan met jouw eigen toegestane waarnemingen.',
    'Controleer fysieke hoeveelheden en echte pakprijzen opnieuw vóór vergelijking.',
  ].filter(Boolean).join('\n')
  function downloadCaptureWorklist() {
    const blob = new Blob([captureWorklist + '\n'], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-openstaande-plus-deka-broncontrole.txt'
      link.click()
      setExportMessage('Privéwerkblad voor beide winkels lokaal gedownload. Geen prijzen overgenomen.')
    } catch {
      setExportMessage('Download niet beschikbaar. Selecteer en kopieer de tekst hieronder.')
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  const steps: Array<{ id: string; heading: string; detail: string;
    action?: string; onClick?: () => void;
    secondaryAction?: string; onSecondaryClick?: () => void }> = []
  if (!hasDemand) steps.push({
    id: 'plan',
    heading: 'Kies je weekmenu',
    detail: 'Een leeg weekmenu is geen vergelijkbaar boodschappenmandje.',
    action: onOpenPlanner ? 'Open Planner' : undefined, onClick: onOpenPlanner,
  })
  if (!sourcesFresh) steps.push({
    id: 'fresh',
    heading: 'Laad recente prijsopnames',
    detail: sources.filter(item => !item.ageValid || item.olderThanWeek || item.inFuture)
      .map(item => item.store + ': ' + (!item.ageValid ? 'tijdstip onbekend' : item.olderThanWeek ? 'ouder dan 7 dagen' : 'tijdstip in de toekomst'))
      .join('; ') || 'Een of beide bronmomenten vallen buiten het toegestane zeven-dagenvenster.',
    action: 'Naar bronimport', onClick: onOpenImport,
  })
  if (!pairWithin24h) steps.push({
    id: 'gap',
    heading: 'PLUS en DekaMarkt binnen 24 uur observeren',
    detail: 'De bronmomenten verschillen ' + gapText + ' uur. ' + refreshStore +
      ' heeft het oudere bronmoment. Vernieuw die opname met eigen toegestane gegevens; ' +
      'alleen een echt binnen 24 uur geobserveerd paar mag een volledig verschil tonen.',
    action: 'Vervang de verouderde winkelopname', onClick: onOpenImport,
  })
  if (hasDemand) steps.push(...incomplete)
  if (hasDemand && hasPendingHumanReview) steps.push({
    id: 'human-review',
    heading: pendingReviewCount > 0
      ? 'Controleer nog ' + pendingReviewCount + ' bronproductregels'
      : 'Controleer open bronproductregels',
    detail: pendingCountValid
      ? 'Controleer originele artikelcode, verpakking en prijs. Dit is geen bewijs van productidentiteit.'
      : 'De open-reviewtelling is ongeldig. Herlaad de broncontrole en controleer de onbevestigde artikelen.',
    action: onReviewFirstPending ? 'Open eerste onbevestigde artikel' : undefined,
    onClick: onReviewFirstPending,
  })

  if (steps.length === 0 && !comparable) steps.push({
    id: 'integrity',
    heading: 'Controleer de productkoppelingen en hoeveelheden',
    detail: 'De vergelijking voldoet nog niet aan de bestaande volledige-mand- ' +
      'en rekenkundige-integriteitscontroles. Er wordt geen prijsverschil getoond.',
  })

  return <section className="offline-readiness" aria-label="Vergelijking afronden">
    <div className="offline-readiness__heading">
      <h4>{isReady ? 'Je twee privémandjes zijn berekenbaar' : 'Maak je winkelvergelijking compleet'}</h4>
      <p role="status">
        {isReady
          ? 'Beide mandjes bevatten dezelfde gevraagde ingrediënten en zijn ' +
            'binnen de lokale importvoorwaarden rekenkundig vergelijkbaar.'
          : 'Werk de volgende ontbrekende stappen af. Elk bekend deelbedrag blijft ' +
            'zichtbaar, maar is geen volledige besparing.'}
      </p>
    </div>
    {!isReady && <details className="offline-readiness__worklist">
      <summary>Bewaar alle open PLUS- en Deka-controles voor je volgende winkelronde</summary>
      <p>Een gecombineerde, ongeprijsde actielijst met originele bronmomenten, open
        ingrediënten en handmatige controles. Hiermee kun je offline verder, zonder
        dat Supa ontbrekende prijzen of matches invult.</p>
      <button type="button" onClick={downloadCaptureWorklist}>
        Download beide winkels als TXT
      </button>
      {exportMessage && <p role="status">{exportMessage}</p>}
      <label>Of selecteer en kopieer de actielijst
        <textarea rows={10} readOnly spellCheck={false} value={captureWorklist}
          onFocus={event => event.currentTarget.select()} />
      </label>
    </details>}
    <div className="offline-readiness__source-times" aria-label="Ouderdom van privébronnen">
      {sources.map(item => <div key={item.store}>
        <strong>{item.store}</strong>
        <time dateTime={item.at}>{item.at}</time>
        <span>{item.readableAge}</span>
        <small>{item.olderThanWeek ? 'Verouderd: eigen prijswaarneming vernieuwen' :
          item.inFuture ? 'Bronmoment ligt te ver in de toekomst' :
          'Lokale leeftijd binnen 7 dagen; geen externe prijsverificatie'}</small>
      </div>)}
    </div>
    {!pairWithin24h && <p className="disclaimer">
      De twee eigen bronmomenten liggen meer dan 24 uur uiteen.
      Er wordt geen volledig prijsverschil berekend totdat ze tijdsvergelijkbaar zijn.
    </p>}
    {isReady
      ? <p className="offline-readiness__complete">
          Alle verplichte lokale berekeningsvoorwaarden zijn gehaald.
          Dit is géén onafhankelijk geverifieerde winkelprijs, bronlicentie of echte besparingsclaim.
        </p>
      : <ol className="offline-readiness__steps">
          {steps.map(step => <li key={step.id}>
            <div><strong>{step.heading}</strong><p>{step.detail}</p></div>
            <div className="offline-readiness__step-actions">
              {step.onClick && step.action && <button type="button" onClick={step.onClick}>
                {step.action}
              </button>}
              {step.onSecondaryClick && step.secondaryAction && <button type="button"
                onClick={step.onSecondaryClick}>{step.secondaryAction}</button>}
            </div>
          </li>)}
        </ol>}
  </section>
}
