import { useMemo, useState } from 'react'
import type { StoreProduct } from '../../domain/basket.ts'
import type { MatchUnit } from '../../domain/matching.ts'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const collator = new Intl.Collator('nl-NL', { sensitivity: 'base', numeric: true })
const MAX_VISIBLE = 60

function unitFamily(unit: string): string {
  if (unit === 'g' || unit === 'kg') return 'massa'
  if (unit === 'ml' || unit === 'l') return 'volume'
  return unit === 'piece' ? 'stuks' : 'onbekend'
}

/**
 * Search only the user's admitted offline products. This picker does not infer
 * a price or convert an incompatible package into a valid ingredient match.
 */
export function LocalProductPicker({
  store, ingredient, requirementUnit, products, selected, onSelect,
}: {
  store: 'PLUS' | 'DekaMarkt'
  ingredient: string
  requirementUnit: MatchUnit
  products: StoreProduct[]
  selected: string
  onSelect: (productId: string) => void
}) {
  const [query, setQuery] = useState('')
  const compatible = useMemo(() => products.filter(product =>
    product.available && product.packAmount !== null && product.packAmount > 0 &&
    Number.isSafeInteger(product.priceCents) && product.priceCents >= 0 &&
    Number.isSafeInteger(product.packCount ?? 1) && (product.packCount ?? 1) > 0 &&
    unitFamily(product.packUnit) === unitFamily(requirementUnit),
  ).sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id)),
  [products, requirementUnit])

  const search = query.trim().normalize('NFKD').toLocaleLowerCase('nl-NL')
  const matching = compatible.filter(product =>
    !search || (product.name + ' ' + product.id)
      .normalize('NFKD').toLocaleLowerCase('nl-NL').includes(search))
  const visible = matching.slice(0, MAX_VISIBLE)
  const chosen = compatible.find(product => product.id === selected)
  if (chosen && !visible.some(product => product.id === chosen.id)) {
    visible.unshift(chosen)
  }

  return (
    <div className="offline-price-workbench__product-picker">
      <label>
        <span>Zoek in jouw {store}-producten voor {ingredient}</span>
        <input type="search" value={query} maxLength={100}
          placeholder="Zoek op productnaam of artikel-ID"
          onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="offline-price-workbench__manual-match">
        <span>Product handmatig beoordelen (alleen jouw geïmporteerde voorraad)</span>
        <select aria-label={`Handmatige productkeuze ${store} voor ${ingredient}`}
          value={selected} onChange={event => onSelect(event.target.value)}>
          <option value="">Automatische match / onbekend</option>
          <option value="!">Geen passend product — laat onbekend</option>
          {visible.map(product =>
            <option key={product.id} value={product.id}>
              {`${product.name} · ${product.packAmount} ${product.packUnit} × ${product.packCount ?? 1} · ${euros.format(product.priceCents / 100)}`}
            </option>)}
        </select>
      </label>
      <small role="status" aria-live="polite">
        {matching.length === 0
          ? 'Geen passende beschikbare verpakking in deze lokale opname.'
          : `${matching.length} geschikte producten${matching.length > MAX_VISIBLE
            ? ` · eerste ${MAX_VISIBLE} getoond; zoek gerichter` : ''}.`}
      </small>
    </div>
  )
}
