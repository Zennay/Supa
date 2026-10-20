import type { MetricUnit } from './userRecipeImport.ts'

type Decimal = { numerator: bigint; denominator: bigint }

// Number-to-shortest-decimal reconstruction. Exact metric portions must not
// depend on IEEE-754 multiplication near a 0.001 g / ml boundary.
function decimal(value: number): Decimal | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value))
  if (!m) return null
  const exponent = Number(m[3] ?? 0)
  const fractional = m[2] ?? ''
  const scale = fractional.length - exponent
  if (!Number.isSafeInteger(exponent) || Math.abs(scale) > 18 ||
      m[1].length + fractional.length > 40) return null
  const digits = BigInt(m[1] + fractional)
  if (digits <= 0n) return null
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n }
}

/**
 * One shared portion scaler for the recipe detail's unpriced checklist and
 * its Planner-ready variant. Round gram/ml demand UP to the nearest 0.001;
 * physical pieces remain unknown unless they divide to an exact whole count.
 * Refuse >1m base-unit amounts; never invent a store pack or price.
 */
export function scaledMetricPortionAmount(
  amount: number, sourceServings: number, targetPortions: number, unit: MetricUnit,
): number | null {
  if (!Number.isSafeInteger(targetPortions) ||
      targetPortions < 1 || targetPortions > 100 ||
      !['g', 'ml', 'piece'].includes(unit)) return null
  const physical = decimal(amount)
  const source = decimal(sourceServings)
  if (!physical || !source) return null
  const numerator = physical.numerator * BigInt(targetPortions) * source.denominator
  const denominator = physical.denominator * source.numerator
  if (denominator <= 0n || numerator <= 0n) return null

  const upper = 1_000_000n
  if (unit === 'piece') {
    if (numerator % denominator !== 0n) return null
    const count = numerator / denominator
    return count >= 1n && count <= upper ? Number(count) : null
  }
  const milli = (numerator * 1000n + denominator - 1n) / denominator
  return milli > 0n && milli <= upper * 1000n ? Number(milli) / 1000 : null
}
