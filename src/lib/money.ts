const euroFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

function toSafeCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || value !== cents / 100) {
    return null
  }

  return cents
}

export const euro = {
  format(value: number | bigint) {
    if (typeof value === 'bigint') {
      return euroFormatter.format(value)
    }
    if (toSafeCents(value) === null) {
      return '—'
    }

    const normalizedValue = Object.is(value, -0) ? 0 : value
    return euroFormatter.format(normalizedValue)
  },
}
