import type {
  RawProductObservation,
  SourcePageKind,
  SourceSnapshotRef,
} from './ingestion.ts'
import { validateRawProductObservation } from './ingestion.ts'
import { normalizeMoneyToCents, normalizePackText } from './normalize.ts'

export const PLUS_RENDERED_LISTING_SELECTORS = {
  cardAnchor: 'a[href^="/product/"]',
  catalogBlock: 'ProductList.ProductItem',
  offersBlock: 'PromotionListFlow.OfferItem',
  name: '.plp-item-name h3 span[data-expression]',
  pack: '.plp-item-complementary span[data-expression]',
  priceInteger: '.product-header-price-integer',
  priceDecimals: '.product-header-price-decimals',
  previousPrice: '.product-header-price-previous',
} as const

type SelectorContract = typeof PLUS_RENDERED_LISTING_SELECTORS

export type PlusRenderedListingCard = {
  block: string
  href: string
  name: string
  packText: string
  priceInteger: string
  priceDecimals: string
  previousPriceText: string
}

type PlusRenderedListingEvidenceBase = {
  version: 1
  source: SourceSnapshotRef & { id: string }
  browserEvidence: {
    runId: number
    artifactId: number
    artifactDigest: string
    supaSha: string
    renderedHtmlSha256: string
    renderedHtmlBytes: number
    screenshotBytes: number
    browser: string
    driver: string
    observedProductLinkCount: number
    selectorContract: SelectorContract
    safety: {
      login: false
      credentials: false
      privateApiCalls: false
      networkInterception: false
      antiBotBypass: false
      recursiveCrawl: false
      targetCount: 2
    }
  }
  cards: PlusRenderedListingCard[]
}

export type PlusRenderedCatalogEvidence = PlusRenderedListingEvidenceBase & {
  evidenceType: 'plus-browser-rendered-catalog'
}

export type PlusRenderedOffersEvidence = PlusRenderedListingEvidenceBase & {
  evidenceType: 'plus-browser-rendered-offers'
}

export type PlusRenderedListingsParseResult =
  | {
      type: 'observations'
      observations: RawProductObservation[]
      abstained: number
    }
  | { type: 'abstain'; reason: string }

function safeSourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  )
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
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

function validCapturedAt(value: unknown): value is string {
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
    if (offsetHour > 23 || offsetMinute > 59) return false
  }

  return Number.isFinite(Date.parse(value))
}

function selectorContractMatches(value: unknown): value is SelectorContract {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return Object.entries(PLUS_RENDERED_LISTING_SELECTORS).every(
    ([key, expected]) => candidate[key] === expected,
  )
}

function validHttpsPlusUrl(
  value: unknown,
  expectedKind: SourcePageKind,
): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'www.plus.nl' ||
      url.port ||
      url.username ||
      url.password
    ) {
      return false
    }

    const expectedRoute =
      expectedKind === 'catalog' ? '/producten' : '/aanbiedingen'
    return (
      url.pathname === expectedRoute ||
      url.pathname.startsWith(`${expectedRoute}/`)
    )
  } catch {
    return false
  }
}

function validateEvidenceBoundary(
  evidence: PlusRenderedListingEvidenceBase & { evidenceType?: unknown },
  expectedType:
    | 'plus-browser-rendered-catalog'
    | 'plus-browser-rendered-offers',
  expectedKind: SourcePageKind,
): string | null {
  if (evidence?.version !== 1) {
    return 'PLUS rendered listing evidence must use version 1'
  }
  if (evidence.evidenceType !== expectedType) {
    return 'unexpected PLUS rendered listing evidence type'
  }
  if (
    !safeSourceId(evidence.source?.id) ||
    evidence.source.supermarket !== 'plus' ||
    evidence.source.kind !== expectedKind ||
    !validHttpsPlusUrl(evidence.source.url, expectedKind) ||
    !validCapturedAt(evidence.source.capturedAt) ||
    !/^[a-f0-9]{64}$/.test(evidence.source.sha256)
  ) {
    return `PLUS rendered evidence must identify a valid ${expectedKind} source`
  }

  const browserEvidence = evidence.browserEvidence
  const safety = browserEvidence?.safety
  if (
    !safePositiveInteger(browserEvidence?.runId) ||
    !safePositiveInteger(browserEvidence?.artifactId) ||
    !/^sha256:[a-f0-9]{64}$/.test(browserEvidence?.artifactDigest ?? '') ||
    !/^[a-f0-9]{40}$/.test(browserEvidence?.supaSha ?? '') ||
    browserEvidence?.renderedHtmlSha256 !== evidence.source.sha256 ||
    !safePositiveInteger(browserEvidence?.renderedHtmlBytes) ||
    !safePositiveInteger(browserEvidence?.screenshotBytes) ||
    typeof browserEvidence?.browser !== 'string' ||
    !browserEvidence.browser.trim() ||
    typeof browserEvidence?.driver !== 'string' ||
    !browserEvidence.driver.trim() ||
    !safePositiveInteger(browserEvidence?.observedProductLinkCount) ||
    !selectorContractMatches(browserEvidence?.selectorContract) ||
    !safety ||
    safety.login !== false ||
    safety.credentials !== false ||
    safety.privateApiCalls !== false ||
    safety.networkInterception !== false ||
    safety.antiBotBypass !== false ||
    safety.recursiveCrawl !== false ||
    safety.targetCount !== 2
  ) {
    return 'PLUS rendered evidence violates the bounded browser trust contract'
  }

  if (
    !Array.isArray(evidence.cards) ||
    evidence.cards.length === 0 ||
    evidence.cards.length > browserEvidence.observedProductLinkCount
  ) {
    return 'PLUS rendered evidence has an invalid reviewed card sample'
  }

  return null
}

function productIdFromHref(href: string): string | null {
  if (typeof href !== 'string' || !href.startsWith('/product/')) return null

  try {
    const url = new URL(href, 'https://www.plus.nl')
    if (
      url.origin !== 'https://www.plus.nl' ||
      !url.pathname.startsWith('/product/')
    ) {
      return null
    }

    const match = url.pathname.match(/-(\d+)$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function currentPriceCents(card: PlusRenderedListingCard): number | null {
  const integer = card.priceInteger.trim()
  const decimals = card.priceDecimals.trim()
  if (!/^\d+\.$/.test(integer) || !/^\d{2}$/.test(decimals)) return null
  const cents = normalizeMoneyToCents(`${integer}${decimals}`)
  return cents !== null && cents > 0 ? cents : null
}

function normalizedPack(card: PlusRenderedListingCard) {
  const exact = card.packText.trim()
  if (!/^Per\s+/i.test(exact)) return null
  const normalized = normalizePackText(exact.replace(/^Per\s+/i, ''))
  if (normalized.amount === null || normalized.unit === 'unknown') return null
  return {
    rawText: exact,
    amount: normalized.amount,
    unit: normalized.unit,
  }
}

function validReviewedCard(
  card: PlusRenderedListingCard,
  expectedBlock: string,
): boolean {
  return (
    Boolean(card) &&
    typeof card === 'object' &&
    card.block === expectedBlock &&
    typeof card.href === 'string' &&
    typeof card.name === 'string' &&
    Boolean(card.name.trim()) &&
    typeof card.packText === 'string' &&
    typeof card.priceInteger === 'string' &&
    typeof card.priceDecimals === 'string' &&
    typeof card.previousPriceText === 'string'
  )
}

function parseCatalogCard(
  card: PlusRenderedListingCard,
  source: SourceSnapshotRef,
): RawProductObservation | null {
  if (!validReviewedCard(card, PLUS_RENDERED_LISTING_SELECTORS.catalogBlock)) {
    return null
  }

  const sourceProductId = productIdFromHref(card.href)
  const priceCents = currentPriceCents(card)
  const pack = normalizedPack(card)
  if (
    !sourceProductId ||
    priceCents === null ||
    !pack ||
    card.previousPriceText.trim()
  ) {
    return null
  }

  try {
    return validateRawProductObservation({
      supermarket: 'plus',
      sourceProductId,
      name: card.name.trim(),
      currentPriceCents: priceCents,
      currency: 'EUR',
      pack,
      offer: null,
      availability: 'unknown',
      provenance: source,
    })
  } catch {
    return null
  }
}

function parseOffersCard(
  card: PlusRenderedListingCard,
  source: SourceSnapshotRef,
): RawProductObservation | null {
  if (!validReviewedCard(card, PLUS_RENDERED_LISTING_SELECTORS.offersBlock)) {
    return null
  }

  const sourceProductId = productIdFromHref(card.href)
  const offerPriceCents = currentPriceCents(card)
  const previousPriceText = card.previousPriceText.trim()
  const originalPriceCents = normalizeMoneyToCents(previousPriceText)
  const pack = normalizedPack(card)

  if (
    !sourceProductId ||
    offerPriceCents === null ||
    originalPriceCents === null ||
    originalPriceCents <= offerPriceCents ||
    !pack
  ) {
    return null
  }

  try {
    return validateRawProductObservation({
      supermarket: 'plus',
      sourceProductId,
      name: card.name.trim(),
      currentPriceCents: offerPriceCents,
      currency: 'EUR',
      pack,
      offer: {
        // This is a deterministic description of the exact observed price
        // transition. Promotion mechanics and validity are deliberately not
        // inferred from surrounding campaign text.
        label: `${card.priceInteger.trim()}${card.priceDecimals.trim()} / ${previousPriceText}`,
        mechanics: null,
        offerPriceCents,
        originalPriceCents,
        validFrom: null,
        validTo: null,
      },
      availability: 'unknown',
      provenance: source,
    })
  } catch {
    return null
  }
}

export function parsePlusRenderedCatalogEvidence(
  evidence: PlusRenderedCatalogEvidence,
): PlusRenderedListingsParseResult {
  const boundaryError = validateEvidenceBoundary(
    evidence,
    'plus-browser-rendered-catalog',
    'catalog',
  )
  if (boundaryError) return { type: 'abstain', reason: boundaryError }

  const observations = evidence.cards
    .map((card) => parseCatalogCard(card, evidence.source))
    .filter((value): value is RawProductObservation => value !== null)

  if (observations.length === 0) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered catalog yielded no trusted product observations',
    }
  }

  return {
    type: 'observations',
    observations,
    abstained: evidence.cards.length - observations.length,
  }
}

export function parsePlusRenderedOffersEvidence(
  evidence: PlusRenderedOffersEvidence,
): PlusRenderedListingsParseResult {
  const boundaryError = validateEvidenceBoundary(
    evidence,
    'plus-browser-rendered-offers',
    'offers',
  )
  if (boundaryError) return { type: 'abstain', reason: boundaryError }

  const observations = evidence.cards
    .map((card) => parseOffersCard(card, evidence.source))
    .filter((value): value is RawProductObservation => value !== null)

  if (observations.length === 0) {
    return {
      type: 'abstain',
      reason: 'PLUS rendered offers yielded no trusted product observations',
    }
  }

  return {
    type: 'observations',
    observations,
    abstained: evidence.cards.length - observations.length,
  }
}

/**
 * Browser-only projection helper for exact rendered evidence.
 *
 * The selectors are intentionally exported and versioned because they were
 * derived from the captured PLUS listing DOM, not guessed before capture.
 */
export function projectPlusRenderedListingCard(
  anchor: Element,
  kind: 'catalog' | 'offers',
): PlusRenderedListingCard | null {
  const expectedBlock =
    kind === 'catalog'
      ? PLUS_RENDERED_LISTING_SELECTORS.catalogBlock
      : PLUS_RENDERED_LISTING_SELECTORS.offersBlock

  const block = anchor.closest(`[data-block="${expectedBlock}"]`)
  if (!block) return null

  const href = anchor.getAttribute('href') ?? ''
  const name =
    block.querySelector(PLUS_RENDERED_LISTING_SELECTORS.name)?.textContent ?? ''
  const pack =
    block.querySelector(PLUS_RENDERED_LISTING_SELECTORS.pack)?.textContent ?? ''
  const integer =
    block.querySelector(PLUS_RENDERED_LISTING_SELECTORS.priceInteger)?.textContent ?? ''
  const decimals =
    block.querySelector(PLUS_RENDERED_LISTING_SELECTORS.priceDecimals)?.textContent ?? ''
  const previous =
    block.querySelector(PLUS_RENDERED_LISTING_SELECTORS.previousPrice)?.textContent ?? ''

  return {
    block: expectedBlock,
    href: href.trim(),
    name: name.trim(),
    packText: pack.trim(),
    priceInteger: integer.trim(),
    priceDecimals: decimals.trim(),
    previousPriceText: previous.trim(),
  }
}
