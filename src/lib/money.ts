const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

export const euro = {
  format(value: number | bigint) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return '—'
    }

    return euroFormatter.format(value)
  },
}

export function savings(baseline: number, total: number): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(total)) {
    return null
  }

  return Math.max(0, baseline - total)
}
