import type { MatchUnit } from './matching.ts'

// Decimal arithmetic uses the input number's shortest round-trippable decimal
// spelling. This treats user-authored "0.1" as a decimal quantity, not the
// accidental binary approximation produced by IEEE-754 addition.
type Decimal = { coefficient: bigint; scale: number }

const MAX_DECIMAL_PLACES = 400
const MAX_DEMAND_LINES = 10000

function decimal(value: unknown): Decimal | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) return null

  const fractional = match[2] ?? ''
  const exponent = match[3] ? Number(match[3]) : 0
  const shift = exponent - fractional.length

  if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_DECIMAL_PLACES) {
    return null
  }

  const coefficient = BigInt(match[1] + fractional)
  return shift < 0
    ? { coefficient, scale: -shift }
    : { coefficient: coefficient * 10n ** BigInt(shift), scale: 0 }
}

function baseFactor(unit: MatchUnit): { factor: bigint; family: string } | null {
  switch (unit) {
    case 'kg': return { factor: 1000n, family: 'mass' }
    case 'g': return { factor: 1n, family: 'mass' }
    case 'l': return { factor: 1000n, family: 'volume' }
    case 'ml': return { factor: 1n, family: 'volume' }
    case 'piece': return { factor: 1n, family: 'piece' }
    default: return null
  }
}

function equalDecimal(left: Decimal, right: Decimal): boolean {
  return (
    left.coefficient * 10n ** BigInt(right.scale) ===
    right.coefficient * 10n ** BigInt(left.scale)
  )
}

/**
 * Sum positive decimal quantities without binary floating-point drift.
 * Reject a sum that cannot be faithfully represented as a JS number.
 * A caller can then surface an unresolved ingredient instead of rounding
 * an unsafe demand silently.
 */
export function sumDecimalAmounts(amounts: readonly number[]): number | null {
  if (!Array.isArray(amounts) || amounts.length === 0 || amounts.length > MAX_DEMAND_LINES) {
    return null
  }

  let coefficient = 0n
  let scale = 0

  for (const amount of amounts) {
    const part = decimal(amount)
    if (!part) return null

    const commonScale = Math.max(scale, part.scale)
    coefficient =
      coefficient * 10n ** BigInt(commonScale - scale) +
      part.coefficient * 10n ** BigInt(commonScale - part.scale)
    scale = commonScale
  }

  const result = Number(coefficient) / Number(10n ** BigInt(scale))
  const resultDecimal = decimal(result)
  if (!resultDecimal || !equalDecimal(resultDecimal, { coefficient, scale })) return null
  return result
}

export type DecimalDemand = { amount: number; unit: MatchUnit }
export type DecimalPack = { amount: number; unit: MatchUnit; count?: number }

/**
 * Exact whole-pack ceiling of the *original* per-meal decimal requirements.
 * Never use an already-rounded floating sum as the input.
 *
 * null means the basket cannot safely infer the number of packs; the caller
 * must leave the ingredient unresolved rather than quote a total.
 */
export function calculateDecimalPackCount(
  demands: readonly DecimalDemand[],
  pack: DecimalPack,
): number | null {
  if (
    !Array.isArray(demands) ||
    demands.length === 0 ||
    demands.length > MAX_DEMAND_LINES ||
    !pack ||
    typeof pack !== 'object' ||
    Array.isArray(pack)
  ) return null

  const packAmount = decimal(pack.amount)
  const packBase = baseFactor(pack.unit)
  const packCount = pack.count ?? 1

  if (
    !packAmount ||
    !packBase ||
    !Number.isSafeInteger(packCount) ||
    packCount <= 0
  ) return null

  let demandCoefficient = 0n
  let demandScale = 0
  for (const entry of demands) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const parsed = decimal(entry.amount)
    const base = baseFactor(entry.unit)
    if (!parsed || !base || base.family !== packBase.family) return null

    const commonScale = Math.max(demandScale, parsed.scale)
    demandCoefficient =
      demandCoefficient * 10n ** BigInt(commonScale - demandScale) +
      parsed.coefficient * base.factor * 10n ** BigInt(commonScale - parsed.scale)
    demandScale = commonScale
  }

  const numerator = demandCoefficient * 10n ** BigInt(packAmount.scale)
  const denominator =
    packAmount.coefficient *
    packBase.factor *
    BigInt(packCount) *
    10n ** BigInt(demandScale)

  if (denominator <= 0n) return null
  const exactPacks = (numerator + denominator - 1n) / denominator
  if (exactPacks <= 0n || exactPacks > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(exactPacks)
}
