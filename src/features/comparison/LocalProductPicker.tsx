import { useMemo, useState } from 'react'
import type { StoreProduct } from '../../domain/basket.ts'
import type { MatchUnit } from '../../domain/matching.ts'
import { privatePackUnitRate } from './privateUnitPrice.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const collator = new Intl.Collator('nl-NL', { sensitivity: 'base', numeric: true })
const MAX_VISIBLE = 60

function unitFamily(unit: string): string {
  if (unit === 'g' || unit === 'kg') return 'massa'
  if (unit === 'ml' || unit === 'l') return 'volume'
  return unit === 'piece' ? 'stuks' : 'onbekend'
}

// Only an ordering hint for the user's manual review. Never auto-select by
// this hint; the canonical domain matcher alone decides automatic matches.
function textWords(value: string): string[] {
  return value.normalize('NFD').toLocaleLowerCase('nl-NL')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/u)
    .filter(word => word.length > 1 && !['de', 'het', 'een', 'van', 'voor', 'pak', 'fles'].includes(word))
}
function labelRelevance(ingredient: string, productName: string): number {
  const words = textWords(ingredient)
  if (!words.length) return 0
  const candidate = new Set(textWords(productName))
  return words.reduce((score, word) => score + (candidate.has(word) ? 1 : 0), 0)
}

/**
 * Search only the user's admitted offline products. This picker does not infer
 * a price or convert an incompatible package into a valid ingredient match.
 */
export function LocalProductPicker({
  store, ingredient, requirementUnit, requirementAmount = null, products, selected, onSelect,
}: {
  store: 'PLUS' | 'DekaMarkt'
  ingredient: string
  requirementUnit: MatchUnit
  requirementAmount?: number | null
  products: StoreProduct[]
  selected: string
  onSelect: (productId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'relevance' | 'unit' | 'pack' | 'need'>('relevance')
  function unitRate(product: StoreProduct) {
    return privatePackUnitRate({
      amount: product.packAmount, unit: product.packUnit,
      count: product.packCount ?? 1, priceCents: product.priceCents,
    })
  }
  function unitRateLabel(product: StoreProduct) {
    const rate = unitRate(product)
    return rate ? euros.format(rate.centsPerUnit / 100) + ' / ' + rate.unit
      : 'eenheidsprijs onbekend'
  }
  function ingredientCost(product: StoreProduct) {
    if (requirementAmount === null || !Number.isFinite(requirementAmount) ||
        requirementAmount <= 0 || product.packAmount === null ||
        !product.available || !Number.isSafeInteger(product.priceCents)) return null
    const packs = calculateDecimalPackCount(
      [{ amount: requirementAmount, unit: requirementUnit }],
      { amount: product.packAmount, unit: product.packUnit, count: product.packCount ?? 1 },
    )
    const totalCents = packs === null ? null : packs * product.priceCents
    return packs !== null && totalCents !== null && Number.isSafeInteger(totalCents)
      ? { packs, totalCents } : null
  }
  function ingredientCostLabel(product: StoreProduct) {
    const cost = ingredientCost(product)
    return cost ? cost.packs + ' verpakkingen: ' + euros.format(cost.totalCents / 100)
      : 'ingrediëntkosten onbekend'
  }
  const compatible = useMemo(() => products.filter(product =>
    product.available && product.packAmount !== null && product.packAmount > 0 &&
    Number.isSafeInteger(product.priceCents) && product.priceCents >= 0 &&
    Number.isSafeInteger(product.packCount ?? 1) && (product.packCount ?? 1) > 0 &&
    unitFamily(product.packUnit) === unitFamily(requirementUnit),
  ).sort((a, b) =>
    labelRelevance(ingredient, b.name) - labelRelevance(ingredient, a.name) ||
    collator.compare(a.name, b.name) || collator.compare(a.id, b.id)),
  [products, requirementUnit, ingredient])

  const search = query.trim().normalize('NFKD').toLocaleLowerCase('nl-NL')
  const matching = compatible.filter(product =>
    !search || (product.name + ' ' + product.id)
      .normalize('NFKD').toLocaleLowerCase('nl-NL').includes(search))
  if (sort !== 'relevance') matching.sort((a, b) => {
    // Physical unit prices are display-only; no automatic retailer choice.
    const aCost = sort === 'unit' ? unitRate(a)?.centsPerUnit :
      sort === 'need' ? ingredientCost(a)?.totalCents : a.priceCents
    const bCost = sort === 'unit' ? unitRate(b)?.centsPerUnit :
      sort === 'need' ? ingredientCost(b)?.totalCents : b.priceCents
    return (aCost ?? Number.POSITIVE_INFINITY) -
      (bCost ?? Number.POSITIVE_INFINITY) ||
      collator.compare(a.name, b.name) || collator.compare(a.id, b.id)
  })
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
      <label>
        <span>Sorteer producten bij {store}</span>
        <select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
          <option value="relevance">Beste overeenkomst met ingrediënt</option>
          <option value="unit">Laagste eenheidsprijs (kg, liter of stuk)</option>
          <option value="pack">Laagste prijs per verpakking</option>
          <option value="need" disabled={requirementAmount === null || requirementAmount <= 0}>Laagste kosten voor benodigde hoeveelheid</option>
        </select>
      </label>
      <small>Eenheidsprijzen gebruiken jouw gemeten verpakking, multipack en centprijs.
        De laagste prijs per kg of liter is niet noodzakelijk de goedkoopste
        volledige winkeltrip. Controleer zelf het product; niets wordt automatisch gekozen.</small>
      <label className="offline-price-workbench__manual-match">
        <span>Product handmatig beoordelen (alleen jouw geïmporteerde voorraad)</span>
        <select aria-label={`Handmatige productkeuze ${store} voor ${ingredient}`}
          value={selected} onChange={event => onSelect(event.target.value)}>
          <option value="">Automatische match / onbekend</option>
          <option value="!">Geen passend product — laat onbekend</option>
          {visible.map(product =>
            <option key={product.id} value={product.id}>
              {`${product.name} · ${product.packAmount} ${product.packUnit} × ${product.packCount ?? 1} · ${euros.format(product.priceCents / 100)} · ${unitRateLabel(product)} · ${ingredientCostLabel(product)}`}
            </option>)}
        </select>
      </label>
      {chosen && <p role="status">
        Zelf gekozen: {chosen.name} · {ingredientCostLabel(chosen)} uit jouw
        eigen winkelopname. Pas na de productkeuze herberekent Supa het weekmandje.
      </p>}
      <small role="status" aria-live="polite">
        {matching.length === 0
          ? 'Geen passende beschikbare verpakking in deze lokale opname.'
          : `${matching.length} geschikte producten${matching.length > MAX_VISIBLE
            ? ` · eerste ${MAX_VISIBLE} getoond; zoek gerichter` : ''}.`}
      </small>
    </div>
  )
}
