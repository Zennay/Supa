/** Generic source-observed class/test-id tokens that designate ONE field.
 * This does not invent selectors; the DOM scanner must observe the token first.
 */
export const PUBLIC_OBSERVED_TOKEN_FIELDS = Object.freeze({
  'product-card':'product', 'item-card':'product',
  'product-name':'name', 'item-name':'name',
  'product-title':'name', 'item-title':'name',
  'price-value':'price', 'price-label':'price', 'price-tag':'price',
  'product-price':'price', 'item-price':'price',
  'pack-size':'pack',
  'offer-card':'offer', 'offer-label':'offer',
  'stock-label':'availability',
})
