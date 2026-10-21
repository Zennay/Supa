import { euro } from '../../lib/money.ts'
import { samePhysicalDemand } from '../../domain/basketComparison.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import type { PreviewMatchLine } from './CaptureMatchingPreview.tsx'

const clean = (value: unknown) => String(value ?? '')
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .replace(/\s+/gu, ' ').trim().slice(0, 180)

function offer(line: PreviewMatchLine | null): string {
  if (!line || line.status !== 'matched' || !line.originalSku ||
    !Number.isSafeInteger(line.packs) || line.packs! <= 0 ||
    !Number.isSafeInteger(line.pricePerPackCents) ||
    !Number.isSafeInteger(line.lineTotalCents) ||
    line.pricePerPackCents! < 0 || line.lineTotalCents! < 0) {
    return 'geen bruikbare voorgestelde match; prijs onbekend'
  }
  return [
    clean(line.product) + ' · originele SKU ' + clean(line.originalSku),
    clean(line.packCount) + ' × ' + readablePlannerDemandAmount(line.packAmount) +
      ' ' + clean(line.packUnit) + ' per verpakking',
    clean(line.packs) + ' hele verpakkingen × ' +
      euro.formatCents(line.pricePerPackCents!) + ' = ' +
      euro.formatCents(line.lineTotalCents!) + ' (NIET BEVESTIGD)',
    'Indicatief ' + clean(line.unitPrice ?? 'eenheidsprijs niet berekenbaar'),
  ].join(' | ')
}

/** Portable, user-initiated source-review notes. No comparator and no total. */
export function privateTwoStorePreviewChecklist({
  plus, deka, plusObservedAt, dekaObservedAt, within24h, sourceFresh,
}: {
  plus: readonly PreviewMatchLine[]; deka: readonly PreviewMatchLine[]
  plusObservedAt: string; dekaObservedAt: string
  within24h: boolean; sourceFresh: boolean
}): string {
  if (!Array.isArray(plus) || !Array.isArray(deka) ||
      plus.length > 200 || deka.length > 200 ||
      !plusObservedAt || !dekaObservedAt) {
    throw Error('Geen geldig oorspronkelijk winkelopnamepaar om te bewaren.')
  }
  const dekaById = new Map(deka.map(line => [line.id, line]))
  const leftIds = new Set(plus.map(line => line.id))
  const output = [
    'SUPA · PRIVÉ · TWEE WINKELBRONNEN TER CONTROLE', '',
    'GEEN GOEDGEKEURDE PRIJZEN, WINKELRECHTEN, MANDBEDRAG OF BESPARINGSBEWIJS.',
    'Vul niets in op basis van geschatte winkeldata. Controleer zelf beide originele SKU’s.',
    'PLUS originele bron: ' + clean(plusObservedAt),
    'DekaMarkt originele bron: ' + clean(dekaObservedAt),
    within24h ? 'Bronmomenten binnen 24 uur.' :
      'LET OP: echte bronmomenten meer dan 24 uur uiteen. Herobserveer de oudste.',
    sourceFresh ? 'Beide bronmomenten lokaal binnen 7 dagen (nog niet extern geverifieerd).' :
      'LET OP: minimaal één bron verouderd of toekomstig. Geen actuele prijsvergelijking.',
    '',
  ]
  const append = (left: PreviewMatchLine | null, right: PreviewMatchLine | null, index: number) => {
    const demandEqual = !!left && !!right && left.label === right.label &&
      samePhysicalDemand(left, right)
    output.push(String(index + 1) + '. ' + clean(left?.label ?? right?.label))
    if (!demandEqual) {
      output.push('  Planner-vraag ongelijk of niet aanwezig in beide bronnen: controleren.')
      output.push('  PLUS: onbekend | DekaMarkt: onbekend', '')
      return
    }
    output.push('  Zelfde fysieke vraag: ' + readablePlannerDemandAmount(left!.amount) +
      ' ' + clean(left!.unit))
    output.push('  PLUS: ' + offer(left))
    output.push('  DekaMarkt: ' + offer(right), '')
  }
  plus.forEach((left, index) => append(left, dekaById.get(left.id) ?? null, index))
  let position = plus.length
  for (const right of deka) if (!leftIds.has(right.id)) append(null, right, position++)
  output.push(
    'Geen prijsverschil of winnaar berekend uit onbevestigde voorinzage.',
    'Na echte bronimport en persoonlijke bevestiging berekent de Supa-app',
    'alleen voor volledig en actueel gekoppelde mandjes een eigen privéverschil.', '',
  )
  const result = output.join('\n')
  if (new TextEncoder().encode(result).length > 256000) {
    throw Error('Privécontroleblad is te groot; gebruik de interactieve voorinzage.')
  }
  return result
}
