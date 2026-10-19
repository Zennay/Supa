import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import type { PrivateCaptureProgress, OwnStore } from '../comparison/privateReviewedBasketBridge.ts'

const stores: readonly OwnStore[] = ['PLUS', 'DekaMarkt']
type PendingRow = readonly [string, string, string, string, string, string, string, string]

/** Neither output is a price feed, authorized source observation nor approved
 * retailer match. These are only private tasks from the user's current tab. */
function pendingRows(
  progress: PrivateCaptureProgress,
  expectedPlanKey: string,
  nowMs: number,
): PendingRow[] {
  if (!progress || !expectedPlanKey || progress.planKey !== expectedPlanKey ||
      !Number.isFinite(nowMs)) throw new Error('Het weekmenu is gewijzigd. Open Vergelijk opnieuw.')
  const rows: PendingRow[] = []
  for (const store of stores) {
    const source = progress.stores[store]
    if (!source) {
      rows.push([store, '', 'Eigen bronopname ontbreekt', '', '',
        'Niet gekoppeld', 'Onbekend', 'Importeer een eigen geldige CSV/JSON-bronopname'])
      continue
    }
    const seen = Date.parse(source.observedAt)
    const fresh = Number.isFinite(seen) && nowMs >= seen - 300_000 &&
      nowMs - seen <= 604_800_000
    if (!fresh) {
      rows.push([store, source.observedAt, 'Bronopname te oud of toekomstig',
        '', '', 'Niet gekoppeld', 'Onbekend', 'Leg de echte winkelbron opnieuw vast'])
      continue
    }
    for (const [items, task] of [
      [source.missingIngredients, 'Zoek oorspronkelijk bronproduct'],
      [source.awaitingReviewIngredients, 'Bevestig eigen SKU, verpakking en pakprijs'],
    ] as const) {
      for (const item of items) {
        rows.push([store, source.observedAt, task, item.id, item.label,
          'Nog niet persoonlijk bevestigd', 'Onbekend',
          'Open Vergelijk voor oorspronkelijke broncontrole'])
        if (rows.length > 2000) throw new Error('Te veel openstaande winkelcontroles.')
      }
    }
  }
  if (!rows.length) throw new Error('Er zijn geen openstaande broncontroles.')
  return rows
}

/** Literal semicolon CSV; never guesses missing SKU or euros. */
export function pendingOwnSourceReviewCsv(
  progress: PrivateCaptureProgress, expectedPlanKey: string, nowMs: number,
): string {
  const row = (values: readonly unknown[]) => values.map(value => literalCsv(value)).join(';')
  const header = ['Winkel', 'Bronmoment', 'Taak', 'Origineel ingrediënt-ID',
    'Ingrediënt', 'Bronartikel/SKU', 'Pakprijs', 'Controlegegevens']
  const csv = '\ufeff' + [row(header), ...pendingRows(progress, expectedPlanKey, nowMs).map(row)]
    .join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000)
    throw new Error('De openstaande winkelcontroles passen niet in de privé-CSV.')
  return csv
}

/** Phone-readable checklist of the SAME pending source-review work, without
 * HTML, formulas, made-up prices or a claim of product approval. */
export function pendingOwnSourceReviewText(
  progress: PrivateCaptureProgress, expectedPlanKey: string, nowMs: number,
): string {
  const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const lines = ['Supa - openstaande eigen PLUS/Deka-winkelcontroles',
    'Privé overzicht, geen actuele prijsfeed en geen bevestigde besparing.', '']
  for (const [store, observedAt, task, id, label] of pendingRows(progress, expectedPlanKey, nowMs)) {
    lines.push('- ' + clean(store) + ': ' + clean(task) +
      (label ? ' - ' + clean(label) + ' (ingrediënt ' + clean(id) + ')' : '') +
      (observedAt ? ' [bronmoment: ' + clean(observedAt) + ']' : ''))
  }
  lines.push('', 'Zoek/bevestig oorspronkelijke SKU, verpakking en pakprijs zelf in Vergelijk.',
    'Ontbrekende of verlopen prijzen blijven onbekend.')
  const text = lines.join('\n')
  if (new TextEncoder().encode(text).length > 120_000)
    throw new Error('De mobiele controlelijst is te lang om te kopiëren.')
  return text
}
