import type { StoreObservation } from '../../domain/m3ObservationSheet.ts'

export const observationRequiredFieldLabels = {
  available: 'beschikbaarheid',
  productName: 'productnaam',
  packAmount: 'verpakkingshoeveelheid',
  packUnit: 'verpakkingseenheid',
  packCount: 'aantal per verpakking',
  priceCents: 'prijs per verpakking',
} as const

export type ObservationRequiredField = keyof typeof observationRequiredFieldLabels

/**
 * Show only the next genuinely missing field on an observed product.
 * This helper never supplies an assumed value, changes readiness, or treats
 * unknown availability as a verified unavailable product.
 */
export function observationNextRequiredProductField(
  line: StoreObservation['lines'][number],
): ObservationRequiredField | null {
  const product = line.observedProduct
  if (product.available === false) return null
  if (product.available !== true) return 'available'
  if (typeof product.productName !== 'string' || !product.productName.trim()) return 'productName'
  if (typeof product.packAmount !== 'number' ||
      !Number.isFinite(product.packAmount) || product.packAmount <= 0) return 'packAmount'
  if (!product.packUnit || product.packUnit === 'unknown') return 'packUnit'
  if (!Number.isSafeInteger(product.packCount) || product.packCount <= 0) return 'packCount'
  if (!Number.isSafeInteger(product.priceCents) ||
      product.priceCents === null || product.priceCents <= 0) return 'priceCents'
  return null
}
