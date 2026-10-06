const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

export const euro = {
  format(value: number | bigint) {
    if (typeof value === 'bigint') {
      return euroFormatter.format(value)
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
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
