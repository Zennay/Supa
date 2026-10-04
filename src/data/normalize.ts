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

export function normalizeMoneyToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/\s/g, '')
    .replace(/^€/, '')

  if (!cleaned) {
    return null
  }

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned

  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) {
    return null
  }

  const cents = Math.round(value * 100)
  return Math.abs(value * 100 - cents) < 1e-6 ? cents : null
}

export type NormalizedPack = RawPack & {
  count: number
}

export function normalizePackText(input: string | null): NormalizedPack {
  const rawText = input?.trim() || null

  if (!rawText) {
    return { rawText, count: 1, amount: null, unit: 'unknown' }
  }

  const cleaned = rawText
    .toLowerCase()
    .replace(/^per\s+(pak|fles|doos|zak)\s+/i, '')
    .trim()

  const multipack = cleaned.match(
    /^(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gram|l|liter|ml|st|stuk|stuks)\b/,
  )

  if (multipack) {
    return {
      rawText,
      count: Number(multipack[1]),
      amount: decimal(multipack[2]),
      unit: UNIT_ALIASES[multipack[3]],
    }
  }

  const single = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*(kg|g|gram|l|liter|ml|st|stuk|stuks)\b/,
  )

  if (single) {
    return {
      rawText,
      count: 1,
      amount: decimal(single[1]),
      unit: UNIT_ALIASES[single[2]],
    }
  }

  return { rawText, count: 1, amount: null, unit: 'unknown' }
}
