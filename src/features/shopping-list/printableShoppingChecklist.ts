import type { OneStoreBasket } from '../../domain/basket.ts'
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

function visibleText(value: unknown): value is string {
  return typeof value === 'string' &&
    /[\p{L}\p{N}\p{S}]/u.test(value.replace(/[\p{Cf}\p{M}]/gu, ''))
}

function quantityLabel(amount: number | null, unit: unknown): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return 'hoeveelheid onbekend'
  }
  return `${amount} ${quantityUnitLabelNl(unit, amount)}`
}


type PhysicalUnit = 'g' | 'kg' | 'ml' | 'l' | 'piece'
function baseQuantity(amount: number, unit: PhysicalUnit) {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const factor = unit === 'kg' || unit === 'l' ? 1000 : 1
  const normalized = amount * factor
  if (!Number.isFinite(normalized) || normalized <= 0) return null
  const family = unit === 'g' || unit === 'kg' ? 'mass'
    : unit === 'ml' || unit === 'l' ? 'volume' : 'piece'
  return { normalized, family }
}

function safePhysicalPacks(
  requirement: { amount: number; unit: PhysicalUnit },
  pack: { amount: number; unit: PhysicalUnit; count: number },
  packs: number,
): boolean {
  if (!Number.isSafeInteger(packs) || packs < 1 ||
      !Number.isSafeInteger(pack.count) || pack.count < 1) return false
  const required = baseQuantity(requirement.amount, requirement.unit)
  const available = baseQuantity(pack.amount * pack.count, pack.unit)
  if (!required || !available || required.family !== available.family) return false
  const minimal = Math.ceil(required.normalized / available.normalized)
  return Number.isSafeInteger(minimal) && minimal > 0 && minimal === packs
}

/**
 * Build a physical, price-free checklist from the current basket.
 * This is a convenience view, NOT a retailer observation or M3 savings proof.
 * Never replace unresolved products with a fabricated match.
 */
export function preparePrintableShoppingChecklist(
  basket: OneStoreBasket,
): PrintableShoppingChecklistData {
  if (!basket || !Array.isArray(basket.lines)) {
    throw new Error('Ongeldige boodschappenmand')
  }

  const seen = new Set<string>()
  const lines: PrintableShoppingLine[] = basket.lines.map((line) => {
    if (!line || !visibleText(line.id) || seen.has(line.id)) {
      throw new Error('Dubbele of ongeldige boodschappenregel')
    }
    seen.add(line.id)

    if (line.status === 'matched' &&
        visibleText(line.productName) &&
        safePhysicalPacks(line.requirement, line.pack, line.packs)) {
      const count = line.pack.count
      const pack = `${line.pack.amount} ${quantityUnitLabelNl(line.pack.unit, line.pack.amount)}`
      return {
        id: line.id,
        label: line.productName.trim(),
        quantity: count === 1
          ? `${line.packs} × ${pack}`
          : `${line.packs} verpakkingen van ${count} × ${pack}`,
        needsReview: false,
      }
    }

    if (line.status !== 'unresolved' && line.status !== 'matched') {
      throw new Error('Onbekende boodschappenstatus')
    }

    return {
      id: line.id,
      label: visibleText(line.ingredientLabel)
        ? line.ingredientLabel.trim() : 'Onbekend ingrediënt',
      quantity: `${quantityLabel(line.requirement?.amount ?? null, line.requirement?.unit)} · handmatig kiezen`,
      needsReview: true,
    }
  })

  return {
    storeLabel: visibleText(basket.store?.name)
      ? basket.store.name.trim() : 'Winkel nog te kiezen',
    lines,
    reviewCount: lines.filter((line) => line.needsReview).length,
    isDemo: basket.store?.id === 'm2-one-store',
  }
}
