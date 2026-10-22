/** Search-only normalization for original, user-supplied product names.
 * It never changes a source SKU, captured text, price or review identity.
 * Dutch users can find 'crème' by entering 'creme'.
 */
export function productSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl')
}

/** Search presentation only: each term may match a different source field.
 * For example, "PLUS melk 500 g" spans retailer, product name and pack size.
 * No normalization here is applied to source identity, matching or money. */
export function productSearchTerms(query: string): string[] {
  return productSearchText(query.trim())
    .replace(/(\d),(?=\d)/gu, '$1.')
    .replace(/(\d)\s+([a-z])/gu, '$1$2')
    .split(/\s+/u).filter(Boolean)
}

export function productFieldsMatchTerms(
  values: readonly (string | number | null | undefined)[], terms: readonly string[],
): boolean {
  if (!terms.length) return true
  const searchable = values.map(value => value == null ? '' : productSearchTerms(String(value)).join(' '))
  return terms.every(term => searchable.some(field => field.includes(term)))
}
