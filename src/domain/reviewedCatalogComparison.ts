import { matchIngredient, type IngredientRequirement, type ProductCandidate } from './matching.ts'
import { calculateDecimalPackCount } from './decimalPackArithmetic.ts'
import { normalizePackText } from '../data/normalize.ts'
import { priceInstantNs } from '../data/schemaOrgProduct.ts'
import { validateRawProductObservation, type RawProductObservation } from '../data/ingestion.ts'

type Shop = 'plus' | 'dekamarkt'
const SHOPS: Shop[] = ['plus', 'dekamarkt']
const DAY_NS = 24n * 60n * 60n * 1_000_000_000n

export type CatalogLine = {
  status: 'matched' | 'availability_unknown' | 'unknown'
  productName: string | null
  productId: string | null
  packs: number | null
  packPriceCents: number | null
  totalCents: number | null
  sourceUrl: string | null
  capturedAt: string | null
  /** First line's purchase covers all listed ingredient IDs, not separate packs. */
  sharedPackCoversIngredientIds?: string[]
  /** This line is covered by a shared purchase charged on that ingredient ID. */
  sharedPackWithIngredientId?: string
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
  const observedTimes: bigint[] = []
  const nowNs = BigInt(nowMs) * 1_000_000n
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
    // Raw observations can enter through the public domain API without
    // passing the Schema.org parser. Do not let Date.parse truncate +1ns
    // chronology or treat a malformed timestamp as priced evidence.
    const capturedNs = priceInstantNs(raw.provenance.capturedAt, false)
    if (capturedNs === null || capturedNs > nowNs ||
        nowNs - capturedNs > DAY_NS) {
      sourceTrusted = false
      continue
    }
    // An Offer may advertise a future or expired price. Its snapshot time
    // being recent is not proof that this exact checkout price is valid now.
    // Invalid or contradictory dates also withhold the entire basket winner.
    if (raw.offer) {
      const { validFrom, validTo } = raw.offer
      // An Offer must be effective both when its source was CAPTURED and
      // when it is reviewed. Price start +1ns after either instant must
      // never become a present checkout quote. Reuse the same exact clock
      // and inclusive date-only end semantics as the Schema.org parser.
      const from = validFrom === null ? null : priceInstantNs(validFrom, false)
      const to = validTo === null ? null : priceInstantNs(validTo, true)
      if ((validFrom !== null && from === null) ||
          (validTo !== null && to === null) ||
          (from !== null && (from > capturedNs || from > nowNs)) ||
          (to !== null && (to < capturedNs || to < nowNs)) ||
          (from !== null && to !== null && from > to)) {
        sourceTrusted = false
        continue
      }
    }
    observedTimes.push(capturedNs)

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

  // Comparing rounded JS milliseconds would silently accept a 24h + 1ns
  // mixed-store window. Preserve full precision for every source pair.
  if (observedTimes.length > 0) {
    let oldest = observedTimes[0]
    let newest = observedTimes[0]
    for (const capturedNs of observedTimes) {
      if (capturedNs < oldest) oldest = capturedNs
      if (capturedNs > newest) newest = capturedNs
    }
    if (newest - oldest > DAY_NS) sourceTrusted = false
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
      // Quoted cents are not a realizable line saving unless stock for
      // the exact pack is explicitly confirmed by BOTH retailers.
      differenceCents: plus.status === 'matched' && dekamarkt.status === 'matched' &&
        plus.totalCents !== null && dekamarkt.totalCents !== null
        ? dekamarkt.totalCents - plus.totalCents : null,
    }
  })

  // One physical SKU may satisfy multiple distinct planner ingredient IDs.
  // Pool original, unrounded decimal demands before taking the whole-pack
  // ceiling. Charge the shared purchase exactly ONCE, on its first line,
  // and mark the other rows as covered by that purchase (zero *additional*
  // packs, not a free product). This works independently per retailer.
  // Unsafe quantities/overflow still withhold the winner rather than
  // double-charging or silently rounding.
  for (const shop of SHOPS) {
    const grouped = new Map<string, number[]>()
    lines.forEach((line, index) => {
      if (line[shop].status !== 'matched' || !line[shop].productId) return
      const indices = grouped.get(line[shop].productId!) ?? []
      indices.push(index)
      grouped.set(line[shop].productId!, indices)
    })
    for (const [productId, indices] of grouped) {
      if (indices.length < 2) continue
      const item = catalog[shop].find((product) => product.id === productId)
      const packs = item ? calculateDecimalPackCount(
        indices.map((index) => ({
          amount: requirements[index].amount!,
          unit: requirements[index].unit,
        })),
        { amount: item.packAmount!, unit: item.packUnit, count: item.packCount! },
      ) : null
      const total = packs === null || !item ? null : packs * item.priceCents
      if (total === null || !Number.isSafeInteger(total) || total < 0) {
        sourceTrusted = false
        for (const index of indices) lines[index][shop] = unknown()
        continue
      }
      const ownerIndex = indices[0]
      const ownerId = requirements[ownerIndex].id
      lines[ownerIndex][shop] = {
        ...lines[ownerIndex][shop],
        packs,
        totalCents: total,
        sharedPackCoversIngredientIds: indices.map((index) => requirements[index].id),
      }
      for (const index of indices.slice(1)) {
        lines[index][shop] = {
          ...lines[index][shop],
          packs: 0,
          totalCents: 0,
          sharedPackWithIngredientId: ownerId,
        }
      }
    }
  }
  // Price differences must be computed AFTER shared physical pack allocation,
  // otherwise the row preview still reflects the old twice-rounded prices.
  for (const line of lines) {
    line.differenceCents = line.plus.status === 'matched' &&
      line.dekamarkt.status === 'matched' &&
      line.plus.totalCents !== null && line.dekamarkt.totalCents !== null
      ? line.dekamarkt.totalCents - line.plus.totalCents : null
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
