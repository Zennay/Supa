/** Safe subset of SOURCE-OBSERVED structural HTML tag names for private
 * synthetic exports and bounded operator review receipts. No source value,
 * URL, SKU or price can be copied through custom element tag names.
 * This never manufactures DOM selectors or promotes ingestion permissions.
 */
const COMPONENT_TOKENS = new Set([
  'retailer','store','plus','deka','dekamarkt','product','item','card','tile',
  'name','title','label','price','pack','size','unit','offer','deal',
  'stock','availability','listing','catalog','web','component','custom',
])
export function isSafeStructuralReviewTag(tag) {
  if (typeof tag !== 'string' || tag.length > 64 ||
      !/^[a-z][a-z0-9-]*$/.test(tag)) return false
  if (!tag.includes('-')) return true
  const words = tag.split('-')
  return words.length >= 2 && words.length <= 5 &&
    words.every(word => COMPONENT_TOKENS.has(word))
}
