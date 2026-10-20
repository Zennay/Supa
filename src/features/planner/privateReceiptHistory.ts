import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import type { ReceiptLine, ReceiptProduct, SavedReceipt } from './PrivateOwnReceiptViewer.tsx'

export type ReceiptStore = 'PLUS' | 'DekaMarkt'
export type HistoricalRow = {
  ingredientId: string
  ingredient: string
  old: ReceiptLine
  later: ReceiptLine
  changeCents: Record<ReceiptStore, number | null>
}
export type HistoricalScope = {
  comparableLines: number
  completeBasket: boolean
  earlierSubsetCents: number
  laterSubsetCents: number
  changeCents: number | null
}
export type HistoricalReceiptResult =
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; older: SavedReceipt; later: SavedReceipt;
      rows: HistoricalRow[]; excluded: { ingredient: string; reason: string }[];
      stores: Record<ReceiptStore, HistoricalScope>; entirePairComparable: boolean }

const STORES: readonly ReceiptStore[] = ['PLUS', 'DekaMarkt']

function samePackage(a: ReceiptProduct, b: ReceiptProduct): boolean {
  return a.sourceProductId === b.sourceProductId &&
    a.sourceProductName === b.sourceProductName &&
    a.packagesNeeded === b.packagesNeeded &&
    a.package.amount === b.package.amount &&
    a.package.unit === b.package.unit &&
    a.package.count === b.package.count
}
/**
 * Compare two historic READ-ONLY, locally imported derived receipts. Never
 * elevate these values to source prices or infer real observed price trends.
 * Physical demand is matched by ingredient identity, quantity and unit.
 * Matching SKU and entire pack/count are then checked independently for
 * each store, so one store can still have useful historic lines when the
 * other substituted a product.
 */
export function comparePrivateReceiptHistory(
  older: SavedReceipt, later: SavedReceipt,
): HistoricalReceiptResult {
  const earlierTimes = {
    PLUS: observedInstant(older.plusObservedAt),
    DekaMarkt: observedInstant(older.dekaObservedAt),
  }
  const laterTimes = {
    PLUS: observedInstant(later.plusObservedAt),
    DekaMarkt: observedInstant(later.dekaObservedAt),
  }
  if (STORES.some(store => !earlierTimes[store] || !laterTimes[store] ||
    laterTimes[store]!.ns <= earlierTimes[store]!.ns)) {
    return { status: 'unavailable', reason: 'Het tweede rapport moet voor beide winkels een echt later bronmoment hebben. De exportdatum telt niet als opname.' }
  }
  const oldById = new Map(older.lines.map(line => [line.ingredientId, line]))
  const newById = new Map(later.lines.map(line => [line.ingredientId, line]))
  const rows: HistoricalRow[] = []
  const excluded: { ingredient: string; reason: string }[] = []
  for (const previous of older.lines) {
    const current = newById.get(previous.ingredientId)
    if (!current || previous.ingredient !== current.ingredient ||
        previous.demand.amount !== current.demand.amount ||
        previous.demand.unit !== current.demand.unit) {
      excluded.push({ ingredient: previous.ingredient, reason: 'Andere of ontbrekende fysieke hoeveelheid' })
      continue
    }
    const changes: Record<ReceiptStore, number | null> = {
      PLUS: samePackage(previous.PLUS, current.PLUS)
        ? current.PLUS.totalWholePackagesCents - previous.PLUS.totalWholePackagesCents : null,
      DekaMarkt: samePackage(previous.DekaMarkt, current.DekaMarkt)
        ? current.DekaMarkt.totalWholePackagesCents - previous.DekaMarkt.totalWholePackagesCents : null,
    }
    if (changes.PLUS === null && changes.DekaMarkt === null) {
      excluded.push({ ingredient: previous.ingredient, reason: 'Bij beide winkels andere SKU of verpakking' })
      continue
    }
    rows.push({ ingredientId: previous.ingredientId,
      ingredient: previous.ingredient, old: previous, later: current, changeCents: changes })
  }
  for (const current of later.lines) if (!oldById.has(current.ingredientId))
    excluded.push({ ingredient: current.ingredient, reason: 'Extra ingrediënt in het latere rapport' })

  const stores = {} as Record<ReceiptStore, HistoricalScope>
  for (const store of STORES) {
    const comparable = rows.filter(row => row.changeCents[store] !== null)
    const earlierSubsetCents = comparable.reduce(
      (sum, row) => sum + row.old[store].totalWholePackagesCents, 0)
    const laterSubsetCents = comparable.reduce(
      (sum, row) => sum + row.later[store].totalWholePackagesCents, 0)
    if (![earlierSubsetCents, laterSubsetCents].every(Number.isSafeInteger)) {
      return { status: 'unavailable', reason: 'De berekende bedragen vallen buiten het veilige bereik.' }
    }
    const completeBasket = comparable.length === older.lines.length &&
      comparable.length === later.lines.length && excluded.length === 0
    if (completeBasket && (
      earlierSubsetCents !== (store === 'PLUS' ? older.plusCents : older.dekaCents) ||
      laterSubsetCents !== (store === 'PLUS' ? later.plusCents : later.dekaCents))) {
      return { status: 'unavailable', reason: 'De productregels sluiten niet aan op het volledige mandtotaal.' }
    }
    stores[store] = { comparableLines: comparable.length, completeBasket,
      earlierSubsetCents, laterSubsetCents,
      changeCents: comparable.length ? laterSubsetCents - earlierSubsetCents : null }
  }
  rows.sort((a, b) =>
    Math.max(Math.abs(b.changeCents.PLUS ?? 0), Math.abs(b.changeCents.DekaMarkt ?? 0)) -
    Math.max(Math.abs(a.changeCents.PLUS ?? 0), Math.abs(a.changeCents.DekaMarkt ?? 0)) ||
    a.ingredient.localeCompare(b.ingredient, 'nl'))
  return { status: 'ready', older, later, rows, excluded,
    stores, entirePairComparable: STORES.every(store => stores[store].completeBasket) }
}
