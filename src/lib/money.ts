const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

const MAX_SAFE_EURO_MAGNITUDE = Number.MAX_SAFE_INTEGER / 100

export const euro = {
  format(value: number | bigint) {
    if (typeof value === 'bigint') {
      return euroFormatter.format(value)
    }
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Math.abs(value) > MAX_SAFE_EURO_MAGNITUDE
    ) {
      return '—'
    }

    const normalizedValue = Object.is(value, -0) ? 0 : value
    return euroFormatter.format(normalizedValue)
  },
}

export function savings(baseline: number, total: number): number | null {
  if (
    !Number.isFinite(baseline) ||
    !Number.isFinite(total) ||
    baseline < 0 ||
    total < 0
  ) {
    return null
  }

  return Math.max(0, baseline - total)
}
