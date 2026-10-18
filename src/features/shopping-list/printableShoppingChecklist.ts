import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListBasketKey } from './shoppingListProgress.ts'
import { quantityUnitLabelNl } from '../../lib/quantityPresentation.ts'

export type PrintableShoppingLine = {
  id: string
  label: string
  quantity: string
  needsReview: boolean
}

export type PrintableShoppingChecklistData = {
  storeLabel: string
  lines: PrintableShoppingLine[]
  reviewCount: number
  isDemo: boolean
}

// Some Unicode symbols/letters render as *blank* glyphs. A product name or
// location made only of these glyphs is not a visible shopping instruction.
const INVISIBLE_FILLERS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu

function visibleText(value: unknown): value is string {
  return typeof value === 'string' &&
    /[\p{L}\p{N}\p{S}]/u.test(
      value.replace(/[\p{Cf}\p{M}\u115F\u1160\u3164\uFFA0\u2800]/gu, ''),
    )
}

// Printed words must never carry hidden direction overrides, zero-width format
// characters, line separators or interior C0/C1 controls. Preserve legitimate
// letters, accents, emoji, dashes and spaces; never mutate the basket source.
function safePrintableLabel(value: unknown): string | null {
  if (!visibleText(value)) return null
  const cleaned = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  return visibleText(cleaned) ? cleaned : null
}

// Physical quantities use the same Dutch decimal notation as the live Lijst.
function dutchAmount(amount: number): string {
  return String(amount).replace('.', ',')
}

function quantityLabel(amount: number | null, unit: unknown): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return 'hoeveelheid onbekend'
  }
  return `${dutchAmount(amount)} ${quantityUnitLabelNl(unit, amount)}`
}


/**
 * Compare physical pack demand using exact decimal ratios. IEEE-754
 * division/ceil can overcount a whole pack at decimal unit boundaries;
 * a paper checklist must not convert that rounding artifact into a
 * trusted purchase instruction. Canonical units remain unchanged.
 */
function exactBaseQuantity(amount: number, unit: unknown) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
      !['g', 'kg', 'ml', 'l', 'piece'].includes(unit as string)) return null

  const parts = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(amount.toString())
  if (!parts) return null
  const exponent = Number(parts[3] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 325) return null
  const digits = BigInt((parts[1] + (parts[2] ?? '')).replace(/^0+/, '') || '0')
  const power = exponent - (parts[2]?.length ?? 0) +
    (unit === 'kg' || unit === 'l' ? 3 : 0)
  const numerator = power >= 0 ? digits * 10n ** BigInt(power) : digits
  const denominator = power < 0 ? 10n ** BigInt(-power) : 1n
  const family = unit === 'g' || unit === 'kg' ? 'mass'
    : unit === 'ml' || unit === 'l' ? 'volume' : 'piece'
  return { numerator, denominator, family }
}

function safePhysicalPacks(
  requirement: { amount: number; unit: unknown },
  pack: { amount: number; unit: unknown; count: number },
  packs: number,
): boolean {
  if (!requirement || typeof requirement !== 'object' ||
      !pack || typeof pack !== 'object' ||
      !Number.isSafeInteger(packs) || packs < 1 ||
      !Number.isSafeInteger(pack.count) || pack.count < 1) return false

  const required = exactBaseQuantity(requirement.amount, requirement.unit)
  const perItem = exactBaseQuantity(pack.amount, pack.unit)
  if (!required || !perItem || required.family !== perItem.family) return false

  // required / perItem, cross-multiplied without a lossy floating quotient.
  const demand = required.numerator * perItem.denominator
  const outerPackCapacity = perItem.numerator *
    BigInt(pack.count) * required.denominator
  if (outerPackCapacity <= 0n) return false
  const purchased = BigInt(packs)
  return demand <= outerPackCapacity * purchased &&
    demand > outerPackCapacity * (purchased - 1n)
}

/**
 * Build a physical, price-free checklist from the current basket.
 * This is a convenience view, NOT a retailer observation or M3 savings proof.
 * Never replace unresolved products with a fabricated match.
 */
export function preparePrintableShoppingChecklist(
  basket: OneStoreBasket,
): PrintableShoppingChecklistData {
  if (!basket || !Array.isArray(basket.lines) || basket.lines.length > 500) {
    throw new Error('Ongeldige boodschappenmand')
  }

  // Array.map silently drops sparse slots. Never show an incomplete paper
  // shopping list as if every planned ingredient had been copied.
  for (let index = 0; index < basket.lines.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(basket.lines, index)) {
      throw new Error('Onvolledige boodschappenmand')
    }
  }

  // The printed list is only safe if the entire root ledger matches its physical lines.
  shoppingListBasketKey(basket)

  const seen = new Set<string>()
  const lines: PrintableShoppingLine[] = basket.lines.map((line) => {
    if (!line || !visibleText(line.id) ||
        line.id !== line.id.trim() ||
        line.id !== line.id.replace(INVISIBLE_FILLERS, '') ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(line.id) ||
        seen.has(line.id)) {
      throw new Error('Dubbele of ongeldige boodschappenregel')
    }
    seen.add(line.id)

    const productLabel = line.status === 'matched'
      ? safePrintableLabel(line.productName) : null
    if (line.status === 'matched' && productLabel !== null &&
        safePhysicalPacks(line.requirement, line.pack, line.packs)) {
      const count = line.pack.count
      const pack = `${dutchAmount(line.pack.amount)} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`
      return {
        id: line.id,
        label: productLabel,
        quantity: count === 1
          ? `${line.packs} × ${pack}`
          : `${line.packs} ${line.packs === 1 ? 'verpakking' : 'verpakkingen'} van ${count} × ${pack}`,
        needsReview: false,
      }
    }

    if (line.status !== 'unresolved' && line.status !== 'matched') {
      throw new Error('Onbekende boodschappenstatus')
    }

    return {
      id: line.id,
      label: safePrintableLabel(line.ingredientLabel) ?? 'Onbekend ingrediënt',
      quantity: `${quantityLabel(line.requirement?.amount ?? null, line.requirement?.unit)} · handmatig kiezen`,
      needsReview: true,
    }
  })

  return {
    storeLabel: safePrintableLabel(basket.store?.name) ?? 'Winkel nog te kiezen',
    lines,
    reviewCount: lines.filter((line) => line.needsReview).length,
    isDemo: basket.store?.id === 'm2-one-store',
  }
}
