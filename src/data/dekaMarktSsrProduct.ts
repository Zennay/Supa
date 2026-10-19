import type {
  RawProductObservation,
  SourceSnapshotRef,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'
import { normalizeMoneyToCents, normalizePackText } from './normalize.ts'
import { normalizeSchemaOrgAvailability } from './schemaOrgProduct.ts'

type JsonObject = Record<string, unknown>

export type DekaMarktSsrProductEvidence = {
  version: 1
  evidenceType: 'dekamarkt-public-ssr-nuxt-product'
  source: SourceSnapshotRef & { id: string }
  captureEvidence: {
    runId: number
    artifactId: number
    artifactDigest: string
    supaSha: string
    status: number
    contentType: string
    bytes: number
    safety: {
      login: false
      credentials: false
      privateApiCalls: false
      antiBotBypass: false
      recursiveCrawl: false
      targetCount: 3
    }
  }
  nuxtPayload: unknown[]
  jsonLdProduct: unknown
}

export type DekaMarktParseResult =
  | { type: 'observation'; observation: RawProductObservation }
  | { type: 'abstain'; reason: string }

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function safeSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function safeArtifactDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value)
}

function safeSupaSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function safeCapturedAt(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !validCalendarDate(match[1])) return false

  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return false

  if (match[5] !== 'Z') {
    const [offsetHour, offsetMinute] = match[5]
      .slice(1)
      .split(':')
      .map(Number)
    // Physical civil offsets: UTC−12:00..UTC+14:00 (asymmetric).
    // JS Date.parse can accept −13/−14 even though no civil zone can.
    const upper = match[5][0] === '-' ? 12 : 14
    if (offsetHour > upper || offsetMinute > 59 ||
        (offsetHour === upper && offsetMinute !== 0)) return false
  }

  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return false
  // The product adapters must apply the same ±60s future skew rule as
  // catalog/offers capture ingestion, with the original 1–9 fractional
  // digits retained rather than silently accepting a future sub-ms tick.
  const fraction = /\.(\d{1,9})(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1] ?? ''
  const capturedNs = BigInt(millis) * 1_000_000n +
    BigInt((fraction.padEnd(9, '0').slice(3)) || '0')
  return capturedNs <= BigInt(Date.now() + 60_000) * 1_000_000n
}

function safeHtmlContentType(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'text/html'
}

function safeDekaMarktProductUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'www.dekamarkt.nl' &&
      url.port === '' &&
      url.pathname.startsWith('/producten/') &&
      url.pathname.length > '/producten/'.length &&
      // Evidence must be the exact bare, canonical public product page.
      // A query, fragment, credential or ambiguous URL cannot gain a
      // verified-SKU identity just by appearing in both source/JSON-LD.
      url.href === value &&
      !/[?#]/u.test(value) &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

function dekaMarktProductIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/(\d+)\/?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Deka's Nuxt amount is the independent current-package reference.
 * Every explicitly written JSON-LD price and currency must corroborate it,
 * not merely the historical uppercase Price spelling. Case variants cannot
 * hide an alternative SKU amount or contradictory availability statement.
 */
function corroborateDekaOffer(offer: JsonObject, expectedCents: number): boolean {
  let sawPrice = false
  let sawEuroCurrency = false
  const availabilities: string[] = []
  for (const [key, value] of Object.entries(offer)) {
    const kind = key.toLocaleLowerCase('en')
    if (kind === 'price') {
      sawPrice = true
      if ((typeof value !== 'string' && typeof value !== 'number') ||
          normalizeMoneyToCents(String(value)) !== expectedCents) return false
    } else if (kind === 'pricecurrency') {
      sawEuroCurrency = true
      if (typeof value !== 'string' || value !== 'EUR') return false
    } else if (kind === 'availability') {
      if (typeof value !== 'string' || !value.trim()) return false
      availabilities.push(value)
    }
  }
  if (!sawPrice || !sawEuroCurrency) return false
  const known = availabilities.map(normalizeSchemaOrgAvailability)
  if (known.length > 0 && (known.includes('unknown') ||
      new Set(known).size !== 1)) return false
  return true
}

function dereference(payload: unknown[], ref: unknown): unknown {
  if (!Number.isInteger(ref) || (ref as number) < 0 || (ref as number) >= payload.length) {
    return undefined
  }
  return payload[ref as number]
}

function scalar(payload: unknown[], ref: unknown): string | number | boolean | null {
  const value = dereference(payload, ref)
  return ['string', 'number', 'boolean'].includes(typeof value) || value === null
    ? (value as string | number | boolean | null)
    : null
}

function oneProductInformationRef(payload: unknown[]): number | null {
  const refs: number[] = []
  for (const value of payload) {
    if (!isObject(value)) continue
    for (const [key, ref] of Object.entries(value)) {
      if (/^product-information-\d+$/.test(key) && Number.isInteger(ref)) {
        refs.push(ref as number)
      }
    }
  }
  const unique = [...new Set(refs)]
  return unique.length === 1 ? unique[0] : null
}

export function parseDekaMarktSsrProductEvidence(
  evidence: DekaMarktSsrProductEvidence,
): DekaMarktParseResult {
  if (evidence?.version !== 1) {
    return { type: 'abstain', reason: 'DekaMarkt SSR evidence must use version 1' }
  }
  if (evidence.evidenceType !== 'dekamarkt-public-ssr-nuxt-product') {
    return { type: 'abstain', reason: 'unexpected DekaMarkt SSR evidence type' }
  }
  if (
    !safeSourceId(evidence.source?.id) ||
    evidence.source.supermarket !== 'dekamarkt' ||
    evidence.source.kind !== 'product'
  ) {
    return { type: 'abstain', reason: 'DekaMarkt evidence must identify a safe product source' }
  }
  if (
    !safeDekaMarktProductUrl(evidence.source.url) ||
    !safeCapturedAt(evidence.source.capturedAt) ||
    !safeSha256(evidence.source.sha256)
  ) {
    return { type: 'abstain', reason: 'DekaMarkt evidence has invalid source provenance' }
  }
  if (
    !safePositiveInteger(evidence.captureEvidence?.runId) ||
    !safePositiveInteger(evidence.captureEvidence?.artifactId) ||
    !safeArtifactDigest(evidence.captureEvidence?.artifactDigest) ||
    !safeSupaSha(evidence.captureEvidence?.supaSha) ||
    !safePositiveInteger(evidence.captureEvidence?.bytes)
  ) {
    return { type: 'abstain', reason: 'DekaMarkt evidence has invalid capture artifact identity' }
  }

  const safety = evidence.captureEvidence?.safety
  if (
    evidence.captureEvidence?.status !== 200 ||
    !safeHtmlContentType(evidence.captureEvidence?.contentType) ||
    !safety ||
    safety.login !== false ||
    safety.credentials !== false ||
    safety.privateApiCalls !== false ||
    safety.antiBotBypass !== false ||
    safety.recursiveCrawl !== false ||
    safety.targetCount !== 3
  ) {
    return { type: 'abstain', reason: 'DekaMarkt evidence violates the bounded capture contract' }
  }

  const payload = evidence.nuxtPayload
  if (!Array.isArray(payload)) {
    return { type: 'abstain', reason: 'DekaMarkt SSR evidence has no Nuxt payload' }
  }

  const productRef = oneProductInformationRef(payload)
  const product = productRef === null ? null : dereference(payload, productRef)
  if (!isObject(product)) {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt payload has no unique product-information record' }
  }

  const productId = scalar(payload, product.productId)
  const name = scalar(payload, product.headerText)
  const packaging = scalar(payload, product.packaging)
  const assortment = dereference(payload, product.productAssortment)

  if (
    !safePositiveInteger(productId) ||
    typeof name !== 'string' ||
    !name.trim() ||
    typeof packaging !== 'string' ||
    !isObject(assortment)
  ) {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt product fields are incomplete' }
  }

  const expectedProductId = dekaMarktProductIdFromUrl(evidence.source.url)
  if (expectedProductId === null || String(productId) !== expectedProductId) {
    return {
      type: 'abstain',
      reason: 'DekaMarkt product identity does not match source URL',
    }
  }

  const assortmentProductId = scalar(payload, assortment.productId)
  const normalPrice = scalar(payload, assortment.normalPrice)
  const offerPrice = scalar(payload, assortment.offerPrice)
  if (assortmentProductId !== productId) {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt product/assortment identity mismatch' }
  }

  // Zero is the documented no-offer sentinel. A malformed offer field is
  // not evidence that the normal price is a trustworthy current price.
  if (
    typeof offerPrice !== 'number' ||
    !Number.isFinite(offerPrice) ||
    offerPrice < 0
  ) {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt offer price is malformed' }
  }

  const selectedPrice = offerPrice > 0 ? offerPrice : normalPrice
  const currentPriceCents =
    typeof selectedPrice === 'number'
      ? normalizeMoneyToCents(String(selectedPrice))
      : null
  if (currentPriceCents === null || currentPriceCents <= 0) {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt price is missing or invalid' }
  }

  const normalizedPack = normalizePackText(packaging)
  if (normalizedPack.amount === null || normalizedPack.unit === 'unknown') {
    return { type: 'abstain', reason: 'DekaMarkt Nuxt packaging is not safely normalizable' }
  }

  const jsonLd = isObject(evidence.jsonLdProduct) ? evidence.jsonLdProduct : null
  const offers = jsonLd && isObject(jsonLd.offers) ? jsonLd.offers : null
  const jsonName = typeof jsonLd?.name === 'string' ? jsonLd.name.trim() : null
  const jsonMpn =
    typeof jsonLd?.mpn === 'string' || typeof jsonLd?.mpn === 'number'
      ? String(jsonLd.mpn)
      : null
  const observedCapitalPrice = offers?.Price
  const declaredUrl = jsonLd?.url

  if (
    !jsonLd ||
    jsonLd['@type'] !== 'Product' ||
    jsonName !== name ||
    jsonMpn !== String(productId) ||
    (declaredUrl !== undefined && (!safeDekaMarktProductUrl(declaredUrl) ||
      declaredUrl !== evidence.source.url)) ||
    !offers ||
    typeof observedCapitalPrice !== 'number' ||
    !corroborateDekaOffer(offers, currentPriceCents)
  ) {
    return { type: 'abstain', reason: 'DekaMarkt JSON-LD does not corroborate Nuxt source, identity, price, currency or availability' }
  }

  const observation: RawProductObservation = {
    supermarket: 'dekamarkt',
    sourceProductId: String(productId),
    name,
    currentPriceCents,
    currency: 'EUR',
    pack: {
      rawText: normalizedPack.rawText,
      amount: normalizedPack.amount,
      unit: normalizedPack.unit,
    },
    offer: null,
    availability: normalizeSchemaOrgAvailability(offers?.availability),
    provenance: evidence.source,
  }

  try {
    return {
      type: 'observation',
      observation: validateRawProductObservation(observation),
    }
  } catch (error) {
    return {
      type: 'abstain',
      reason: `DekaMarkt observation failed trust validation: ${
        error instanceof Error ? error.message : 'unknown validation failure'
      }`,
    }
  }
}
