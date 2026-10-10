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
