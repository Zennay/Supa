/**
 * A deliberately blank, offline worksheet for a *physical Planner demand*.
 * Every source identity, observation instant, package and price must be supplied
 * by the person with the lawful original record. A demand is not a retailer SKU.
 *
 * CSV rows follow the existing nine-field offline-two-store-csv importer;
 * unfilled rows are ignored, not interpreted as zero-price products.
 */
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
const SUPPORTED_UNITS = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const STORES = ['PLUS', 'DekaMarkt'] as const
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'

export type PlannerCaptureNeed = Readonly<{
  id: string
  label: string
  unit: string
}>

export function makeBlankPlannerCaptureCsv(needs: readonly PlannerCaptureNeed[]): string {
  if (!Array.isArray(needs) || needs.length < 1 || needs.length > 200 ||
      needs.some(need => !need || typeof need.id !== 'string' ||
        typeof need.label !== 'string' || typeof need.unit !== 'string')) {
    throw new Error('Selecteer eerst een geldig weekmenu met maximaal 200 ingrediënten.')
  }
  const rows: string[] = [HEADER.map(quote).join(',')]
  for (const retailer of STORES) {
    for (const need of needs) {
      // Only the *physical unit family* may be used as an editable hint.
      // Unknown units stay empty; they cannot become priced without correction.
      const packUnit = SUPPORTED_UNITS.has(need.unit) ? need.unit : ''
      rows.push([
        retailer, '', '', '', '', packUnit, '', '', 'false',
      ].map(quote).join(','))
    }
  }
  const csv = rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > 256000) {
    throw new Error('Het invulblad is te groot voor de lokale CSV-import.')
  }
  return csv
}
