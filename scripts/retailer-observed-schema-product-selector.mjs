/** Exact SOURCE-OBSERVED Schema.org Product itemtype CSS, never inferred.
 * Accept an explicit Product, optionally paired with official Thing. Reject
 * arbitrary extra types, markup, identifiers, duplicates and noncanonical
 * whitespace before returning any selector to a review-only surface.
 */
const OFFICIAL = new Set([
  'https://schema.org/Product','http://schema.org/Product',
  'https://schema.org/Thing','http://schema.org/Thing',
])
export function matchObservedSchemaProductSelector(selector) {
  if (typeof selector !== 'string') return null
  const match = /^(article|section|div|li|a)\[itemtype="([a-zA-Z0-9:/ .-]{1,130})"\]$/.exec(selector)
  if (!match) return null
  const types=match[2].split(' ')
  if (types.length<1 || types.length>2 || new Set(types).size!==types.length ||
      !types.every(type=>OFFICIAL.has(type)) ||
      !types.some(type=>type.endsWith('/Product')) ||
      (types.length===2 && !types.some(type=>type.endsWith('/Thing')))) return null
  return {tag:match[1],itemtype:match[2]}
}
