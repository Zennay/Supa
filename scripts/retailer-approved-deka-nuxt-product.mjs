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


/**
 * A JSON-LD pack claim is corroborating evidence, never a replacement for
 * Nuxt packaging. Compare the complete physical quantity and pack structure,
 * normalizing kg->g and l->ml; refuse unclear/unsupported explicit claims.
 * Historical Deka pages with no weight claim keep their existing contract.
 */
function corroboratesDeclaredWeight(claim, nuxtPack) {
  const claimedText = typeof claim === 'string' ? claim :
    data(claim) && typeof claim.value === 'string' ? claim.value : null
  if (!claimedText) return false
  const declared = normalizePackText(claimedText)
  if (declared.amount === null || declared.unit === 'unknown' ||
      nuxtPack.amount === null || nuxtPack.unit === 'unknown' ||
      declared.count !== nuxtPack.count) return false
  const base = (pack) => {
    switch (pack.unit) {
      case 'l': return ['volume', pack.amount * 1000]
      case 'ml': return ['volume', pack.amount]
      case 'kg': return ['mass', pack.amount * 1000]
      case 'g': return ['mass', pack.amount]
      case 'piece': return ['pieces', pack.amount]
      default: return null
    }
  }
  const left = base(declared)
  const right = base(nuxtPack)
  return left !== null && right !== null &&
    left[0] === right[0] &&
    Number.isSafeInteger(left[1] * 1_000_000) &&
    Number.isSafeInteger(right[1] * 1_000_000) &&
    Math.abs(left[1] - right[1]) <= 1e-9
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
        normalizeMoneyToCents(String(offer.Price)) !== cents ||
        (ld['@id'] !== undefined && ld['@id'] !== provenance.url + '#product') ||
        (offer.url !== undefined && offer.url !== provenance.url)) return fail()

    // A matching 85-cent pair is insufficient if JSON-LD declares a
    // different physical pack from the observed Nuxt product packaging.
    // Absence is permitted for the historical uppercase-only shape.
    if (Object.hasOwn(ld, 'weight') &&
        !corroboratesDeclaredWeight(ld.weight, pack)) return fail()

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
