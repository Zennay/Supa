/**
 * An editable, deliberately *unobserved* capture sheet for a physical
 * Planner demand. No demanded ingredient becomes a retailer product or SKU.
 * A real source identity, actual time, package, availability and price must
 * be filled in by the person with the original lawful observation.
 */
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
const SUPPORTED_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const STORES = ['PLUS', 'DekaMarkt'] as const
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'

export type CaptureStore = typeof STORES[number]
export type PlannerCaptureNeed = Readonly<{
  id: string
  label: string
  unit: string
}>

/** A one-store sheet can be imported alone; only actual source rows are admitted. */
export function makeBlankPlannerCaptureCsv(
  needs: readonly PlannerCaptureNeed[],
  selectedStores: readonly CaptureStore[] = STORES,
  delimiter: ',' | ';' = ',',
): string {
  if (!Array.isArray(needs) || needs.length < 1 || needs.length > 200 ||
      needs.some(need => !need || typeof need.id !== 'string' ||
        typeof need.label !== 'string' || typeof need.unit !== 'string')) {
    throw new Error('Selecteer eerst een geldig weekmenu met maximaal 200 ingrediënten.')
  }
  if (!Array.isArray(selectedStores) || selectedStores.length < 1 ||
      selectedStores.length > STORES.length ||
      new Set(selectedStores).size !== selectedStores.length ||
      selectedStores.some(store => !STORES.includes(store))) {
    throw new Error('Selecteer één of beide ondersteunde winkels.')
  }
  const rows: string[] = [HEADER.map(quote).join(delimiter)]
  for (const retailer of selectedStores) {
    for (const need of needs) {
      // Unit hints are not recorded retailer packaging. Unknown stays empty.
      const packUnit = SUPPORTED_UNITS.has(need.unit) ? need.unit : ''
      rows.push([
        retailer, '', '', '', '', packUnit, '', '', 'false',
      ].map(quote).join(delimiter))
    }
  }
  const csv = rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > 256000) {
    throw new Error('Het invulblad is te groot voor de lokale CSV-import.')
  }
  return csv
}
