import { FigmaImage } from '../../components/FigmaImage'
import { supermarkets, readSelectedStores } from '../home/selectedStores'
import { ingredientImage } from '../planner/ingredientImages'
import './hifiShoppingList.css'
import { useEffect, useMemo, useState } from 'react'
import type { OneStoreBasket, RecipeWithIngredients } from '../../domain/basket'
import type { PlannedMeal } from '../../domain/types'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation'
import { euro } from '../../lib/money'
import {
  restoreShoppingListProgress,
  restorePhysicalShoppingProgress,
  serializePhysicalShoppingProgress,
  shoppingListPhysicalBasketKey,
  shoppingListPhysicalProgressStorageKey,
  shoppingListProgressStorageKey,
} from './shoppingListProgress'

// An empty checklist is trustworthy only when its store identity is readable.
// This guards the empty-state message, not ordinary populated product rows.
const invisibleStoreFillers = /[\u115F\u1160\u3164\uFFA0\u2800]/gu

function visibleStoreIdentity(value: unknown): boolean {
  return typeof value === 'string' &&
    value === value.trim() &&
    /[\p{L}\p{N}]/u.test(value.replace(invisibleStoreFillers, ''))
}

function visibleStoreName(value: unknown): boolean {
  return typeof value === 'string' &&
    /[\p{L}\p{N}\p{S}]/u.test(value.replace(invisibleStoreFillers, ''))
}

/**
 * Presentation-only view projection: leave the user's basket order, amounts,
 * copied/printed full list and persisted v1 checked IDs untouched.
 * Kept with this component to preserve the original v1 runtime import contract.
 */
export function shoppingVisibleLines(
  lines: readonly OneStoreBasket['lines'][number][],
  doneLineIds: readonly string[],
  openOnly: boolean,
): OneStoreBasket['lines'][number][] {
  if (!Array.isArray(lines) || !Array.isArray(doneLineIds)) return []
  if (!openOnly) return [...lines]
  const checkedIds = new Set(doneLineIds.filter((id) => typeof id === 'string'))
  return lines.filter((line) => !checkedIds.has(line.id))
}

function shoppingQuantity(line: OneStoreBasket['lines'][number]) {
  if (line.status === 'unresolved') {
    return `${line.requirement.amount ?? '?'} ${quantityUnitLabelNl(line.requirement.unit, line.requirement.amount)} · handmatig kiezen`
  }

  const packPrefix = line.pack.count > 1 ? `${line.pack.count} × ` : ''
  return `${line.packs} × ${packPrefix}${line.pack.amount} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`
}

function readStoredProgress(basket: OneStoreBasket) {
  if (typeof window === 'undefined') return { done: [], readDenied: false }

  try {
    return {
      // An existing v2 record takes precedence. Migrate legacy v1 checkmarks
      // only when its original price-sensitive basket key still matches exactly.
      // Never rewrite, reinterpret or delete unknown/future v1 bytes.
      done: (() => {
        const v2 = window.localStorage.getItem(shoppingListPhysicalProgressStorageKey)
        return v2 !== null
          ? restorePhysicalShoppingProgress(basket, v2)
          : restoreShoppingListProgress(basket,
              window.localStorage.getItem(shoppingListProgressStorageKey))
      })(),
      readDenied: false,
    }
  } catch {
    // A denied initial read must not be mistaken for proof of an empty key.
    return { done: [], readDenied: true }
  }
}

// A v2 client must not destroy unsupported, newer or unreadable persisted state.
// Refuse writes until the key is absent or a strictly recognized v2 snapshot.
function canOverwriteStoredProgress(raw: string | null): boolean {
  if (raw === null) return true
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return (
      record.schemaVersion === 2 &&
      typeof record.physicalBasketKey === 'string' &&
      record.physicalBasketKey.length > 0 &&
      Array.isArray(record.doneLineIds) &&
      record.doneLineIds.every((id: unknown) => typeof id === 'string') &&
      Object.keys(record).every((key) =>
        key === 'schemaVersion' || key === 'physicalBasketKey' || key === 'doneLineIds'
      )
    )
  } catch {
    return false
  }
}

const categoryRules: [RegExp, string][] = [
  [/kokos|currypasta|saus|bao/i, 'Droogwaren & sauzen'],
  [/broccoli|avocado|komkommer|spinazie|paprika|knoflook|mais|tomaat|courgette|\bui\b|\bsla\b|groente|gember|edamame/i, 'Groente'],
  [/\bkip|gehakt|worst|zalm|\bvis\b|tonijn|\bham\b|spek/i, 'Vlees & vis'],
  [/melk|kaas|yoghurt|yogurt|\broom\b|kwark|boter|\beieren\b|\bei\b/i, 'Zuivel & eieren'],
  [/rijst|pasta|spaghetti|noodle|bonen|linzen|meel|brood|tortilla|wrap|panko/i, 'Droogwaren & sauzen'],
]

function shoppingCategory(label: string): string {
  for (const [pattern, title] of categoryRules) if (pattern.test(label)) return title
  return 'Overig'
}

/** Groups the visible lines by product category, in the design's order. */
function shoppingCategoryGroups<T extends { status: string; productName?: string; ingredientLabel: string }>(
  lines: readonly T[],
): { title: string; lines: T[] }[] {
  const order = ['Groente', 'Vlees & vis', 'Zuivel & eieren', 'Droogwaren & sauzen', 'Overig']
  const byTitle = new Map<string, T[]>()
  for (const line of lines) {
    const label = line.status === 'matched' && line.productName ? line.productName : line.ingredientLabel
    const title = shoppingCategory(label)
    byTitle.set(title, [...(byTitle.get(title) ?? []), line])
  }
  return order.filter(title => byTitle.has(title)).map(title => ({ title, lines: byTitle.get(title)! }))
}

export type ChosenProduct = { id: string; name: string; image: string; logo: string; unit: string; price: string }

export function ShoppingListView({ basket, plan, recipes, activeDays, chosenProducts = [], onRemoveProduct }: {
  /** Products added with + in Producten. */
  chosenProducts?: ChosenProduct[]
  onRemoveProduct?: (id: string) => void
  basket: OneStoreBasket
  plan?: PlannedMeal[]
  recipes?: RecipeWithIngredients[]
  activeDays?: string[]
}) {
  const basketKey = useMemo(() => {
    try {
      return shoppingListPhysicalBasketKey(basket)
    } catch {
      // A damaged basket is not a new empty shopping plan. Never show or
      // persist checkmarks under a fabricated identity.
      return null
    }
  }, [basket])
  const [progress, setProgress] = useState(() => ({
    basketKey,
    ...(basketKey === null
      ? { done: [], readDenied: false }
      : readStoredProgress(basket)),
    dirty: false,
    retryAfterFailure: false,
  }))
  const [storageWarning, setStorageWarning] = useState<'protected' | 'unavailable' | null>(null)
  const done = progress.basketKey === basketKey ? progress.done : []
  // Presentation filter only. Keep the full physical basket and stored ticks intact.
  const [openOnly, setOpenOnly] = useState(false)
  const visibleLines = basketKey === null
    ? []
    : shoppingVisibleLines(basket.lines, done, openOnly)


  // A genuinely empty plan has no shopping tasks. An empty row array with
  // inconsistent counters is not proof that the customer needs nothing.
  const genuinelyEmpty = (() => {
    if (basketKey === null) return false
    try {
      return basket.lines.length === 0 &&
        basket.selectedMealCount === 0 &&
        basket.matchedLineCount === 0 &&
        basket.unresolvedLineCount === 0 &&
        basket.totalCents === 0 &&
        visibleStoreIdentity(basket.store?.id) &&
        visibleStoreName(basket.store?.name)
    } catch {
      return false
    }
  })()

  useEffect(() => {
    if (progress.basketKey === basketKey) return

    setProgress({
      basketKey,
      ...(basketKey === null
        ? { done: [], readDenied: false }
        : readStoredProgress(basket)),
      dirty: false,
      retryAfterFailure: false,
    })
  }, [basket, basketKey, progress.basketKey])

  useEffect(() => {
    if (typeof window === 'undefined' || basketKey === null || progress.basketKey !== basketKey) return
    // Never persist a malformed zero-row basket just because it is visible.
    if (basket.lines.length === 0 && !genuinelyEmpty) return

    // A failed read or write is not an authorization to retry automatically.
    if ((progress.readDenied || progress.retryAfterFailure) && !progress.dirty) {
      if (!progress.retryAfterFailure) setStorageWarning('unavailable')
      return
    }

    try {
      const stored = window.localStorage.getItem(shoppingListPhysicalProgressStorageKey)
      // If the initial read was denied, later-readable existing bytes might
      // contain previously checked rows. Refuse to replace them with [].
      if ((progress.readDenied && stored !== null) ||
          !canOverwriteStoredProgress(stored)) {
        setProgress((current) => current === progress
          ? { ...current, dirty: false, retryAfterFailure: true }
          : current)
        setStorageWarning('protected')
        return
      }

      const serialized = serializePhysicalShoppingProgress(basket, progress.done)
      if (stored !== serialized) {
        window.localStorage.setItem(shoppingListPhysicalProgressStorageKey, serialized)
      }
      if (progress.readDenied || progress.retryAfterFailure) {
        setProgress((current) => current === progress
          ? { ...current, readDenied: false, dirty: false, retryAfterFailure: false }
          : current)
      }
      setStorageWarning(null)
    } catch {
      // A future passive rerender or permission recovery must not silently
      // retry an already-failed save and falsely suggest persistent progress.
      setProgress((current) => current === progress
        ? { ...current, dirty: false, retryAfterFailure: true }
        : current)
      setStorageWarning('unavailable')
    }
  }, [basket, basketKey, genuinelyEmpty, progress])

  if (basketKey === null) {
    return (
      <section className="screen hifi-shopping-screen" data-figma-node="3342:4815">
        <div className="section-heading">
          <div>
            <h2>Boodschappenlijst</h2>
          </div>
        </div>
        <p className="disclaimer" role="status">
          Boodschappenlijst niet beschikbaar. Controleer je planning.
        </p>
        <p className="disclaimer" role="status">
          Afdrukken is niet beschikbaar. Controleer eerst je boodschappenlijst.
        </p>
      </section>
    )
  }

  const groups = shoppingCategoryGroups(visibleLines)
  const chosenStores = supermarkets.filter(store => readSelectedStores().includes(store.id))
  const logo = chosenStores[0]?.logo ?? null

  return (
    <section className="screen hifi-shopping-screen" data-figma-node="3342:4815">
      <header className="hifi-list-heading">
        <h2>Boodschappenlijst</h2>
      </header>

      <div className="hifi-list-stores" aria-label="Winkel van deze lijst">
        {chosenStores.map(store => (
          <span className="hifi-list-store-chip selected" key={store.id}>
            <FigmaImage asset={store.logo} alt="" />
            {store.name}
          </span>
        ))}
      </div>

      {storageWarning && (
        <p role="alert" className="disclaimer">
          {storageWarning === 'protected'
            ? 'Afvinken is tijdelijk en niet opgeslagen. Je eerdere opgeslagen gegevens blijven bewaard.'
            : 'Afvinken is tijdelijk en niet opgeslagen omdat opslag niet beschikbaar is. Eventuele eerdere opgeslagen gegevens blijven bewaard.'}
        </p>
      )}

      {basket.lines.length === 0 && (
        <p className="disclaimer" role="status">
          {genuinelyEmpty
            ? 'Geen boodschappen voor deze planning. Voeg een maaltijd toe in Planner.'
            : 'Boodschappenlijst niet beschikbaar. Controleer je planning.'}
        </p>
      )}

      {groups.map(group => (
        <section className="hifi-list-group" key={group.title} aria-label={group.title}>
          <div className="hifi-list-group-heading">
            <h3>{group.title}</h3>
            <span className="hifi-list-count">{group.lines.length} {group.lines.length === 1 ? "item" : "items"}</span>
          </div>
          <div className="hifi-list-card">
            {group.lines.map(line => {
              const checked = done.includes(line.id)
              const label = line.status === 'matched' ? line.productName : line.ingredientLabel
              return (
                <button
                  key={line.id}
                  type="button"
                  aria-pressed={checked}
                  className={`hifi-list-row${checked ? ' checked' : ''}${line.status === 'unresolved' ? ' unresolved' : ''}`}
                  onClick={() =>
                    setProgress((current) => {
                      const currentDone = current.basketKey === basketKey ? current.done : []
                      return {
                        ...current,
                        basketKey,
                        dirty: true,
                        done: currentDone.includes(line.id)
                          ? currentDone.filter((id) => id !== line.id)
                          : [...currentDone, line.id],
                      }
                    })
                  }
                >
                  <span className="hifi-list-radio" aria-hidden="true">{checked ? '✓' : ''}</span>
                  <span className="hifi-list-thumb"><FigmaImage asset={ingredientImage(label)} alt="" /></span>
                  <span className="hifi-list-detail">
                    <strong>{label}</strong>
                    <small>{shoppingQuantity(line)}</small>
                  </span>
                  <span className="hifi-list-price" aria-label={line.status === 'matched' ? `Voorbeeldprijs ${euro.formatCents(line.lineTotalCents)}` : 'Prijs nog onbekend'}>
                    {logo && line.status === 'matched' && <FigmaImage asset={logo} alt="" />}
                    {line.status === 'matched' ? euro.formatCents(line.lineTotalCents) : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {chosenProducts.length > 0 && (
        <section className="hifi-list-group" aria-label="Producten">
          <div className="hifi-list-group-heading">
            <h3>Producten</h3>
            <span className="hifi-list-count">{chosenProducts.length} {chosenProducts.length === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="hifi-list-card">
            {chosenProducts.map(product => (
              <div className="hifi-list-row" key={product.id}>
                <button type="button" className="hifi-list-radio hifi-list-remove" aria-label={`Verwijder ${product.name}`} onClick={() => onRemoveProduct?.(product.id)}>×</button>
                <span className="hifi-list-thumb"><FigmaImage asset={product.image} alt="" /></span>
                <span className="hifi-list-detail"><strong>{product.name}</strong><small>{product.unit}</small></span>
                <span className="hifi-list-price">
                  {product.logo && <FigmaImage asset={product.logo} alt="" />}
                  {product.price}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {basket.lines.length > 0 && (
        <section className="hifi-list-total" aria-label="Overzicht boodschappen">
          <div>
            <span>{basket.unresolvedLineCount > 0 ? 'Bekend minimum' : 'Totaal'}</span>
            <strong>{euro.formatCents(basket.totalCents)}</strong>
          </div>
          {basket.unresolvedLineCount > 0 && (
            <small>{basket.unresolvedLineCount} productkeuzes zijn nog niet meegeteld.</small>
          )}
        </section>
      )}
    </section>
  )
}
