import type { OneStoreBasket } from '../../domain/basket.ts'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation.ts'

const KNOWN_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const BIDI_AND_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

function safeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(BIDI_AND_CONTROL, ' ').replace(/\s+/g, ' ').trim()
  return label ? label : null
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

function dutchAmount(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Create a portable one-store shopping checklist from the CURRENT basket.
 * Never invent store prices, complete-basket claims or product matches.
 * An invalid runtime snapshot returns null rather than a misleading list.
 */
export function buildShoppingListCopyText(
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
    const perPack = baseQuantity(line.pack.amount, line.pack.unit)
    const available = perPack === null ? 0 :
      perPack.amount * line.pack.count * line.packs
    if (!required || !perPack || required.family !== perPack.family ||
        !safePositive(available) || required.amount > available) return null

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
