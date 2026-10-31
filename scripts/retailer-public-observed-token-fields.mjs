/** Generic source-observed class/test-id tokens that designate ONE field.
 * This does not invent selectors; the DOM scanner must observe the token first.
 */
export const PUBLIC_OBSERVED_TOKEN_FIELDS = Object.freeze({
  'product-card':'product', 'item-card':'product',
  'product_card':'product', 'item_card':'product',
  'product-name':'name', 'item-name':'name',
  'product_name':'name', 'item_name':'name',
  'product-title':'name', 'item-title':'name',
  'price-value':'price', 'price-label':'price', 'price-tag':'price',
  'product-price':'price', 'item-price':'price',
  // The observed class/test-id must actually occur in source DOM. These
  // generic underscore aliases may then safely survive private-only review,
  // not become invented selectors, price quotes or publication permission.
  'price_value':'price', 'product_price':'price',
  'pack-size':'pack',
  'pack_size':'pack',
  // Source-observed old/was/before price labels are NOT a live price quote.
  'old-price':'offer', 'price-old':'offer', 'price-before':'offer',
  'previous-price':'offer', 'was-price':'offer', 'original-price':'offer',
  // CSS frameworks often encode the same historical price labels with an
  // underscore. These remain *former* prices, never live checkout quotes.
  'old_price':'offer', 'price_old':'offer', 'price_before':'offer',
  'previous_price':'offer', 'was_price':'offer', 'original_price':'offer',
  'offer-card':'offer', 'offer-label':'offer',
  'offer_card':'offer', 'offer_label':'offer',
  'stock-label':'availability', 'stock-availability':'availability',
  'stock_label':'availability', 'stock_availability':'availability',
})

// These tags represent a struck-through FORMER price, never a current quote.
export const isFormerPriceTag = tag => tag === 'del' || tag === 's' || tag === 'strike'

const FORMER_PRICE_TOKENS = new Set([
  'old-price','price-old','price-before','previous-price','was-price','original-price',
  'old_price','price_old','price_before','previous_price','was_price','original_price',
])
export const isFormerPriceToken = token => FORMER_PRICE_TOKENS.has(token)

// Exact generic tokens seen in source DOMs, without invented retailer CSS.
export const PUBLIC_BARE_OBSERVED_TOKEN_FIELDS = Object.freeze({
  product:'product', item:'product', card:'product', tile:'product',
  name:'name', title:'name', label:'name', price:'price',
  pack:'pack', size:'pack', unit:'pack',
  offer:'offer', deal:'offer', sale:'offer', discount:'offer',
  stock:'availability', availability:'availability',
})
export function isAllowedPublicObservedToken(field, token, tag) {
  const expected = Object.hasOwn(PUBLIC_OBSERVED_TOKEN_FIELDS,token)
    ? PUBLIC_OBSERVED_TOKEN_FIELDS[token] : PUBLIC_BARE_OBSERVED_TOKEN_FIELDS[token]
  if (typeof expected !== 'string') return false
  // A struck-through former price cannot be a current-price selector.
  if (expected === 'price' && isFormerPriceTag(tag)) return field === 'offer'
  return expected === field
}
