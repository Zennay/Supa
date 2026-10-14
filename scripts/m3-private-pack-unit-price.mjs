// Read-only visual guidance for private manually observed supermarket packs.
// Cent-exact BigInt rational arithmetic: the basket winner must ALWAYS use
// the canonical whole-pack line totals, never approximate unit-price labels.
function exactDecimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))
  if (!match) return null
  const integral = match[1]
  const fraction = match[2] ?? ''
  const exp = Number(match[3] ?? 0)
  const scale = fraction.length - exp
  if (!Number.isSafeInteger(exp) || scale > 18 || scale < -18 ||
      integral.length + fraction.length > 40) return null
  const digits = BigInt(integral + fraction)
  if (digits === 0n) return null
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n }
}

export function privateM3PackUnitPrice(product) {
  if (product === null || typeof product !== 'object' ||
      product.status !== 'known' ||
      !Number.isSafeInteger(product.pricePerPackageCents) ||
      product.pricePerPackageCents < 0 ||
      !Number.isSafeInteger(product.itemsPerPackage) ||
      product.itemsPerPackage <= 0) return null
  const quantity = exactDecimal(product.packAmount)
  if (!quantity) return null

  const conversion = {
    g: { baseFactor: 1n, displaySize: 100n, label: '100 g' },
    kg: { baseFactor: 1000n, displaySize: 100n, label: '100 g' },
    ml: { baseFactor: 1n, displaySize: 100n, label: '100 ml' },
    l: { baseFactor: 1000n, displaySize: 100n, label: '100 ml' },
    piece: { baseFactor: 1n, displaySize: 1n, label: 'stuk' },
  }[product.packUnit]
  if (!conversion) return null

  const denominator = quantity.numerator * conversion.baseFactor *
    BigInt(product.itemsPerPackage)
  if (denominator === 0n) return null
  const numerator = BigInt(product.pricePerPackageCents) *
    conversion.displaySize * quantity.denominator
  // Round half-up only at display time. This is not used as a basket total.
  const roundedCents = (numerator * 2n + denominator) / (denominator * 2n)
  if (roundedCents > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return {
    cents: Number(roundedCents),
    basis: conversion.label,
    approximate: numerator % denominator !== 0n,
  }
}
