import { useState } from 'react'
import { basket } from '../../data/mock'

export function ShoppingListView() {
  const [done, setDone] = useState<string[]>([])

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">In de winkel</span>
          <h2>Boodschappenlijst</h2>
        </div>
      </div>

      <div className="list-card">
        {basket.lines.map((line) => {
          const checked = done.includes(line.id)
          return (
            <button
              className={checked ? 'shopping-row checked' : 'shopping-row'}
              key={line.id}
              onClick={() =>
                setDone((current) =>
                  checked ? current.filter((id) => id !== line.id) : [...current, line.id],
                )
              }
            >
              <span className="check">{checked ? '✓' : ''}</span>
              <span>
                <strong>{line.label}</strong>
                <small>{line.quantity}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
