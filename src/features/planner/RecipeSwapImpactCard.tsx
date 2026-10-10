import type { PlanRecipeSwapPreview } from '../../domain/planRecipeSwapPreview'
import './recipeSwapImpactCard.css'

const euros = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

function summarizeLine(
  line: NonNullable<Extract<PlanRecipeSwapPreview, { status: 'ready' | 'unknown' }>['changes'][number]['before']>,
): string {
  if (line.status === 'unresolved') return 'Productkeuze nog niet bekend'
  return `${line.packs} × ${line.productName}`
}

/** Read-only preview: the customer explicitly applies the recipe change elsewhere. */
export function RecipeSwapImpactCard({ preview }: { preview: PlanRecipeSwapPreview }) {
  if (preview.status === 'invalid') {
    return (
      <section className="supa-swap-preview" aria-label="Voorvertoning receptwijziging">
        <h3>Voorvertoning niet beschikbaar</h3>
        <p>Controleer je planning of gekozen recept voordat je wisselt.</p>
      </section>
    )
  }

  return (
    <section
      className="supa-swap-preview"
      aria-label="Voorvertoning receptwijziging"
      aria-live="polite"
      aria-atomic="true"
    >
      <h3>Als je dit recept kiest</h3>
      {preview.status === 'ready' ? (
        <p className="supa-swap-preview__total" data-price-state="known">
          {preview.deltaCents === 0
            ? 'Het berekende mandtotaal blijft gelijk.'
            : `Het berekende mandtotaal wordt ${euros.format(Math.abs(preview.deltaCents!) / 100)} ${preview.deltaCents! > 0 ? 'hoger' : 'lager'}.`}
        </p>
      ) : (
        <p className="supa-swap-preview__total" data-price-state="unknown">
          Het prijsverschil is nog niet betrouwbaar te berekenen. Controleer onbekende producten.
        </p>
      )}
      {preview.changes.length === 0 ? (
        <p>Geen verandering in de benodigdheden van je actieve week.</p>
      ) : (
        <ul className="supa-swap-preview__changes">
          {preview.changes.map((change) => (
            <li key={change.ingredientId}>
              <strong>{change.after?.ingredientLabel ?? change.before?.ingredientLabel}</strong>
              <span>{change.before ? summarizeLine(change.before) : 'Niet nodig'}</span>
              <span aria-hidden="true">→</span>
              <span>{change.after ? summarizeLine(change.after) : 'Niet meer nodig'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="supa-swap-preview__disclaimer">
        Berekening met de aangeleverde catalogusprijzen. Geen actuele winkelprijs of bewezen besparing.
        Je planning en afgevinkte boodschappen veranderen pas nadat je de keuze bevestigt.
      </p>
    </section>
  )
}
