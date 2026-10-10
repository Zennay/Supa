// Canonical M3 field CSV uses the same quantity families as the matching
// domain. This checks dimensional compatibility only, NOT that a single SKU
// contains enough food for the plan: the basket may buy multiple SKUs.
const UNIT_FAMILY = Object.freeze({
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  piece: 'count',
})

export function sameM3QuantityFamily(requiredUnit, observedPackUnit) {
  if (typeof requiredUnit !== 'string' || typeof observedPackUnit !== 'string') {
    return false
  }
  const required = UNIT_FAMILY[requiredUnit]
  return typeof required === 'string' &&
    required === UNIT_FAMILY[observedPackUnit]
}

// A product sold as discrete pieces cannot claim e.g. 0.5 pieces inside a
// package; other families may use fractional weights and volumes.
export function validM3PackPieceAmount(amount, unit) {
  if (unit !== 'piece') return true
  if (typeof amount !== 'string' || !/^(?:0|[1-9]\\d*)$/.test(amount)) return false
  const count = Number(amount)
  return Number.isSafeInteger(count) && count > 0
}
