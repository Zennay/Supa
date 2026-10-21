import type { PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'
import type { LocalCaptureEntry } from './localCaptureEditorBackup.ts'
import type { CaptureStore } from './plannerPriceCaptureSheet.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'

// CSV spreadsheet applications can execute formula-shaped labels even when
// they are quoted. Refuse potentially executable or visually manipulated
// original identifiers rather than silently altering a retailer SKU/name.
export function safeOriginalCaptureLabel(value: string): boolean {
  if (!value || value !== value.trim() || !/[\p{L}\p{N}]/u.test(value)) return false
  // ZWJ/ZWNJ belong to legitimate emoji and Indic names. Other controls
  // cannot alter the apparent SKU or create an executable spreadsheet cell.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(
    value.replace(/[\u200c\u200d]/gu, ''))) return false
  const normalized = value.normalize('NFKC')
  return !/^[\p{White_Space}\p{Cf}\p{Mn}\p{Mc}\p{Me}]*[=+@-]/u.test(normalized)
}

export function captureTimeReadiness(raw: string, now = Date.now()): {
  ok: boolean; reason: string; ns: bigint | null
} {
  if (!raw.trim()) return { ok: false,
    reason: 'werkelijk bronmoment met expliciete tijdzone', ns: null }
  const instant = observedInstant(raw.trim())
  if (!instant) return { ok: false,
    reason: 'geldig ISO-bronmoment met expliciete tijdzone', ns: null }
  const nowNs = BigInt(Math.trunc(now)) * 1_000_000n
  if (instant.ns > nowNs + 300_000_000_000n)
    return { ok: false, reason: 'echt bronmoment ligt onveilig in de toekomst', ns: instant.ns }
  if (nowNs - instant.ns > 604_800_000_000_000n)
    return { ok: false, reason: 'opname ouder dan 7 dagen: nieuwe eigen waarneming nodig', ns: instant.ns }
  return { ok: true, reason: 'tijdvak voorlopig geschikt; originele broncontrole vereist', ns: instant.ns }
}

/** This checks only entered timestamps, never proves a physical paired shop. */
export function enteredCapturePairWarning(plus: string, deka: string): string | null {
  const a = captureTimeReadiness(plus)
  const b = captureTimeReadiness(deka)
  if (!a.ns || !b.ns) return null
  const gap = a.ns > b.ns ? a.ns - b.ns : b.ns - a.ns
  if (gap <= 86_400_000_000_000n) return null
  return 'De ingevoerde PLUS- en DekaMarkt-tijden liggen meer dan 24 uur uiteen. ' +
    'Observeer ' + (a.ns < b.ns ? 'PLUS' : 'DekaMarkt') +
    ' opnieuw voor een volledig vergelijkbaar weekmandje; oude bedragen worden niet hergebruikt.'
}

export type CaptureFieldNeed = {
  index: number
  need: PlannerCaptureGuideNeed
  missing: readonly string[]
}

/**
 * A mobile field checklist, not proof of a product or a usable price.
 * All rows remain tied to the original Planner index (the source CSV header is row 1).
 * An unavailable product also needs a real SKU/name/unit and observation moment;
 * a genuinely unobserved item cannot become a retailer product automatically.
 */
export function incompleteCaptureFields(
  store: CaptureStore, needs: readonly PlannerCaptureGuideNeed[],
  rows: Readonly<Record<string, LocalCaptureEntry>>,
  observedAt: string,
): CaptureFieldNeed[] {
  const seenSku = new Set<string>()
  return needs.flatMap((need, index) => {
    const row = rows[store + ':' + index]
    const missing: string[] = []
    if (!row || row.state === 'unseen') {
      missing.push('nog niet zelf waargenomen')
    } else {
      const time = captureTimeReadiness(observedAt)
      if (!time.ok) missing.push(time.reason)
      if (row.sku.trim()) {
        if (seenSku.has(row.sku.trim()))
          missing.push('dubbele artikelcode; origineel bronproduct maar één keer vastleggen')
        seenSku.add(row.sku.trim())
      }
      if (!safeOriginalCaptureLabel(row.sku))
        missing.push('geldige, spreadsheetveilige originele artikelcode')
      if (!safeOriginalCaptureLabel(row.name))
        missing.push('geldige, spreadsheetveilige originele productnaam')
      if (!['g', 'kg', 'ml', 'l', 'piece'].includes(row.unit))
        missing.push('geobserveerde verpakkingseenheid')
      if (row.state === 'available') {
        const amount = Number(row.amount.trim())
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(row.amount.trim()) ||
            !Number.isFinite(amount) || amount <= 0 ||
            amount > 100000 || (row.unit === 'piece' && !Number.isSafeInteger(amount)))
          missing.push('geldige echte pakinhoud')
        const count = Number(row.count.trim())
        if (!/^\d+$/u.test(row.count.trim()) || !Number.isSafeInteger(count) ||
            count < 1 || count > 1000)
          missing.push('geldig multipack-aantal')
        const cents = Number(row.cents.trim())
        if (!/^\d+$/u.test(row.cents.trim()) || !Number.isSafeInteger(cents) ||
            cents < 0 || cents > 1000000)
          missing.push('geldige geobserveerde prijs in centen')
      }
    }
    return missing.length ? [{ index, need, missing }] : []
  })
}

/** Portable, explicitly unpriced field reminder. It never contains fabricated source rows. */
export function offlineCaptureFieldChecklist(
  store: CaptureStore, needs: readonly PlannerCaptureGuideNeed[],
  rows: Readonly<Record<string, LocalCaptureEntry>>, observedAt: string,
): string {
  const open = incompleteCaptureFields(store, needs, rows, observedAt)
  if (!open.length) throw Error(store + ': geen ontbrekende invoervelden.')
  const lines = [
    'SUPA | ' + store + ' | mijn nog op te nemen winkelproducten',
    'PRIVÉ HERINNERING. Geen geaccepteerde retailerprijs, SKU-match of besparing.',
    'De fysieke Planner-vraag is geen bewijs van een winkelverpakking.',
    '',
    ...open.flatMap(({ index, need, missing }) => [
      'Bronblad regel ' + (index + 2) + ': ' + JSON.stringify(need.label),
      '  Werkelijke Planner-vraag: ' + readablePlannerDemandAmount(need.amount) +
        ' ' + JSON.stringify(need.unit),
      '  Zelf nog vastleggen/controleren: ' + missing.join('; '),
      '',
    ]),
    'Na echte waarneming: vul het originele mobiele formulier in en start',
    'afzonderlijk de bestaande broncontrole vóór een prijs of match te accepteren.',
    '',
  ]
  const text = lines.join('\n')
  if (new TextEncoder().encode(text).byteLength > 128000)
    throw Error('De openstaande winkelopnamelijst is te groot voor lokaal delen.')
  return text
}
