/**
 * Interpret only explicit, standard Schema.org QuantitativeValue pack fields.
 * No retailer-specific selectors, heuristics, price guesses or network.
 *
 * The core parser already accepts a "500 g" weight.value string. This adapter
 * may convert a bounded, unambiguous {value: 500, unitCode: "GRM"} or product
 * {size: {value: 1, unitCode: "LTR"}} to that same canonical input.
 */
import { normalizePackText } from './normalize.ts'

export type StructuredPackSelection =
  | { status: 'none' }
  | { status: 'normalized'; weightText: string }
  | { status: 'unsafe' }

const UNITS: Record<string, string> = {
  GRM: 'g',
  KGM: 'kg',
  MLT: 'ml',
  LTR: 'l',
  C62: 'st',
}

// Schema.org unitText is explicit free text rather than a UN/CEFACT code.
// Only these exact ordinary mass/volume/count words have an unambiguous
// physical interpretation. Promotions and retailer-specific labels abstain.
const UNIT_TEXT: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  st: 'st', stuk: 'st', stuks: 'st', piece: 'st', pieces: 'st',
}

function ownData(object: object, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, field)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new Error('untrusted accessor')
  return descriptor.value
}

function objectValue(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function decimalNumber(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/.test(text)) {
    return null
  }
  const number = Number(text)
  return Number.isFinite(number) && number > 0 &&
    number <= Number.MAX_SAFE_INTEGER ? text : null
}

function quantitative(value: unknown, position: 'weight' | 'size'):
  | { type: 'absent' }
  | { type: 'recognized'; value: string }
  | { type: 'unsafe' } {
  if (value === undefined || value === null) return { type: 'absent' }
  if (!objectValue(value)) {
    // Existing conservative parser still handles an explicit "500 g"
    // weight string. Unknown free-text size never becomes pack evidence.
    return { type: 'absent' }
  }
  const rawCode = ownData(value, 'unitCode')
  const rawText = ownData(value, 'unitText')
  if (rawCode === undefined && rawText === undefined) {
    return { type: 'absent' }
  }
  const coded = typeof rawCode === 'string' && Object.hasOwn(UNITS, rawCode)
    ? UNITS[rawCode] : null
  const written = typeof rawText === 'string' &&
    Object.hasOwn(UNIT_TEXT, rawText.trim().toLowerCase())
    ? UNIT_TEXT[rawText.trim().toLowerCase()] : null
  // Either explicit field being invalid is an error, even if another field
  // looks plausible. Two present fields must agree on a single physical unit.
  if ((rawCode !== undefined && coded === null) ||
      (rawText !== undefined && written === null) ||
      (coded !== null && written !== null && coded !== written)) {
    return { type: 'unsafe' }
  }
  const unit = coded ?? written
  if (unit === null ||
      (position === 'weight' && unit !== 'g' && unit !== 'kg')) {
    return { type: 'unsafe' }
  }
  const amount = decimalNumber(ownData(value, 'value'))
  if (amount === null) return { type: 'unsafe' }
  return { type: 'recognized', value: amount + ' ' + unit }
}

/** A text-only weight/size pair must independently agree on full pack size. */
function plainPhysicalQuantity(value: Record<string, unknown>):
  { weightText: string; dimension: string; amount: number } | null {
  const raw = ownData(value, 'value')
  if (typeof raw !== 'string') return null
  const pack = normalizePackText(raw)
  // The legacy observation type does not retain an explicit multipack count.
  // Never equate a multipack with a single physical pack.
  if (pack.amount === null || pack.unit === 'unknown' || pack.count !== 1) {
    return null
  }
  const multiplier = pack.unit === 'kg' || pack.unit === 'l' ? 1000 : 1
  const dimension = pack.unit === 'kg' || pack.unit === 'g' ? 'mass' :
    pack.unit === 'l' || pack.unit === 'ml' ? 'volume' :
    pack.unit === 'piece' ? 'piece' : null
  const amount = pack.amount * multiplier
  if (dimension === null || !Number.isSafeInteger(amount * 1_000_000)) return null
  return { weightText: pack.rawText ?? raw, dimension, amount }
}

/**
 * Reject contradictory simultaneous physical-size declarations rather than
 * silently preferring weight over size. Caller must preserve original product
 * input; this function neither mutates it nor asserts observed availability.
 */
export function structuredSchemaOrgPack(product: unknown): StructuredPackSelection {
  try {
    if (!objectValue(product)) return { status: 'unsafe' }
    const weight = ownData(product, 'weight')
    const size = ownData(product, 'size')
    // Two plain QuantitativeValue.value strings (without unitText/unitCode)
    // previously escaped structured validation and let the legacy parser
    // pick weight while silently ignoring a conflicting explicit size.
    // Only a corroborated, single physical package is trustworthy.
    if (objectValue(weight) && objectValue(size) &&
        ownData(weight, 'unitCode') === undefined &&
        ownData(weight, 'unitText') === undefined &&
        ownData(size, 'unitCode') === undefined &&
        ownData(size, 'unitText') === undefined) {
      const first = plainPhysicalQuantity(weight)
      const second = plainPhysicalQuantity(size)
      if (!first || !second || first.dimension !== second.dimension ||
          first.amount !== second.amount) return { status: 'unsafe' }
      return { status: 'normalized', weightText: first.weightText }
    }
    const parsedWeight = quantitative(weight, 'weight')
    const parsedSize = quantitative(size, 'size')
    if (parsedWeight.type === 'unsafe' || parsedSize.type === 'unsafe') {
      return { status: 'unsafe' }
    }
    if (parsedWeight.type === 'recognized' && size !== undefined &&
        size !== null) {
      return { status: 'unsafe' }
    }
    if (parsedSize.type === 'recognized' && weight !== undefined &&
        weight !== null) {
      return { status: 'unsafe' }
    }
    if (parsedWeight.type === 'recognized') {
      return { status: 'normalized', weightText: parsedWeight.value }
    }
    if (parsedSize.type === 'recognized') {
      return { status: 'normalized', weightText: parsedSize.value }
    }
    return { status: 'none' }
  } catch {
    return { status: 'unsafe' }
  }
}
