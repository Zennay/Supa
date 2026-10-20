import type { OneStoreBasket } from '../../domain/basket.ts'

/** A private sentinel distinguishes our own incomplete indexed array from
 * arbitrary exceptions thrown by untrusted caller-owned Proxy traps. */
export const INCOMPLETE_SHOPPING_EXPORT = Symbol('incomplete-shopping-export')

/**
 * A pasted/loaded basket is a runtime value, not a trustworthy TypeScript
 * instance. Copy only OWN DATA descriptors. Never enumerate user records or
 * iterate their arrays: those operations can invoke arbitrary getters.
 *
 * Exports are convenience purchase instructions, not retailer observations.
 * Price values copied here are inspected only by the existing copy validator;
 * the printable renderer never serializes or displays them.
 */
function ownData(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value : undefined
}

function hasOwnData(value: unknown, key: PropertyKey): boolean {
  if (value === null || typeof value !== 'object') return false
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return !!descriptor && Object.hasOwn(descriptor, 'value')
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const copied: Record<string, unknown> = Object.create(null)
  for (const field of fields) copied[field] = ownData(value, field)
  return copied
}

function denseOwnedArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Ongeldige boodschappenmand')
  // Own iterator overrides (including getter accessors) are not a trusted
  // canonical Array iterator. Never read or invoke the supplied iterator.
  if (Object.getOwnPropertyDescriptor(value, Symbol.iterator)) {
    throw INCOMPLETE_SHOPPING_EXPORT
  }
  const length = ownData(value, 'length')
  if (typeof length !== 'number' || !Number.isSafeInteger(length) ||
      length < 0 || length > 500) {
    throw new Error('Ongeldige boodschappenmand')
  }
  const rows: unknown[] = []
  for (let i = 0; i < length; i++) {
    if (!hasOwnData(value, String(i))) {
      throw INCOMPLETE_SHOPPING_EXPORT
    }
    rows.push(ownData(value, String(i)))
  }
  return rows
}

/**
 * Print and copy use the same inert trust snapshot: no persisted or UI state
 * is changed. A non-owned product fact becomes undefined and cannot approve
 * a matched physical pack instruction. Root and row-slot corruption refuses
 * the entire document rather than presenting an apparently complete list.
 */
export function snapshotShoppingExportBasket(input: unknown): OneStoreBasket {
  if (!hasOwnData(input, 'store') || !hasOwnData(input, 'lines')) {
    throw new Error('Ongeldige boodschappenmand')
  }
  const originalLines = denseOwnedArray(ownData(input, 'lines'))
  const lines = originalLines.map(value => {
    const copied = record(value, [
      'id', 'ingredientLabel', 'status', 'productName', 'productId',
      'packs', 'pricePerPackCents', 'lineTotalCents',
    ])
    if (!copied) throw new Error('Ongeldige boodschappenregel')
    // For missing, inherited or accessor-backed nested metadata, retain an
    // undefined value to trigger existing honest manual-review behavior.
    copied.requirement = record(ownData(value, 'requirement'), ['amount', 'unit'])
    copied.pack = record(ownData(value, 'pack'), ['amount', 'unit', 'count'])
    return copied
  })
  const snapshot = {
    store: record(ownData(input, 'store'), ['id', 'name']),
    lines,
    matchedLineCount: ownData(input, 'matchedLineCount'),
    unresolvedLineCount: ownData(input, 'unresolvedLineCount'),
  }
  // Snapshot is deliberately minimal. Downstream consumers are the existing
  // validators; neither trusts any missing TypeScript-only basket properties.
  return snapshot as unknown as OneStoreBasket
}

/** Saved checkmarks must be actual dense, owned string entries. */
export function snapshotShoppingExportDoneIds(input: unknown): readonly string[] {
  return denseOwnedArray(input).map(item => {
    if (typeof item !== 'string') throw new Error('Ongeldige afgevinkte boodschappenregel')
    return item
  })
}
