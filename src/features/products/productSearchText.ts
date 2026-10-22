/** Search-only normalization for original, user-supplied product names.
 * It never changes a source SKU, captured text, price or review identity.
 * Dutch users can find 'crème' by entering 'creme'.
 */
export function productSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl')
}

/** Canonicalize quantity/unit spelling for discovery only.
 * Unit words are shortened only when attached to a numeric quantity, avoiding
 * broad false positives such as making every word containing "l" match "liter".
 * Original source labels and financial/physical identity are never rewritten.
 */
export function normalizeProductSearchValue(value: string): string {
  return productSearchText(value)
    .replace(/(\d),(?=\d)/gu, '$1.')
    .replace(/(\d+(?:\.\d+)?)\s*(?:milliliters?|millilitres?)\b/gu, '$1ml')
    .replace(/(\d+(?:\.\d+)?)\s*(?:centiliters?|centilitres?)\b/gu, '$1cl')
    .replace(/(\d+(?:\.\d+)?)\s*(?:deciliters?|decilitres?)\b/gu, '$1dl')
    .replace(/(\d+(?:\.\d+)?)\s*(?:liters?|litres?)\b/gu, '$1l')
    .replace(/(\d+(?:\.\d+)?)\s*kilogram(?:men|s)?\b/gu, '$1kg')
    .replace(/(\d+(?:\.\d+)?)\s*gram(?:men|s)?\b/gu, '$1g')
    .replace(/(\d)\s*[×✕✖x]\s*(?=\d)/gu, '$1x')
    .replace(/(\d)\s+([a-z])/gu, '$1$2')
}

/** Search presentation only: each term may match a different source field.
 * For example, "PLUS melk 500 gram" spans retailer, product name and pack size.
 * No normalization here is applied to source identity, matching or money.
 */
export function productSearchTerms(query: string): string[] {
  return normalizeProductSearchValue(query.trim()).split(/\s+/u).filter(Boolean)
}

export function productFieldsMatchTerms(
  values: readonly (string | number | null | undefined)[], terms: readonly string[],
): boolean {
  if (!terms.length) return true
  const searchable = values.map(value => value == null ? '' : normalizeProductSearchValue(String(value)))
  return terms.every(term => searchable.some(field => field.includes(term)))
}
