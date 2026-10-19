import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import type { OneStoreBasket, RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { offlineSessionFingerprint } from './offlineSessionBaskets.ts'
import { readPrivateMatchBackup } from './privateMatchChoicesBackup.ts'

const SCHEMA = 'supa-private-two-store-session-v1'
const MAX_BYTES = 512_000
type PairedBaskets = { PLUS: OneStoreBasket; DekaMarkt: OneStoreBasket }
type ArchivePreview = {
  source: string
  parsed: OfflinePriceSnapshots
  fingerprint: string
  choices: Record<string, string>
}

/** An explicit, locally downloadable archive of the user's own canonical
 * source observations and private reviewed choices. NEVER a retailer license,
 * current price feed, public savings claim or uploaded proof. */
export function createPrivateComparisonArchive(
  admittedSource: string, choicesBackup: string,
): string {
  const source = JSON.parse(admittedSource) as unknown
  parseOfflinePriceSnapshots(admittedSource, Date.now())
  const choices = JSON.parse(choicesBackup) as unknown
  const output = JSON.stringify({
    schema: SCHEMA, source, choices,
  }, null, 2) + '\n'
  if (new TextEncoder().encode(output).byteLength > MAX_BYTES) {
    throw new Error('De privévergelijking past niet in een archief van 512 kB.')
  }
  return output
}

export async function readPrivateComparisonArchive(
  content: string,
  plan: PlannedMeal[], recipes: RecipeWithIngredients[], activeDays: string[],
  buildBaskets: (imported: OfflinePriceSnapshots) => PairedBaskets | null,
): Promise<ArchivePreview> {
  if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > MAX_BYTES) {
    throw new Error('Selecteer een privévergelijkingsarchief van maximaal 512 kB.')
  }
  let value: unknown
  try { value = JSON.parse(content) }
  catch { throw new Error('Het privévergelijkingsarchief bevat geen geldige JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Ongeldig privévergelijkingsarchief.')
  }
  const root = value as Record<string, unknown>
  if (root.schema !== SCHEMA || Object.keys(root).length !== 3 ||
      !Object.hasOwn(root, 'source') || !Object.hasOwn(root, 'choices')) {
    throw new Error('Onbekend of onvolledig privévergelijkingsarchief.')
  }
  const source = JSON.stringify(root.source)
  const parsed = parseOfflinePriceSnapshots(source, Date.now())
  const fingerprint = offlineSessionFingerprint(parsed, plan, recipes, activeDays)
  const baskets = buildBaskets(parsed)
  if (!baskets) throw new Error('Kies eerst een geldige Planner-week om dit archief te herstellen.')
  const products = {
    PLUS: parsed.captures.PLUS.products,
    DekaMarkt: parsed.captures.DekaMarkt.products,
  }
  const choices = await readPrivateMatchBackup(
    JSON.stringify(root.choices), fingerprint, baskets, products,
  )
  return { source, parsed, fingerprint, choices }
}
