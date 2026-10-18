import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListBasketKey } from './shoppingListProgress.ts'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation.ts'

const KNOWN_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const BIDI_AND_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

// A label needs a visible lexical or symbol base, not just invisible marks.
const VISIBLE_LABEL_BASE = /[\p{L}\p{N}\p{S}]/u
// These blank-looking code points count as Unicode Letters/Symbols, so the
// visible-base regex alone incorrectly treats an invisible name as readable.
const VISUALLY_BLANK_FILLERS = /[\u115f\u1160\u2800\u3164\uffa0]/g

function safeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(BIDI_AND_CONTROL, ' ')
    .replace(VISUALLY_BLANK_FILLERS, ' ').replace(/\s+/g, ' ').trim()
  return label && VISIBLE_LABEL_BASE.test(label) ? label : null
}

function safePositive(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

function safeUnit(value: unknown): value is 'g' | 'kg' | 'ml' | 'l' | 'piece' {
  return typeof value === 'string' && KNOWN_UNITS.has(value)
}

function baseQuantity(amount: number, unit: string) {
  const factor = unit === 'kg' || unit === 'l' ? 1000 : 1
  const converted = amount * factor
  if (!safePositive(converted)) return null
  const family = unit === 'kg' || unit === 'g' ? 'mass' :
    unit === 'ml' || unit === 'l' ? 'volume' : 'piece'
  return { family, amount: converted }
}

/** Keep human-readable decimal quantities exact at physical pack boundaries.
 * Number.toString() expresses the chosen input quantity as a canonical decimal;
 * rational BigInt arithmetic avoids IEEE-754 ceil/multiplication overshoot.
 */
function decimalBaseQuantity(amount: number, unit: string) {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(amount))
  if (!match) return null
  const shift = Number(match[3] ?? 0) - (match[2]?.length ?? 0)
  const digits = BigInt(match[1] + (match[2] ?? ''))
  const numerator = digits * (unit === 'kg' || unit === 'l' ? 1000n : 1n)
  if (numerator <= 0n) return null
  return shift >= 0
    ? { numerator: numerator * 10n ** BigInt(shift), denominator: 1n }
    : { numerator, denominator: 10n ** BigInt(-shift) }
}

function exactMinimalPackCount(
  demandAmount: number, demandUnit: string,
  packAmount: number, packUnit: string, count: number,
): bigint | null {
  const demand = decimalBaseQuantity(demandAmount, demandUnit)
  const pack = decimalBaseQuantity(packAmount, packUnit)
  if (!demand || !pack) return null
  const needed = demand.numerator * pack.denominator
  const perPurchase = pack.numerator * BigInt(count) * demand.denominator
  return perPurchase > 0n ? (needed + perPurchase - 1n) / perPurchase : null
}

function dutchAmount(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Create a portable one-store shopping checklist from the CURRENT basket.
 * Never invent store prices, complete-basket claims or product matches.
 * An invalid runtime snapshot returns null rather than a misleading list.
 */
function buildShoppingListCopyTextUnchecked(
  basket: OneStoreBasket,
  doneLineIds: readonly string[] = [],
): string | null {
  if (!basket || typeof basket !== 'object' || !basket.store ||
      !Array.isArray(basket.lines) || !Array.isArray(doneLineIds)) return null

  const storeName = safeLabel(basket.store.name)
  if (!storeName || !safeLabel(basket.store.id)) return null

  const done = new Set<string>()
  for (const id of doneLineIds) {
    if (typeof id !== 'string' || !id.trim()) return null
    done.add(id)
  }

  const lineIds = new Set<string>()
  const entries: string[] = []
  let matchedCount = 0
  let unresolvedCount = 0

  for (const line of basket.lines) {
    if (!line || typeof line !== 'object') return null
    const id = safeLabel(line.id)
    const ingredientLabel = safeLabel(line.ingredientLabel)
    const requirement = line.requirement
    if (!id || !ingredientLabel || id !== line.id || lineIds.has(id) ||
        !requirement || !safeUnit(requirement.unit) ||
        (requirement.amount !== null && !safePositive(requirement.amount))) return null

    lineIds.add(id)
    const needed = requirement.amount === null
      ? '?'
      : dutchAmount(requirement.amount)
    const neededUnit = quantityUnitLabelNl(requirement.unit, requirement.amount)
    const statusMark = done.has(id) ? '[x]' : '[ ]'

    if (line.status === 'unresolved') {
      unresolvedCount += 1
      entries.push(statusMark + ' ' + ingredientLabel +
        ' — product zelf kiezen (nodig: ' + needed + ' ' + neededUnit + ')')
      continue
    }

    if (line.status !== 'matched' || requirement.amount === null) return null
    const productName = safeLabel(line.productName)
    if (!productName || !safeLabel(line.productId) ||
        !Number.isSafeInteger(line.packs) || line.packs <= 0 ||
        !line.pack || !safePositive(line.pack.amount) ||
        !safeUnit(line.pack.unit) || !Number.isSafeInteger(line.pack.count) ||
        line.pack.count <= 0 || !Number.isSafeInteger(line.pricePerPackCents) ||
        line.pricePerPackCents < 0 || !Number.isSafeInteger(line.lineTotalCents) ||
        line.lineTotalCents !== line.packs * line.pricePerPackCents) return null

    // Reject stale demand with too few physical packs, without pricing anything.
    const required = baseQuantity(requirement.amount, requirement.unit)
    const perPackQuantity = baseQuantity(line.pack.amount, line.pack.unit)
    const perPurchasedPack = perPackQuantity === null ? 0 :
      perPackQuantity.amount * line.pack.count
    const available = perPurchasedPack * line.packs
    const minimumPacks = safePositive(perPurchasedPack) && required
      ? exactMinimalPackCount(
          requirement.amount, requirement.unit, line.pack.amount, line.pack.unit,
          line.pack.count,
        )
      : null
    // Exact rational comparison neither invents extra packs nor tolerates shortfalls.
    if (!required || !perPackQuantity || required.family !== perPackQuantity.family ||
        !safePositive(available) || minimumPacks === null ||
        minimumPacks === 0n || minimumPacks > BigInt(Number.MAX_SAFE_INTEGER) ||
        BigInt(line.packs) !== minimumPacks) return null

    matchedCount += 1
    const packUnit = quantityUnitLabelNl(line.pack.unit, line.pack.amount)
    const perPack = (line.pack.count > 1 ? line.pack.count + ' × ' : '') +
      dutchAmount(line.pack.amount) + ' ' + packUnit
    entries.push(statusMark + ' ' + productName + ' — ' +
      line.packs + ' × ' + perPack + ' (nodig: ' +
      needed + ' ' + neededUnit + ')')
  }

  if (!Number.isSafeInteger(basket.matchedLineCount) ||
      !Number.isSafeInteger(basket.unresolvedLineCount) ||
      matchedCount !== basket.matchedLineCount ||
      unresolvedCount !== basket.unresolvedLineCount ||
      [...done].some(id => !lineIds.has(id))) return null

  const header = 'Boodschappenlijst — ' + storeName
  if (entries.length === 0) {
    return header + '\nEr zijn nog geen boodschappen gepland.'
  }

  return [
    header,
    'Eigen planning — productkeuzes controleren in de winkel.',
    ...entries,
    ...(unresolvedCount > 0
      ? ['Let op: ' + unresolvedCount + ' productkeuze(s) nog niet bepaald.']
      : []),
  ].join('\n')
}

/**
 * Caller-owned basket/checkmark snapshots may contain hostile accessors or revoked
 * proxies. Never let a malformed runtime snapshot crash shopping-list rendering.
 */
export function buildShoppingListCopyText(
  basket: OneStoreBasket,
  doneLineIds: readonly string[] = [],
): string | null {
  try {
    shoppingListBasketKey(basket)
    return buildShoppingListCopyTextUnchecked(basket, doneLineIds)
  } catch {
    // A partial local checklist is discarded: invalid input is never copyable.
    return null
  }
}
