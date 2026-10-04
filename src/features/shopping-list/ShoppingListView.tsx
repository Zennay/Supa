import { useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket'

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${line.requirement.unit} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${line.pack.unit}`
}

export function ShoppingListView({ basket }: { basket: OneStoreBasket }) {
  const [done, setDone] = useState<string[]>([])

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">In de winkel</span>
          <h2>Boodschappenlijst</h2>
        </div>
      </div>

      {basket.unresolvedLineCount > 0 && (
        <div className="attention-card">
          <strong>{basket.unresolvedLineCount} productkeuze vraagt controle</strong>
          <span>SUPA vult een onzekere match niet automatisch in.</span>
        </div>
      )}

      <div className="list-card">
        {basket.lines.map((line) => {
          const checked = done.includes(line.id)
          const label =
            line.status === 'matched' ? line.productName : line.ingredientLabel

          return (
            <button
              className={
                line.status === 'unresolved'
                  ? checked
                    ? 'shopping-row checked unresolved-shopping'
                    : 'shopping-row unresolved-shopping'
                  : checked
                    ? 'shopping-row checked'
                    : 'shopping-row'
              }
              key={line.id}
              onClick={() =>
                setDone((current) =>
                  checked ? current.filter((id) => id !== line.id) : [...current, line.id],
                )
              }
            >
              <span className="check">{checked ? '✓' : ''}</span>
              <span>
                <strong>{label}</strong>
                <small>{shoppingQuantity(line)}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
