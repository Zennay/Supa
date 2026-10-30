// One product-root contract for offline DOM proposals, snapshot review, and
// historic selector drift. Never contains product URLs/IDs or source grants.
const roots = Object.freeze({
  plus: Object.freeze([
    'a[href^="/product/"]',
    'a[href^="product/"]',
    'a[href^="./product/"]',
    'a[href^="https://www.plus.nl/product/"]',
    'a[href^="//www.plus.nl/product/"]',
  ]),
  dekamarkt: Object.freeze([
    'a[href^="/producten/"]',
    'a[href^="producten/"]',
    'a[href^="./producten/"]',
    'a[href^="https://www.dekamarkt.nl/producten/"]',
    'a[href^="//www.dekamarkt.nl/producten/"]',
  ]),
})
export function isPublicMerchantProductHrefSelector(retailerId, selector) {
  return typeof selector === 'string' &&
    typeof retailerId === 'string' &&
    Object.hasOwn(roots, retailerId) &&
    roots[retailerId].includes(selector)
}
