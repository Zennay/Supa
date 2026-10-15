import { matchIngredient, type IngredientRequirement, type ProductCandidate } from './matching.ts'
import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'
import { normalizePackText } from '../data/normalize.ts'
import { validateRawProductObservation, type RawProductObservation } from '../data/ingestion.ts'

type Shop = 'plus' | 'dekamarkt'
const SHOPS: Shop[] = ['plus', 'dekamarkt']
const DAY = 24 * 60 * 60 * 1000

export type CatalogLine = {
  status: 'matched' | 'availability_unknown' | 'unknown'
  productName: string | null
  productId: string | null
  packs: number | null
  packPriceCents: number | null
  totalCents: number | null
  sourceUrl: string | null
  capturedAt: string | null
}

export type CatalogComparison = {
  provenance: 'offline-snapshot-preview'
  claimable: false
  comparable: boolean
  reason: string | null
  stores: Record<Shop, { subtotalCents: number | null; complete: boolean }>
  lines: Array<{
    ingredientId: string
    ingredient: string
    plus: CatalogLine
    dekamarkt: CatalogLine
    differenceCents: number | null
  }>
  cheaperStore: Shop | 'equal' | null
  savingsCents: number | null
}

type Candidate = ProductCandidate & {
  priceCents: number
  original: RawProductObservation
}

/**
 * Compare an identical set of ingredient demands against offline snapshots.
 * This never upgrades imported snapshots to publicly verifiable live prices.
 * A missing, stale, ambiguous or unsafe ingredient prevents a basket winner.
 */
export function compareReviewedCatalogs({
  requirements,
  observations,
  nowMs,
}: {
  requirements: IngredientRequirement[]
  observations: RawProductObservation[]
  nowMs: number
}): CatalogComparison {
  if (!Array.isArray(requirements) || requirements.length === 0 ||
      requirements.length > 500 || !Array.isArray(observations) ||
      observations.length > 10000 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('Invalid comparison input')
  }

  const seenRequirements = new Set<string>()
  for (const required of requirements) {
    if (!required || typeof required.id !== 'string' || !required.id.trim() ||
        typeof required.query !== 'string' || !required.query.trim() ||
        seenRequirements.has(required.id)) {
      throw new Error('Invalid or duplicate ingredient requirement')
    }
    seenRequirements.add(required.id)
  }

  const catalog: Record<Shop, Candidate[]> = { plus: [], dekamarkt: [] }
  const observedTimes: number[] = []
  const seenProducts = new Set<string>()
  let sourceTrusted = true

  for (const raw of observations) {
    try {
      validateRawProductObservation(raw)
    } catch {
      sourceTrusted = false
      continue
    }
    if (raw.supermarket !== 'plus' && raw.supermarket !== 'dekamarkt') {
      sourceTrusted = false
      continue
    }
    const time = Date.parse(raw.provenance.capturedAt)
    // Date.parse truncates >3 fractional-second digits. A timestamp with a
    // positive nanosecond remainder at nowMs is strictly in the future.
    const subMs = /[.][0-9]{3}([0-9]+)(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.exec(
      raw.provenance.capturedAt,
    )
    const strictlyFuture = time > nowMs ||
      (time === nowMs && subMs !== null && /[1-9]/.test(subMs[1]))
    if (!Number.isFinite(time) || strictlyFuture ||
        nowMs - time > DAY) {
      sourceTrusted = false
      continue
    }
    // An Offer may advertise a future or expired price. Its snapshot time
    // being recent is not proof that this exact checkout price is valid now.
    // Invalid or contradictory dates also withhold the entire basket winner.
    if (raw.offer) {
      const { validFrom, validTo } = raw.offer
      const parseBound = (value: string, isEnd: boolean) =>
        // Schema.org date-only priceValidUntil is inclusive through the UTC day.
        Date.parse(isEnd && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
          ? value + 'T23:59:59.999Z' : value)
      const from = validFrom === null ? null : parseBound(validFrom, false)
      const to = validTo === null ? null : parseBound(validTo, true)
      if ((from !== null && (!Number.isFinite(from) || from > nowMs)) ||
          (to !== null && (!Number.isFinite(to) || to < nowMs)) ||
          (from !== null && to !== null && from > to)) {
        sourceTrusted = false
        continue
      }
    }
    observedTimes.push(time)

    // Inventory contradictions matter even when one copy says "unavailable".
    // Deduplicate identities before the price/stock usability filter.
    if (typeof raw.sourceProductId === 'string' && raw.sourceProductId.trim()) {
      const productKey = raw.supermarket + ':' + raw.sourceProductId
      if (seenProducts.has(productKey)) {
        sourceTrusted = false
        continue
      }
      seenProducts.add(productKey)
    }

    if (raw.availability === 'unavailable' ||
        !Number.isSafeInteger(raw.currentPriceCents) ||
        raw.currentPriceCents === null || raw.currentPriceCents < 0 ||
        typeof raw.sourceProductId !== 'string' || !raw.sourceProductId.trim()) {
      continue
    }
    const parsed = normalizePackText(raw.pack.rawText)
    if (raw.pack.amount !== null && raw.pack.unit !== 'unknown' &&
        parsed.amount !== null && parsed.unit !== 'unknown') {
      // Numeric source quantities and recognizable label quantities must
      // describe the same physical unit, not contradictory package sizes.
      const physical = (amount: number, unit: string): [string, number] => {
        if (unit === 'kg' || unit === 'g') {
          return ['mass', amount * (unit === 'kg' ? 1000 : 1)]
        }
        if (unit === 'l' || unit === 'ml') {
          return ['volume', amount * (unit === 'l' ? 1000 : 1)]
        }
        return [unit, amount]
      }
      const declared = physical(raw.pack.amount, raw.pack.unit)
      const label = physical(parsed.amount, parsed.unit)
      if (declared[0] !== label[0] || declared[1] !== label[1]) {
        sourceTrusted = false
        continue
      }
    }
    const packAmount = raw.pack.amount ?? parsed.amount
    const packUnit = raw.pack.unit === 'unknown' ? parsed.unit : raw.pack.unit
    const packCount = parsed.count

    if (packUnit === 'unknown' || packUnit === 'pack' ||
        packAmount === null || !Number.isFinite(packAmount) || packAmount <= 0 ||
        !Number.isSafeInteger(packCount) || packCount <= 0) continue

    catalog[raw.supermarket].push({
      id: raw.sourceProductId,
      name: raw.name,
      packAmount,
      packUnit,
      packCount,
      available: true,
      priceCents: raw.currentPriceCents,
      original: raw,
    })
  }

  if (observedTimes.length > 0 &&
      Math.max(...observedTimes) - Math.min(...observedTimes) > DAY) {
    sourceTrusted = false
  }

  const unknown = (): CatalogLine => ({
    status: 'unknown', productName: null, productId: null, packs: null,
    packPriceCents: null, totalCents: null, sourceUrl: null, capturedAt: null,
  })

  const resolve = (required: IngredientRequirement, shop: Shop): CatalogLine => {
    if (!Number.isFinite(required.amount) || required.amount === null ||
        required.amount <= 0) return unknown()
    try {
      const decision = matchIngredient(required, catalog[shop])
      if (decision.type !== 'match') return unknown()
      const matches = catalog[shop].filter((p) => p.id === decision.productId)
      if (matches.length !== 1) return unknown()
      const item = matches[0]
      const packs = calculateDecimalPackCount(
        [{ amount: required.amount, unit: required.unit }],
        { amount: item.packAmount!, unit: item.packUnit, count: item.packCount! },
      )
      if (packs === null || !Number.isSafeInteger(packs) || packs <= 0) return unknown()
      const total = packs * item.priceCents
      if (!Number.isSafeInteger(total) || total < 0) return unknown()
      return {
        status: item.original.availability === 'available' ? 'matched' : 'availability_unknown',
        productName: item.name, productId: item.id,
        packs, packPriceCents: item.priceCents, totalCents: total,
        sourceUrl: item.original.provenance.url,
        capturedAt: item.original.provenance.capturedAt,
      }
    } catch {
      return unknown()
    }
  }

  const lines = requirements.map((required) => {
    const plus = resolve(required, 'plus')
    const dekamarkt = resolve(required, 'dekamarkt')
    return {
      ingredientId: required.id,
      ingredient: required.query,
      plus,
      dekamarkt,
      differenceCents: plus.totalCents !== null && dekamarkt.totalCents !== null
        ? dekamarkt.totalCents - plus.totalCents : null,
    }
  })

  // Two distinct ingredient lines can select the same *physical* SKU.
  // Rounding each demand independently would charge that one package twice.
  // Until a shared-pack allocation can be displayed transparently, withhold
  // those line costs and the entire winner rather than inventing savings.
  for (const shop of SHOPS) {
    const seenLineProducts = new Set<string>()
    const sharedLineProducts = new Set<string>()
    for (const line of lines) {
      if (line[shop].status !== 'matched' || !line[shop].productId) continue
      const id = line[shop].productId
      if (seenLineProducts.has(id)) sharedLineProducts.add(id)
      seenLineProducts.add(id)
    }
    if (sharedLineProducts.size > 0) {
      sourceTrusted = false
      for (const line of lines) {
        if (line[shop].productId && sharedLineProducts.has(line[shop].productId)) {
          line[shop] = unknown()
          line.differenceCents = null
        }
      }
    }
  }

  const storeSummaries = Object.fromEntries(SHOPS.map((shop) => {
    const complete = sourceTrusted && lines.every((line) => line[shop].status === 'matched')
    const values = lines.map((line) => line[shop].totalCents)
    const subtotal = values.reduce<number>((sum, value) =>
      value !== null && Number.isSafeInteger(sum + value) ? sum + value : Number.NaN, 0)
    return [shop, {
      subtotalCents: Number.isSafeInteger(subtotal) ? subtotal : null,
      complete: complete && Number.isSafeInteger(subtotal),
    }]
  })) as CatalogComparison['stores']

  const comparable = storeSummaries.plus.complete && storeSummaries.dekamarkt.complete
  const difference = comparable
    ? storeSummaries.dekamarkt.subtotalCents! - storeSummaries.plus.subtotalCents!
    : null
  const safeDifference = difference !== null && Number.isSafeInteger(difference)
    ? difference : null
  const safeComparable = comparable && safeDifference !== null
  return {
    provenance: 'offline-snapshot-preview',
    claimable: false,
    comparable: safeComparable,
    reason: !sourceTrusted ? 'invalid_or_stale_source' :
      !safeComparable ? 'missing_or_ambiguous_product' : null,
    stores: storeSummaries,
    lines,
    cheaperStore: !safeComparable ? null :
      safeDifference! > 0 ? 'plus' : safeDifference! < 0 ? 'dekamarkt' : 'equal',
    savingsCents: safeComparable ? Math.abs(safeDifference!) : null,
  }
}
