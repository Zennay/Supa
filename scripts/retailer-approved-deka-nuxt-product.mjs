/**
 * Minimal DekaMarkt Nuxt -> canonical private product observation from
 * already-authorized, SHA-checked HTML. Does not forge GitHub run/artifact IDs.
 *
 * Strictly corroborates Nuxt product, price and pack with the corresponding
 * page's JSON-LD Product identity and independently stated EUR price. This
 * fallback is needed because DekaMarkt's observed SSR JSON-LD used "Price"
 * (capital P), which the generic schema.org parser deliberately does not trust.
 */
import { normalizeMoneyToCents, normalizePackText } from '../src/data/normalize.ts'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { normalizeSchemaOrgAvailability } from '../src/data/schemaOrgProduct.ts'
import { readAuthorizedHtmlScriptEvidence } from './retailer-approved-html-script-evidence.mjs'

const fail = () => ({ type: 'abstain', reason: 'DekaMarkt Nuxt product cannot be independently corroborated' })
const data = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const deref = (values, index) => Number.isSafeInteger(index) &&
  index >= 0 && index < values.length ? values[index] : undefined
const scalar = (values, ref) => {
  const value = deref(values, ref)
  return ['string', 'number', 'boolean'].includes(typeof value) ? value : null
}
function oneDekaProduct(jsonLdBlocks) {
  // Deka's historical product page supplied a single flat JSON-LD Product
  // document. Graphs or multiple products must be independently reviewed.
  const values = jsonLdBlocks.flatMap(value => Array.isArray(value) ? value : [value])
  const products = values.filter(value => data(value) && value['@type'] === 'Product')
  return products.length === 1 && values.length <= 8 ? products[0] : null
}

// Deka's historical SSR uses capital Price. Additional price claims are
// evidence, not harmless metadata: any disagreement or ambiguous range must
// block this otherwise independently corroborated fallback.
function consistentOfferPriceEvidence(offer, expectedCents) {
  if (!data(offer) ||
      Object.keys(offer).some(key => ['pricespecification','lowprice','highprice'].includes(key.toLowerCase()))) {
    return false
  }
  const prices = Object.entries(offer)
    .filter(([key]) => key.toLowerCase() === 'price')
  if (!prices.length || prices.some(([, value]) =>
      !['number','string'].includes(typeof value) ||
      normalizeMoneyToCents(String(value)) !== expectedCents)) return false
  const currencies = Object.entries(offer)
    .filter(([key]) => key.toLowerCase() === 'pricecurrency')
  if (!currencies.length || currencies.some(([, value]) => value !== 'EUR')) return false
  const stocks = Object.entries(offer)
    .filter(([key]) => key.toLowerCase() === 'availability')
  if (!stocks.length || stocks.some(([, value]) =>
      normalizeSchemaOrgAvailability(value) !==
        normalizeSchemaOrgAvailability(offer.availability))) return false
  return true
}

export function parseDekaNuxtFromAuthorizedHtml({ html, provenance, jsonLdBlocks } = {}) {
  try {
    if (typeof html !== 'string' || html.length > 2 * 1024 * 1024 ||
        provenance?.supermarket !== 'dekamarkt' ||
        provenance.kind !== 'product' || typeof provenance.url !== 'string' ||
        !Array.isArray(jsonLdBlocks)) return fail()
    const parsedUrl = new URL(provenance.url)
    const expectedId = /\/([0-9]+)\/?$/.exec(parsedUrl.pathname)?.[1]
    if (parsedUrl.protocol !== 'https:' ||
        parsedUrl.hostname !== 'www.dekamarkt.nl' || parsedUrl.port ||
        !parsedUrl.pathname.startsWith('/producten/') || !expectedId ||
        parsedUrl.search || parsedUrl.hash ||
        parsedUrl.href !== provenance.url) return fail()

    const scriptEvidence = readAuthorizedHtmlScriptEvidence(html)
    const values = scriptEvidence.nuxtPayload
    if (scriptEvidence.invalid || !values) return fail()
    const references = []
    for (const entry of values) {
      if (!data(entry)) continue
      for (const [key, ref] of Object.entries(entry)) {
        if (/^product-information-\d+$/.test(key)) references.push(ref)
      }
    }
    if (references.length !== 1) return fail()
    const product = deref(values, references[0])
    if (!data(product)) return fail()
    const productId = scalar(values, product.productId)
    const name = scalar(values, product.headerText)
    const packText = scalar(values, product.packaging)
    const assortment = deref(values, product.productAssortment)
    if (!Number.isSafeInteger(productId) || String(productId) !== expectedId ||
        typeof name !== 'string' || !name.trim() || name.length > 300 ||
        typeof packText !== 'string' || !data(assortment) ||
        scalar(values, assortment.productId) !== productId) return fail()

    const regular = scalar(values, assortment.normalPrice)
    const promotional = scalar(values, assortment.offerPrice)
    if (typeof promotional !== 'number' || !Number.isFinite(promotional) ||
        promotional < 0) return fail()
    const price = promotional > 0 ? promotional : regular
    if (typeof price !== 'number' || !Number.isFinite(price)) return fail()
    const cents = normalizeMoneyToCents(String(price))
    const pack = normalizePackText(packText)
    if (!Number.isSafeInteger(cents) || cents <= 0 ||
        pack.amount === null || pack.unit === 'unknown') return fail()

    const ld = oneDekaProduct(jsonLdBlocks)
    const offer = ld?.offers
    if (!ld || !data(offer) || ld.name !== name ||
        String(ld.mpn) !== expectedId || offer.priceCurrency !== 'EUR' ||
        typeof offer.Price !== 'number' ||
        !consistentOfferPriceEvidence(offer, cents) ||
        normalizeMoneyToCents(String(offer.Price)) !== cents ||
        (ld['@id'] !== undefined && ld['@id'] !== provenance.url + '#product') ||
        (offer.url !== undefined && offer.url !== provenance.url)) return fail()

    const observation = validateRawProductObservation({
      supermarket: 'dekamarkt',
      sourceProductId: expectedId,
      name, currentPriceCents: cents, currency: 'EUR',
      pack: { rawText: pack.rawText, amount: pack.amount, unit: pack.unit },
      // Price was corroborated; mechanics/period were NOT, so no inferred offer.
      offer: null,
      availability: normalizeSchemaOrgAvailability(offer.availability),
      provenance,
    })
    return { type: 'observation', observation }
  } catch {
    return fail()
  }
}

// Schema.org and Nuxt may express the SAME physical single pack as
// 1000 ml vs 1 liter (or 1000 g vs 1 kg). Compare dimensions and exact
// physical quantity, never the lexical unit label; multipack item counts
// must also match so 2x500 ml cannot silently equal one 1-litre pack.
function equivalentPhysicalPack(a, b) {
  if (!a || !b || typeof a.amount !== 'number' || typeof b.amount !== 'number') return false
  const dimensions = {g:'mass',kg:'mass',ml:'volume',l:'volume',piece:'piece'}
  const factors = {g:1,kg:1000,ml:1,l:1000,piece:1}
  if (!Object.hasOwn(dimensions,a.unit) || !Object.hasOwn(dimensions,b.unit) ||
      dimensions[a.unit] !== dimensions[b.unit]) return false
  const left = normalizePackText(a.rawText)
  const right = normalizePackText(b.rawText)
  if (left.amount === null || right.amount === null || left.count !== right.count ||
      left.amount !== a.amount || right.amount !== b.amount ||
      left.unit !== a.unit || right.unit !== b.unit) return false
  const amountA = a.amount * factors[a.unit]
  const amountB = b.amount * factors[b.unit]
  return Number.isFinite(amountA) && Number.isFinite(amountB) &&
    amountA > 0 && Number.isSafeInteger(Math.round(amountA * 1000)) &&
    Math.abs(amountA - amountB) < 1e-9
}

/**
 * A fully parseable JSON-LD Offer is not grounds to ignore the same page's
 * Nuxt product/price. If both claim to describe this Deka SKU, all concrete
 * product facts must corroborate or we abstain. Missing structured pack/price
 * may be filled only by the independently matched Nuxt+JSON-LD pair.
 */
export function corroborateDekaNuxtProduct({ html, provenance, jsonLdBlocks,
  structured, nuxtPresent } = {}) {
  if (!nuxtPresent) return structured
  const fallback = parseDekaNuxtFromAuthorizedHtml({
    html, provenance, jsonLdBlocks,
  })
  if (fallback.type !== 'observation') return fail()
  if (structured?.type === 'observation') {
    const a = structured.observation
    const b = fallback.observation
    if (a.name !== b.name ||
        (a.sourceProductId !== null && a.sourceProductId !== b.sourceProductId) ||
        (a.currentPriceCents !== null &&
          a.currentPriceCents !== b.currentPriceCents) ||
        (a.currency !== null && a.currency !== b.currency) ||
        (a.availability !== 'unknown' && a.availability !== b.availability) ||
        (a.pack.amount !== null && !equivalentPhysicalPack(a.pack, b.pack))) return fail()
  }
  return fallback
}
