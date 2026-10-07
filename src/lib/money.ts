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

function toIntegerCents(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return null
  }

  return BigInt(value)
}

function formatIntegerCents(cents: bigint): string {
  const negative = cents < 0n
  const absoluteCents = negative ? -cents : cents
  const wholeEuros = absoluteCents / 100n
  const fraction = (absoluteCents % 100n).toString().padStart(2, '0')
  const wholeValue = negative
    ? wholeEuros === 0n
      ? -0
      : -wholeEuros
    : wholeEuros

  return euroFormatter
    .formatToParts(wholeValue)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('')
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

  formatCents(value: number | bigint) {
    const cents = toIntegerCents(value)
    return cents === null ? '—' : formatIntegerCents(cents)
  },
}
