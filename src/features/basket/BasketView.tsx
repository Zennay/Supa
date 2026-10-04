import type { OneStoreBasket } from '../../domain/basket'
import { euro } from '../../lib/money'
import { StatPill } from '../../components/StatPill'

function quantity(amount: number | null, unit: string) {
  return amount === null ? `? ${unit}` : `${amount} ${unit}`
}

export function BasketView({ basket }: { basket: OneStoreBasket }) {
  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Eén-store mand</span>
          <h2>{basket.store.name}</h2>
        </div>
      </div>

      <div className="hero-total">
        <span>Deterministisch mandtotaal</span>
        <strong>{euro.format(basket.totalCents / 100)}</strong>
        <div className="stat-row">
          <StatPill label="Gematcht" value={String(basket.matchedLineCount)} />
          <StatPill label="Controle" value={String(basket.unresolvedLineCount)} />
        </div>
        <p className="disclaimer">
          M2 testfixture — geen besparingsclaim en geen productie-liveprijs.
        </p>
      </div>

      <div className="list-card">
        {basket.lines.map((line) => (
          <div
            className={line.status === 'matched' ? 'list-row trace-row' : 'list-row trace-row unresolved-row'}
            key={line.id}
          >
            <div>
              <strong>{line.ingredientLabel}</strong>
              <span>Benodigd: {quantity(line.requirement.amount, line.requirement.unit)}</span>
              {line.status === 'matched' ? (
                <>
                  <span>
                    → {line.productName} · {line.packs} verpakking{line.packs === 1 ? '' : 'en'}
                  </span>
                  <small className="trace-note">
                    Match {line.matchScore} · {line.reasons.join(' · ')}
                  </small>
                </>
              ) : (
                <small className="trace-note">
                  Controle nodig · {line.reasons.join(' · ')}
                </small>
              )}
            </div>
            <strong>
              {line.status === 'matched'
                ? euro.format(line.lineTotalCents / 100)
                : '—'}
            </strong>
          </div>
        ))}
      </div>
    </section>
  )
}
