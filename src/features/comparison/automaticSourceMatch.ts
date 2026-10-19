import type { BasketTraceLine, StoreProduct } from '../../domain/basket.ts'

/**
 * A deliberately narrow automatic identity admission on owner-supplied sources.
 * This is NOT retailer authorization, independent price verification or a
 * substitute for the already canonical physical whole-pack basket calculation.
 *
 * No guessed replacements: the original candidate must be the unique SKU
 * selected by the ordinary matcher, fully priced and available, with an exact
 * semantic query/name match after discarding only retailer and pack notation.
 * An adjective/variety/brand/ingredient modifier is meaningful, not discarded.
 */
const incidental = new Set([
  'plus', 'dekamarkt', 'deka', 'markt',
  'pak', 'pakken', 'zak', 'zakje', 'doos', 'doosje', 'fles', 'flessen',
  'verpakking', 'verpakkingen', 'gram', 'kilogram', 'liter', 'ml', 'kg', 'gr',
  'stuks', 'stuk', 'g', 'l', 'x',
])
// Pack notation is not an ingredient modifier: "500g", "1kg", "2x500ml".
const packNotation = /^(?:[0-9]+x)?[0-9]+(?:[.,][0-9]+)?(?:kg|gram|gr|g|ml|cl|liter|l|stuks|stuk)$/
const normalize = (value: string): string[] => value.normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase('nl')
  .match(/[\p{L}\p{N}]+/gu)?.filter(token => !incidental.has(token) &&
    !/^[0-9]+$/.test(token) && !packNotation.test(token) && !/^[0-9]+x$/.test(token)) ?? []

function tokensMatch(query: string, productName: string): boolean {
  const queryTokens = normalize(query)
  const sourceTokens = normalize(productName)
  return queryTokens.length > 0 && queryTokens.length <= 8 &&
    queryTokens.length === sourceTokens.length &&
    [...queryTokens].sort().join('|') === [...sourceTokens].sort().join('|')
}

export function automaticallyAcceptedSourceLine(
  line: BasketTraceLine,
  products: readonly StoreProduct[],
  query: string,
  explicitSku: string | undefined,
): boolean {
  if (line.status !== 'matched' || Boolean(explicitSku) ||
      // The canonical matcher has already required a clear margin over the
      // runner-up. Exact semantic identity is the additional auto-accept gate.
      !Number.isFinite(line.matchScore) || line.matchScore < 65 ||
      !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0 ||
      !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0 ||
      !Number.isSafeInteger(line.packs) || line.packs <= 0 ||
      !tokensMatch(query, line.productName) ||
      !tokensMatch(line.ingredientLabel, line.productName)) return false

  const matching = products.filter(product => product.id === line.productId)
  if (matching.length !== 1) return false
  const source = matching[0]
  return source.available === true &&
    source.name === line.productName &&
    source.priceCents === line.pricePerPackCents &&
    Number.isSafeInteger(source.priceCents) && source.priceCents >= 0 &&
    source.packAmount !== null && source.packAmount === line.pack.amount &&
    source.packUnit === line.pack.unit &&
    (source.packCount ?? 1) === line.pack.count
}
