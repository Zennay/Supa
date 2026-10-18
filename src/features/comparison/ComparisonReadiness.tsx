import type { OneStoreBasket } from '../../domain/basket.ts'

type StoreId = 'PLUS' | 'DekaMarkt'

/**
 * An actionable guide for private, already-admitted local price observations.
 * Never treats a technically complete comparison as independent field proof.
 */
export function ComparisonReadiness({
  plus, deka, sourceFresh, pairedWithin24h, comparable,
  onOpenPlanner, onReviewMissing, onOpenImport,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  sourceFresh: boolean
  pairedWithin24h: boolean
  comparable: boolean
  onOpenPlanner?: () => void
  onReviewMissing: (store: StoreId, ingredientId: string) => void
  onOpenImport: () => void
}) {
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
    detail: 'Een of beide privébronopnames zijn ouder dan de toegestane 7 dagen, ' +
      'of hun tijdstempel ligt te ver in de toekomst.',
    action: 'Naar bronimport', onClick: onOpenImport,
  })
  if (!pairedWithin24h) steps.push({
    id: 'gap',
    heading: 'PLUS en DekaMarkt binnen 24 uur observeren',
    detail: 'De ingeladen brontijden liggen te ver uiteen voor een tijdsvergelijkbaar winkelmandje.',
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
