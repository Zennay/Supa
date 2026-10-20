/** Search-only normalization for original, user-supplied product names.
 * It never changes a source SKU, captured text, price or review identity.
 * Dutch users can find 'crème' by entering 'creme'.
 */
export function productSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl')
}
