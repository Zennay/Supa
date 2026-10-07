import type { PackUnit, RawPack } from './ingestion'

const UNIT_ALIASES: Record<string, PackUnit> = {
  g: 'g',
  gram: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  liter: 'l',
  st: 'piece',
  stuk: 'piece',
  stuks: 'piece',
}

function decimal(value: string): number {
  return Number(value.replace(',', '.'))
}

function isSafePositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

function isTextWithinMaxSafeNumber(value: string): boolean {
  const normalized = value.replace(',', '.')
  const [wholeText, fractionText = ''] = normalized.split('.')
  const canonicalWhole = wholeText.replace(/^0+(?=\d)/, '')
  const maxSafeText = String(Number.MAX_SAFE_INTEGER)

  if (canonicalWhole.length !== maxSafeText.length) {
    return canonicalWhole.length < maxSafeText.length
  }

  if (canonicalWhole !== maxSafeText) {
    return canonicalWhole < maxSafeText
  }

  return fractionText === '' || /^0+$/.test(fractionText)
}

export function normalizeMoneyToCents(input: unknown): number | null {
  if (typeof input !== 'string') return null

  const cleaned = input.trim().replace(/^€\s*/, '')

  if (!cleaned || /\s/.test(cleaned)) {
    return null
  }

  let normalized: string
  if (cleaned.includes(',')) {
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/.test(cleaned)) {
      return null
    }

    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
      return null
    }

    normalized = cleaned
  }

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 1e-6
    ? cents
    : null
}

export type NormalizedPack = RawPack & {
  count: number
}

export function normalizePackText(input: unknown): NormalizedPack {
  const rawText = typeof input === 'string' ? input.trim() || null : null

  if (!rawText) {
    return { rawText, count: 1, amount: null, unit: 'unknown' }
  }

  const cleaned = rawText
    .toLowerCase()
    .replace(/^per\s+(pak|fles|doos|zak)\s+/i, '')
    .trim()

  const multipack = cleaned.match(
    /^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gram|l|liter|ml|st|stuk|stuks)(?:\s+\((?:ca\.\s*)?\d+\s*(?:st|stuk|stuks)\))?$/,
  )

  if (multipack) {
    const count = Number(multipack[1])
    const amount = decimal(multipack[2])
    if (
      Number.isSafeInteger(count) &&
      count > 0 &&
      isTextWithinMaxSafeNumber(multipack[2]) &&
      isSafePositiveNumber(amount)
    ) {
      return {
        rawText,
        count,
        amount,
        unit: UNIT_ALIASES[multipack[3]],
      }
    }

    return { rawText, count: 1, amount: null, unit: 'unknown' }
  }

  const single = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*(kg|g|gram|l|liter|ml|st|stuk|stuks)(?:\s+\((?:ca\.\s*)?\d+\s*(?:st|stuk|stuks)\))?$/,
  )

  if (single) {
    const amount = decimal(single[1])
    if (
      isTextWithinMaxSafeNumber(single[1]) &&
      isSafePositiveNumber(amount)
    ) {
      return {
        rawText,
        count: 1,
        amount,
        unit: UNIT_ALIASES[single[2]],
      }
    }

    return { rawText, count: 1, amount: null, unit: 'unknown' }
  }

  return { rawText, count: 1, amount: null, unit: 'unknown' }
}

export type NormalizedOfferMechanic =
  | { type: 'buy_x_get_y_free'; buy: number; free: number }
  | { type: 'quantity_for_price'; quantity: number; totalPriceCents: number }
  | { type: 'percent_discount'; percent: number }
  | { type: 'fixed_price'; priceCents: number }
  | { type: 'second_half_price' }
  | { type: 'unknown'; rawLabel: string }

export function normalizeOfferLabel(label: unknown): NormalizedOfferMechanic {
  if (typeof label !== 'string') {
    return { type: 'unknown', rawLabel: '' }
  }

  const rawLabel = label.trim()
  const cleaned = rawLabel.toLowerCase().replace(/\s+/g, ' ')

  const buyFree = cleaned.match(/^(\d+)\s*\+\s*(\d+)\s+gratis$/)
  if (buyFree) {
    const buy = Number(buyFree[1])
    const free = Number(buyFree[2])
    if (
      Number.isSafeInteger(buy) &&
      buy > 0 &&
      Number.isSafeInteger(free) &&
      free > 0
    ) {
      return {
        type: 'buy_x_get_y_free',
        buy,
        free,
      }
    }
  }

  const quantityForPrice = cleaned.match(
    /^(\d+)\s+voor\s+€?\s*(\d+(?:[.,]\d{1,2})?)$/,
  )
  if (quantityForPrice) {
    const quantity = Number(quantityForPrice[1])
    const totalPriceCents = normalizeMoneyToCents(quantityForPrice[2])
    if (
      Number.isSafeInteger(quantity) &&
      quantity > 0 &&
      totalPriceCents !== null &&
      totalPriceCents > 0
    ) {
      return {
        type: 'quantity_for_price',
        quantity,
        totalPriceCents,
      }
    }
  }

  const percent = cleaned.match(/^(\d+(?:[.,]\d+)?)%\s+korting$/)
  if (percent) {
    const normalizedPercent = percent[1].replace(',', '.')
    const [wholeText, fractionText = ''] = normalizedPercent.split('.')
    const whole = Number(wholeText)
    const fractionIsZero = fractionText === '' || /^0+$/.test(fractionText)
    const isTextuallyExactHundred = whole === 100 && fractionIsZero
    const isTextuallyBelowHundred =
      Number.isSafeInteger(whole) && whole >= 0 && whole < 100

    if (isTextuallyBelowHundred || isTextuallyExactHundred) {
      const percentValue = Number(normalizedPercent)
      const preservesUpperBound =
        isTextuallyExactHundred ? percentValue === 100 : percentValue < 100

      if (
        Number.isFinite(percentValue) &&
        percentValue > 0 &&
        preservesUpperBound
      ) {
        return {
          type: 'percent_discount',
          percent: percentValue,
        }
      }
    }
  }

  const fixed = cleaned.match(/^voor\s+€?\s*(\d+(?:[.,]\d{1,2})?)$/)
  if (fixed) {
    const priceCents = normalizeMoneyToCents(fixed[1])
    if (priceCents !== null && priceCents > 0) {
      return { type: 'fixed_price', priceCents }
    }
  }

  if (/^2e\s+halve\s+prijs$/.test(cleaned)) {
    return { type: 'second_half_price' }
  }

  return { type: 'unknown', rawLabel }
}
