import type { OneStoreBasket } from '../../domain/basket.ts'
import { preparePrintableShoppingChecklist } from './printableShoppingChecklist.ts'
import './PrintableShoppingChecklist.css'

/**
 * Opt-in paper checklist for integration by the shopping-list owner.
 * Never persists, uploads, guesses unavailable products or prints prices.
 */
export function PrintableShoppingChecklist({ basket }: { basket: OneStoreBasket }) {
  const printable = preparePrintableShoppingChecklist(basket)

  return (
    <section className="supa-printable-shopping" aria-label="Papieren boodschappenlijst">
      <button
        type="button"
        className="supa-printable-shopping__action"
        onClick={() => {
          if (typeof window !== 'undefined') window.print()
        }}
      >
        Print boodschappenlijst
      </button>
      <div className="supa-printable-shopping__paper">
        <h2>Boodschappenlijst</h2>
        <p>
          Winkel: {printable.storeLabel}
          {printable.isDemo ? ' · voorbeeldgegevens' : ''}
        </p>
        <p>Controleer producten en hoeveelheden zelf in de winkel. Geen liveprijzen of besparingsbewijs.</p>
        {printable.reviewCount > 0 && (
          <p role="note">
            {printable.reviewCount} productkeuze{printable.reviewCount === 1 ? '' : 's'} nog handmatig controleren.
          </p>
        )}
        {printable.lines.length === 0 ? (
          <p>Er staan geen boodschappen op deze lijst.</p>
        ) : (
          <ol className="supa-printable-shopping__rows">
            {printable.lines.map((line) => (
              <li key={line.id}>
                <span aria-hidden="true">☐</span>
                <div>
                  <strong>{line.label}</strong>
                  <small>{line.quantity}</small>
                  {line.needsReview && <em>Product nog te kiezen</em>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
