/** Generic source-observed class/test-id tokens that designate ONE field.
 * This does not invent selectors; the DOM scanner must observe the token first.
 */
export const PUBLIC_OBSERVED_TOKEN_FIELDS = Object.freeze({
  'product-card':'product', 'item-card':'product',
  'product-name':'name', 'item-name':'name',
  'product-title':'name', 'item-title':'name',
  'price-value':'price', 'price-label':'price', 'price-tag':'price',
  'product-price':'price', 'item-price':'price',
  // The observed class/test-id must actually occur in source DOM. These
  // generic underscore aliases may then safely survive private-only review,
  // not become invented selectors, price quotes or publication permission.
  'price_value':'price', 'product_price':'price',
  'pack-size':'pack',
  // Source-observed old/was/before price labels are NOT a live price quote.
  'old-price':'offer', 'price-old':'offer', 'price-before':'offer',
  'previous-price':'offer', 'was-price':'offer', 'original-price':'offer',
  // CSS frameworks often encode the same historical price labels with an
  // underscore. These remain *former* prices, never live checkout quotes.
  'old_price':'offer', 'price_old':'offer', 'price_before':'offer',
  'previous_price':'offer', 'was_price':'offer', 'original_price':'offer',
  'offer-card':'offer', 'offer-label':'offer',
  'stock-label':'availability', 'stock-availability':'availability',
})

// These tags represent a struck-through FORMER price, never a current quote.
export const isFormerPriceTag = tag => tag === 'del' || tag === 's' || tag === 'strike'

const FORMER_PRICE_TOKENS = new Set([
  'old-price','price-old','price-before','previous-price','was-price','original-price',
  'old_price','price_old','price_before','previous_price','was_price','original_price',
])
export const isFormerPriceToken = token => FORMER_PRICE_TOKENS.has(token)
