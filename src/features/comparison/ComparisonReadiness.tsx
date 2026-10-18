import type { OneStoreBasket } from '../../domain/basket.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'

type StoreId = 'PLUS' | 'DekaMarkt'

/**
 * An actionable guide for private, already-admitted local price observations.
 * Never treats a technically complete comparison as independent field proof.
 */
export function ComparisonReadiness({
  plus, deka, sourceFresh, pairedWithin24h, comparable,
  captures, nowMs, onOpenPlanner, onReviewMissing, onOpenImport,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  sourceFresh: boolean
  pairedWithin24h: boolean
  comparable: boolean
  captures: OfflinePriceSnapshots['captures']
  nowMs: number
  onOpenPlanner?: () => void
  onReviewMissing: (store: StoreId, ingredientId: string) => void
  onOpenImport: () => void
}) {
  const sources = (['PLUS', 'DekaMarkt'] as const).map(store => {
    const observation = captures[store]
    const ageMs = nowMs - observation.observedMs
    const olderThanWeek = ageMs > 7 * 24 * 60 * 60 * 1000
    const inFuture = ageMs < -5 * 60 * 1000
    const readableAge = inFuture ? 'in de toekomst'
      : ageMs < 0 ? 'zojuist (kleine klokafwijking)'
        : ageMs < 60 * 60 * 1000 ? Math.max(0, Math.floor(ageMs / 60000)) + ' minuten oud'
          : ageMs < 24 * 60 * 60 * 1000
            ? (ageMs / (60 * 60 * 1000)).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' uur oud'
            : (ageMs / (24 * 60 * 60 * 1000)).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' dagen oud'
    return { store, at: observation.observedAt, olderThanWeek, inFuture, readableAge }
  })
  // The imported pair is already canonical-admitted with nanosecond timestamps.
  // Show which source is older without altering its evidence timestamp.
  const plusInstant = captures.PLUS.observedNs
  const dekaInstant = captures.DekaMarkt.observedNs
  const refreshStore = plusInstant <= dekaInstant ? 'PLUS' : 'DekaMarkt'
  const observationGapHours = Number(plusInstant >= dekaInstant
    ? plusInstant - dekaInstant : dekaInstant - plusInstant) / 3_600_000_000_000
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
  const needsSource = !sourceFresh || !pairedWithin24h
  const isReady = comparable && hasDemand && !needsSource && incomplete.length === 0
  const steps: Array<{ id: string; heading: string; detail: string;
    action?: string; onClick?: () => void;
    secondaryAction?: string; onSecondaryClick?: () => void }> = []
  if (!hasDemand) steps.push({
    id: 'plan',
    heading: 'Kies je weekmenu',
    detail: 'Een leeg weekmenu is geen vergelijkbaar boodschappenmandje.',
    action: onOpenPlanner ? 'Open Planner' : undefined, onClick: onOpenPlanner,
  })
  if (!sourceFresh) steps.push({
    id: 'fresh',
    heading: 'Laad recente prijsopnames',
    detail: sources.filter(item => item.olderThanWeek || item.inFuture)
      .map(item => item.store + ': ' + (item.olderThanWeek ? 'ouder dan 7 dagen' : 'tijdstip in de toekomst'))
      .join('; ') || 'Een of beide bronmomenten vallen buiten het toegestane zeven-dagenvenster.',
    action: 'Naar bronimport', onClick: onOpenImport,
  })
  if (!pairedWithin24h) steps.push({
    id: 'gap',
    heading: 'PLUS en DekaMarkt binnen 24 uur observeren',
    detail: 'De bronmomenten verschillen ' + gapText + ' uur. ' + refreshStore +
      ' heeft het oudere bronmoment. Vernieuw die opname met eigen toegestane gegevens; ' +
      'alleen een echt binnen 24 uur geobserveerd paar mag een volledig verschil tonen.',
    action: 'Vervang de verouderde winkelopname', onClick: onOpenImport,
  })
  if (hasDemand) steps.push(...incomplete)
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
    {!pairedWithin24h && <p className="disclaimer">
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
