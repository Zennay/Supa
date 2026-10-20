import type { MetricUnit } from './userRecipeImport.ts'

type Fraction = { numerator: bigint; denominator: bigint }
export type MeasuredRecipePart = Readonly<{
  quantity: string
  factor: number
  unit: MetricUnit
  repeats?: number
}>

function decimal(raw: string): Fraction | null {
  const match = /^(\d+)(?:[.,](\d+))?$/u.exec(raw)
  if (!match || raw.length > 50) return null
  const places = match[2]?.length ?? 0
  return { numerator: BigInt(match[1] + (match[2] ?? '')),
    denominator: 10n ** BigInt(places) }
}

function fraction(raw: string): Fraction | null {
  const vulgar: Record<string, string> = {
    '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  }
  // Recipes often write 1½ or 1 ½ without an ASCII slash. Keep these
  // fractions exact until the final upward rounding to 0.001 g/ml.
  const joined = /^(\d+)\s?([½¼¾⅓⅔⅛⅜⅝⅞])$/u.exec(raw)
  const normalized = joined
    ? joined[1] + ' ' + vulgar[joined[2]]
    : vulgar[raw] ?? raw
  const mixed = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/u.exec(normalized)
  if (!mixed) return decimal(normalized)
  const whole = BigInt(mixed[1] ?? '0')
  const numerator = BigInt(mixed[2])
  const denominator = BigInt(mixed[3])
  if (denominator === 0n) return null
  return { numerator: whole * denominator + numerator, denominator }
}

/** Exact original decimal/fraction + physical unit sums. Round g/ml only UP
 * to 0.001 base units; refuse fractional pieces and demands above 1,000,000.
 * A preview import must never omit a second measured part or underbuy food.
 */
export function measuredRecipeAmount(parts: readonly MeasuredRecipePart[]): number | null {
  if (!parts.length || parts.length > 9) return null
  let numerator = 0n
  let denominator = 1n
  for (const part of parts) {
    if (part.unit !== parts[0].unit ||
        !Number.isSafeInteger(part.repeats ?? 1) ||
        (part.repeats ?? 1) < 1 || (part.repeats ?? 1) > 1000) return null
    const amount = fraction(part.quantity)
    const factor = decimal(String(part.factor))
    if (!amount || !factor || amount.numerator <= 0n || factor.numerator <= 0n ||
        !amount.denominator || !factor.denominator) return null
    const n = amount.numerator * factor.numerator * BigInt(part.repeats ?? 1)
    const d = amount.denominator * factor.denominator
    numerator = numerator * d + n * denominator
    denominator *= d
  }
  if (!numerator || !denominator) return null
  const upper = 1_000_000n
  if (parts[0].unit === 'piece') {
    if (numerator % denominator) return null
    const count = numerator / denominator
    return count > 0n && count <= upper ? Number(count) : null
  }
  const milli = (numerator * 1000n + denominator - 1n) / denominator
  return milli > 0n && milli <= upper * 1000n ? Number(milli) / 1000 : null
}
