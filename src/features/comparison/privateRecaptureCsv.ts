import type { OfflinePriceSnapshots, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
const MAX_BYTES = 256000

// A re-observation sheet is editable in spreadsheets. Never put an untrusted
// formula-shaped source label into a cell and hope that CSV quoting neutralises it.
// Refuse the export rather than rewriting an original product's identity.
function csvSourceText(value: string): string {
  if (!value || value !== value.trim() ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) ||
      /^[\p{White_Space}\p{Cf}\p{Mn}\p{Mc}\p{Me}]*[=+@-]/u.test(value.normalize('NFKC'))) {
    throw new Error('Een bronproduct heeft een onveilige spreadsheetnaam of code. Pas je originele invoer zorgvuldig aan.')
  }
  return value
}

function cell(value: string | number): string {
  return '"' + String(value).replaceAll('"', '""') + '"'
}

/**
 * Create a *new, unobserved* workbook from an existing locally admitted
 * capture. No old monetary, availability or observation evidence survives.
 * A user must supply a real ISO-offset observation time, fresh cents and
 * explicitly set availability before the existing strict importer admits it.
 */
export function makePrivateRecaptureCsv(
  data: OfflinePriceSnapshots,
  retailer: OfflineRetailer,
): string {
  const capture = data.captures[retailer]
  if (!capture || capture.retailer !== retailer || !capture.products.length) {
    throw new Error('Laad eerst een eigen originele winkelopname in Supa.')
  }
  const rows = [HEADER.map(cell).join(',')]
  for (const product of capture.products) {
    const packCount = product.packCount ?? 1
    if (product.storeId !== retailer ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(product.packUnit) ||
        (product.packAmount !== null && (!Number.isFinite(product.packAmount) || product.packAmount <= 0)) ||
        !Number.isSafeInteger(packCount) || packCount < 1) {
      throw new Error('De oude bron kan niet veilig als nieuw invulblad worden gebruikt.')
    }
    rows.push([
      retailer,
      '', // no implied fresh capture timestamp
      csvSourceText(product.id),
      csvSourceText(product.name),
      product.packAmount === null ? '' : String(product.packAmount),
      product.packUnit,
      String(packCount),
      '', // NEVER reuse observed prices or silently replace null with 0
      'false', // explicitly re-observe availability before pricing
    ].map(cell).join(','))
  }
  const csv = rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > MAX_BYTES) {
    throw new Error('Het herobservatieblad is groter dan 256 kB. Maak een kleinere originele bronopname.')
  }
  return csv
}
