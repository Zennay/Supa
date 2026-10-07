const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

const MAX_SAFE_EURO_MAGNITUDE = Number.MAX_SAFE_INTEGER / 100

function isSafeEuroNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_SAFE_EURO_MAGNITUDE &&
    Number(value.toFixed(2)) === value
  )
}

export const euro = {
  format(value: number | bigint) {
    if (typeof value === 'bigint') {
      return euroFormatter.format(value)
    }
    if (!isSafeEuroNumber(value)) {
      return '—'
    }

    const normalizedValue = Object.is(value, -0) ? 0 : value
    return euroFormatter.format(normalizedValue)
  },
}

export function savings(baseline: number, total: number): number | null {
  if (
    !isSafeEuroNumber(baseline) ||
    !isSafeEuroNumber(total) ||
    baseline < 0 ||
    total < 0
  ) {
    return null
  }

  return Math.max(0, baseline - total)
}
