import { decodeSaved, type Item } from './ownExtraGroceriesStorage.ts'
import { exportUnpricedProgress, importUnpricedProgress } from './unpricedPlannerProgress.ts'

const schema = 'supa-complete-physical-week-v1'
const maxBytes = 256_000

type CompleteWeekBackup = {
  schema: typeof schema
  identity: string
  extras: string
  planner: string
}

/** A portable, price-free pair of the EXISTING private checklist contracts.
 * No imported source product, retailer permission or monetary fact is stored. */
export function createCompleteWeekBackup(
  identity: string, demandIdentity: string, keys: readonly string[],
  extras: readonly Item[], plannerTicks: Readonly<Record<string, boolean>>,
): string {
  if (!identity || identity.length > 100_000 || keys.length > 2_000 ||
      extras.length > 100) throw Error('Dit fysieke weekmenu is niet exporteerbaar.')
  const extraFile = JSON.stringify({ schema: 'supa-extra-v1', identity, items: extras })
  decodeSaved(extraFile, identity)
  const progressFile = exportUnpricedProgress(demandIdentity, keys, plannerTicks)
  const output: CompleteWeekBackup = {
    schema, identity, extras: extraFile, planner: progressFile,
  }
  const content = JSON.stringify(output)
  if (new TextEncoder().encode(content).length > maxBytes)
    throw Error('Complete privéweekback-up overschrijdt 256 kB.')
  return content
}

export function readCompleteWeekBackup(
  raw: string, identity: string, demandIdentity: string, keys: readonly string[],
): { items: Item[]; checked: Record<string, boolean>; progressFile: string } {
  if (!raw || new TextEncoder().encode(raw).length > maxBytes)
    throw Error('De weekback-up is leeg of te groot (maximaal 256 kB).')
  const root: unknown = JSON.parse(raw)
  if (!root || typeof root !== 'object' || Array.isArray(root) ||
      Object.getPrototypeOf(root) !== Object.prototype)
    throw Error('Geen geldige volledige Supa-weekback-up.')
  const record = root as Partial<CompleteWeekBackup>
  if (record.schema !== schema || record.identity !== identity ||
      typeof record.extras !== 'string' || typeof record.planner !== 'string' ||
      Object.keys(record).length !== 4 ||
      Object.keys(record).some(key => !['schema','identity','extras','planner'].includes(key)))
    throw Error('Back-up is niet van exact dit weekmenu of heeft een andere versie.')
  const items = decodeSaved(record.extras, identity)
  const checked = importUnpricedProgress(record.planner, demandIdentity, keys)
  return { items, checked, progressFile: record.planner }
}
