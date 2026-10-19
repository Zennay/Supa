import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { PrivateCaptureProgress, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

const stores: readonly OwnStore[] = ['PLUS', 'DekaMarkt']

/** A portable to-do list derived only from genuine in-memory user source progress.
 * It is never a product/price feed and cannot create a reviewed basket. */
export function pendingOwnSourceReviewCsv(
  progress: PrivateCaptureProgress,
  expectedPlanKey: string,
  nowMs: number,
): string {
  if (!progress || !expectedPlanKey || progress.planKey !== expectedPlanKey ||
      !Number.isFinite(nowMs)) throw new Error('Het weekmenu is gewijzigd. Open Vergelijk opnieuw.')
  const row = (values: readonly unknown[]) => values.map(value => literalCsv(value)).join(';')
  const rows = [row(['Winkel', 'Bronmoment', 'Taak', 'Origineel ingrediënt-ID',
    'Ingrediënt', 'Bronartikel/SKU', 'Pakprijs', 'Controlegegevens'])]
  let tasks = 0
  for (const store of stores) {
    const source = progress.stores[store]
    if (!source) {
      rows.push(row([store, '', 'Eigen bronopname ontbreekt', '', '',
        'Niet gekoppeld', 'Onbekend', 'Importeer een eigen geldige CSV/JSON-bronopname']))
      tasks++
      continue
    }
    const seen = Date.parse(source.observedAt)
    const fresh = Number.isFinite(seen) && nowMs >= seen - 300_000 &&
      nowMs - seen <= 604_800_000
    if (!fresh) {
      rows.push(row([store, source.observedAt, 'Bronopname te oud of toekomstig',
        '', '', 'Niet gekoppeld', 'Onbekend', 'Leg de echte winkelbron opnieuw vast']))
      tasks++
      continue
    }
    for (const [items, task] of [
      [source.missingIngredients, 'Zoek oorspronkelijk bronproduct'],
      [source.awaitingReviewIngredients, 'Bevestig eigen SKU, verpakking en pakprijs'],
    ] as const) {
      for (const item of items) {
        rows.push(row([store, source.observedAt, task, item.id, item.label,
          'Nog niet persoonlijk bevestigd', 'Onbekend',
          'Open Vergelijk voor oorspronkelijke broncontrole']))
        tasks++
        if (tasks > 2000) throw new Error('Te veel openstaande winkelcontroles.')
      }
    }
  }
  if (tasks === 0) throw new Error('Er zijn geen openstaande broncontroles.')
  const csv = '\ufeff' + rows.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000)
    throw new Error('De openstaande winkelcontroles passen niet in de privé-CSV.')
  return csv
}
