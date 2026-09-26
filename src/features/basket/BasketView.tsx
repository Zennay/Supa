import { basket } from '../../data/mock'
import { euro, savings } from '../../lib/money'
import { StatPill } from '../../components/StatPill'

export function BasketView() {
  const saved = savings(basket.baselineTotal, basket.total)

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Volledige mand</span>
          <h2>{basket.store.name}</h2>
        </div>
      </div>

      <div className="hero-total">
        <span>Geschat weektotaal</span>
        <strong>{euro.format(basket.total)}</strong>
        <div className="stat-row">
          <StatPill label="Baseline" value={euro.format(basket.baselineTotal)} />
          <StatPill label="Verschil" value={euro.format(saved)} />
        </div>
        <p className="disclaimer">Mockdata — geen echte besparingsclaim.</p>
      </div>

      <div className="list-card">
        {basket.lines.map((line) => (
          <div className="list-row" key={line.id}>
            <div>
              <strong>{line.label}</strong>
              <span>{line.quantity}</span>
            </div>
            <strong>{euro.format(line.price)}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}
