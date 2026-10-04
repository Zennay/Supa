import type {
  RawProductObservation,
  SourcePageKind,
  SourceSnapshotRef,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'
import { normalizeMoneyToCents, normalizePackText } from './normalize.ts'

type JsonObject = Record<string, unknown>

type BoundedCaptureEvidence = {
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

type DekaMarktListingEvidenceBase = {
  version: 1
  source: SourceSnapshotRef & { id: string }
  captureEvidence: BoundedCaptureEvidence
  nuxtPayload: unknown[]
}

export type DekaMarktSsrCatalogEvidence = DekaMarktListingEvidenceBase & {
  evidenceType: 'dekamarkt-public-ssr-nuxt-catalog'
}

export type DekaMarktSsrOffersEvidence = DekaMarktListingEvidenceBase & {
  evidenceType: 'dekamarkt-public-ssr-nuxt-offers'
}

export type DekaMarktListingsParseResult =
  | {
      type: 'observations'
      observations: RawProductObservation[]
      abstained: number
    }
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

function dereference(payload: unknown[], ref: unknown): unknown {
  if (!Number.isInteger(ref) || (ref as number) < 0 || (ref as number) >= payload.length) {
    return undefined
  }
  return payload[ref as number]
}

function scalar(
  payload: unknown[],
  ref: unknown,
): string | number | boolean | null {
  const value = dereference(payload, ref)
  return ['string', 'number', 'boolean'].includes(typeof value) || value === null
    ? (value as string | number | boolean | null)
    : null
}

function positiveMoneyCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  const cents = normalizeMoneyToCents(String(value))
  return cents !== null && cents > 0 ? cents : null
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validateEvidenceBoundary(
  evidence: DekaMarktListingEvidenceBase & { evidenceType?: unknown },
  expectedType:
    | 'dekamarkt-public-ssr-nuxt-catalog'
    | 'dekamarkt-public-ssr-nuxt-offers',
  expectedKind: SourcePageKind,
): string | null {
  if (evidence?.version !== 1) {
    return 'DekaMarkt listing evidence must use version 1'
  }
  if (evidence.evidenceType !== expectedType) {
    return 'unexpected DekaMarkt listing evidence type'
  }
  if (
    !safeSourceId(evidence.source?.id) ||
    evidence.source.supermarket !== 'dekamarkt' ||
    evidence.source.kind !== expectedKind
  ) {
    return `DekaMarkt evidence must identify a safe ${expectedKind} source`
  }

  try {
    const url = new URL(evidence.source.url)
    if (url.protocol !== 'https:' || url.hostname !== 'www.dekamarkt.nl') {
      return 'DekaMarkt evidence source must use the public HTTPS host'
    }
  } catch {
    return 'DekaMarkt evidence source must contain a valid URL'
  }

  if (
    !validIso(evidence.source.capturedAt) ||
    !/^[a-f0-9]{64}$/.test(evidence.source.sha256)
  ) {
    return 'DekaMarkt evidence source provenance is incomplete'
  }

  const capture = evidence.captureEvidence
  const safety = capture?.safety
  if (
    !Number.isInteger(capture?.runId) ||
    capture.runId <= 0 ||
    !Number.isInteger(capture?.artifactId) ||
    capture.artifactId <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(capture?.artifactDigest ?? '') ||
    !/^[a-f0-9]{40}$/.test(capture?.supaSha ?? '') ||
    capture?.status !== 200 ||
    !capture?.contentType?.toLowerCase().includes('text/html') ||
    !Number.isInteger(capture?.bytes) ||
    capture.bytes <= 0 ||
    !safety ||
    safety.login !== false ||
    safety.credentials !== false ||
    safety.privateApiCalls !== false ||
    safety.antiBotBypass !== false ||
    safety.recursiveCrawl !== false ||
    safety.targetCount !== 3
  ) {
    return 'DekaMarkt evidence violates the bounded capture contract'
  }

  if (!Array.isArray(evidence.nuxtPayload)) {
    return 'DekaMarkt listing evidence has no Nuxt payload'
  }

  return null
}

function catalogProductRefs(payload: unknown[]): number[] | null {
  const candidates: number[][] = []

  for (const value of payload) {
    if (!isObject(value)) continue
    for (const [key, ref] of Object.entries(value)) {
      if (!/^webgroup-(?!filters-)/.test(key) || !Number.isInteger(ref)) continue
      const webgroup = dereference(payload, ref)
      if (!isObject(webgroup)) continue
      const products = dereference(payload, webgroup.products)
      if (
        Array.isArray(products) &&
        products.every((productRef) => Number.isInteger(productRef))
      ) {
        candidates.push(products as number[])
      }
    }
  }

  return candidates.length === 1 ? candidates[0] : null
}

function parseCatalogProduct(
  payload: unknown[],
  ref: number,
  source: SourceSnapshotRef,
): RawProductObservation | null {
  const product = dereference(payload, ref)
  if (!isObject(product)) return null

  const productId = scalar(payload, product.productId)
  const name = scalar(payload, product.headerText)
  const packaging = scalar(payload, product.packaging)
  const price = dereference(payload, product.price)

  if (
    !Number.isInteger(productId) ||
    typeof name !== 'string' ||
    !name.trim() ||
    typeof packaging !== 'string' ||
    !packaging.trim() ||
    !isObject(price)
  ) {
    return null
  }

  const isOffer = scalar(payload, price.isOffer)
  if (isOffer !== false) {
    // Catalog offer semantics are intentionally not inferred here. The offers
    // page has explicit offer records and is the authoritative M1 offer lane.
    return null
  }

  const normalPrice = scalar(payload, price.normalPrice)
  const currentPriceCents = positiveMoneyCents(normalPrice)
  const pack = normalizePackText(packaging)
  if (
    currentPriceCents === null ||
    pack.amount === null ||
    pack.unit === 'unknown'
  ) {
    return null
  }

  try {
    return validateRawProductObservation({
      supermarket: 'dekamarkt',
      sourceProductId: String(productId),
      name: name.trim(),
      currentPriceCents,
      currency: 'EUR',
      pack: {
        rawText: pack.rawText,
        amount: pack.amount,
        unit: pack.unit,
      },
      offer: null,
      availability: 'unknown',
      provenance: source,
    })
  } catch {
    return null
  }
}

function offerRecordRefs(payload: unknown[]): number[] | null {
  const overviewRefs: number[] = []
  for (const value of payload) {
    if (!isObject(value)) continue
    const ref = value['offers-overview-/aanbiedingen']
    if (Number.isInteger(ref)) overviewRefs.push(ref as number)
  }

  const unique = [...new Set(overviewRefs)]
  if (unique.length !== 1) return null

  const sections = dereference(payload, unique[0])
  if (!Array.isArray(sections) || !sections.every((ref) => Number.isInteger(ref))) {
    return null
  }

  const offers: number[] = []
  for (const sectionRef of sections) {
    const section = dereference(payload, sectionRef)
    if (!Array.isArray(section) || !section.every((ref) => Number.isInteger(ref))) {
      return null
    }
    offers.push(...(section as number[]))
  }

  return [...new Set(offers)]
}

function parseOfferProduct(
  payload: unknown[],
  offerRecord: JsonObject,
  productRef: number,
  source: SourceSnapshotRef,
): RawProductObservation | null {
  const outerOfferPrice = positiveMoneyCents(
    scalar(payload, offerRecord.offerPrice),
  )
  const outerNormalPrice = positiveMoneyCents(
    scalar(payload, offerRecord.normalPrice),
  )
  const label = scalar(payload, offerRecord.textPriceSign)
  const outerStart = scalar(payload, offerRecord.startDate)
  const outerEnd = scalar(payload, offerRecord.endDate)

  if (
    outerOfferPrice === null ||
    outerNormalPrice === null ||
    typeof label !== 'string' ||
    !label.trim() ||
    !validIso(outerStart) ||
    !validIso(outerEnd) ||
    Date.parse(outerStart) > Date.parse(outerEnd)
  ) {
    return null
  }

  const product = dereference(payload, productRef)
  if (!isObject(product)) return null

  const productId = scalar(payload, product.productId)
  const productNormalPrice = positiveMoneyCents(
    scalar(payload, product.normalPrice),
  )
  const productOfferPrice = positiveMoneyCents(
    scalar(payload, product.offerPrice),
  )
  const productStart = scalar(payload, product.startDate)
  const productEnd = scalar(payload, product.endDate)
  const information = dereference(payload, product.productInformation)

  if (
    !Number.isInteger(productId) ||
    productNormalPrice !== outerNormalPrice ||
    productOfferPrice !== outerOfferPrice ||
    !isObject(information)
  ) {
    // Weight products and other source-specific pricing transformations can
    // legitimately disagree here. M1 must abstain rather than guess them.
    return null
  }

  const informationProductId = scalar(payload, information.productId)
  const name = scalar(payload, information.headerText)
  const packaging = scalar(payload, information.packaging)

  if (
    informationProductId !== productId ||
    typeof name !== 'string' ||
    !name.trim() ||
    typeof packaging !== 'string' ||
    !packaging.trim()
  ) {
    return null
  }

  const validFrom = validIso(productStart) ? productStart : outerStart
  const validTo = validIso(productEnd) ? productEnd : outerEnd
  if (Date.parse(validFrom) > Date.parse(validTo)) return null

  const pack = normalizePackText(packaging)
  if (pack.amount === null || pack.unit === 'unknown') return null

  try {
    return validateRawProductObservation({
      supermarket: 'dekamarkt',
      sourceProductId: String(productId),
      name: name.trim(),
      currentPriceCents: productOfferPrice,
      currency: 'EUR',
      pack: {
        rawText: pack.rawText,
        amount: pack.amount,
        unit: pack.unit,
      },
      offer: {
        label: label.trim(),
        mechanics: null,
        offerPriceCents: productOfferPrice,
        originalPriceCents: productNormalPrice,
        validFrom,
        validTo,
      },
      availability: 'unknown',
      provenance: source,
    })
  } catch {
    return null
  }
}

export function parseDekaMarktSsrCatalogEvidence(
  evidence: DekaMarktSsrCatalogEvidence,
): DekaMarktListingsParseResult {
  const boundaryError = validateEvidenceBoundary(
    evidence,
    'dekamarkt-public-ssr-nuxt-catalog',
    'catalog',
  )
  if (boundaryError) return { type: 'abstain', reason: boundaryError }

  const productRefs = catalogProductRefs(evidence.nuxtPayload)
  if (!productRefs) {
    return {
      type: 'abstain',
      reason: 'DekaMarkt catalog has no unique observed webgroup product list',
    }
  }

  const observations = productRefs
    .map((ref) => parseCatalogProduct(evidence.nuxtPayload, ref, evidence.source))
    .filter((value): value is RawProductObservation => value !== null)

  if (observations.length === 0) {
    return {
      type: 'abstain',
      reason: 'DekaMarkt catalog yielded no trusted product observations',
    }
  }

  return {
    type: 'observations',
    observations,
    abstained: productRefs.length - observations.length,
  }
}

export function parseDekaMarktSsrOffersEvidence(
  evidence: DekaMarktSsrOffersEvidence,
): DekaMarktListingsParseResult {
  const boundaryError = validateEvidenceBoundary(
    evidence,
    'dekamarkt-public-ssr-nuxt-offers',
    'offers',
  )
  if (boundaryError) return { type: 'abstain', reason: boundaryError }

  const offerRefs = offerRecordRefs(evidence.nuxtPayload)
  if (!offerRefs) {
    return {
      type: 'abstain',
      reason: 'DekaMarkt offers have no unique observed overview structure',
    }
  }

  const observations: RawProductObservation[] = []
  let candidateCount = 0

  for (const offerRef of offerRefs) {
    const offerRecord = dereference(evidence.nuxtPayload, offerRef)
    if (!isObject(offerRecord)) {
      candidateCount += 1
      continue
    }

    const products = dereference(evidence.nuxtPayload, offerRecord.products)
    if (!Array.isArray(products) || !products.every((ref) => Number.isInteger(ref))) {
      candidateCount += 1
      continue
    }

    for (const productRef of products as number[]) {
      candidateCount += 1
      const observation = parseOfferProduct(
        evidence.nuxtPayload,
        offerRecord,
        productRef,
        evidence.source,
      )
      if (observation) observations.push(observation)
    }
  }

  if (observations.length === 0) {
    return {
      type: 'abstain',
      reason: 'DekaMarkt offers yielded no trusted product observations',
    }
  }

  return {
    type: 'observations',
    observations,
    abstained: candidateCount - observations.length,
  }
}
