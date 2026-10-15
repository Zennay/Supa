/**
 * Interpret only explicit, standard Schema.org QuantitativeValue pack fields.
 * No retailer-specific selectors, heuristics, price guesses or network.
 *
 * The core parser already accepts a "500 g" weight.value string. This adapter
 * may convert a bounded, unambiguous {value: 500, unitCode: "GRM"} or product
 * {size: {value: 1, unitCode: "LTR"}} to that same canonical input.
 */
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
