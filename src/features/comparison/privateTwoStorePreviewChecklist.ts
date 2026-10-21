import { euro } from '../../lib/money.ts'
import { calculateDecimalPackCount } from '../../domain/decimalPackArithmetic.ts'
import type { MatchUnit } from '../../domain/matching.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import type { PreviewMatchLine } from './CaptureMatchingPreview.tsx'
import { samePrivatePhysicalDemand } from './samePrivatePhysicalDemand.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'

const clean = (value: unknown) => String(value ?? '')
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
  .replace(/\s+/gu, ' ').trim().slice(0, 180)

function offer(line: PreviewMatchLine | null,
  describeReason?: (value: string) => string, usable = true): string {
  const identity = line ? [
    line.product?.trim() ? 'origineel bronproduct ' + clean(line.product) : '',
    line.originalSku?.trim() ? 'originele SKU ' + clean(line.originalSku) : '',
  ].filter(Boolean).join(' | ') : ''
  if (!usable) return 'prijs en eenheidsprijs onbekend; bron opnieuw opnemen. ' + identity
  if (!completePreviewProposal(line)) {
    return 'geen complete betrouwbare voorgestelde match; prijs onbekend. ' +
      identity + ' | ' + (line?.reasons?.length && describeReason
        ? clean(describeReason(line.reasons[0]))
        : 'Originele code, pakinhoud en hele-pak-prijs handmatig controleren.')
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

/** A draft labelled 'matched' can still lack a complete original pack-price fact. */
export function completePreviewProposal(line: PreviewMatchLine | null): line is
  PreviewMatchLine & { product: string; originalSku: string; packAmount: number;
    packUnit: string; packCount: number; packs: number;
    pricePerPackCents: number; lineTotalCents: number } {
  return !!line && line.status === 'matched' && !!line.product?.trim() &&
    !!line.originalSku?.trim() &&
    typeof line.amount === 'number' && Number.isFinite(line.amount) && line.amount > 0 &&
    // Physical pieces cannot be bought as an unreviewed fractional demand.
    (line.unit !== 'piece' || Number.isSafeInteger(line.amount)) &&
    Number.isFinite(line.packAmount) && (line.packAmount ?? 0) > 0 &&
    !!line.packUnit && (line.packUnit !== 'piece' ||
      Number.isSafeInteger(line.packAmount)) &&
    Number.isSafeInteger(line.packCount) && (line.packCount ?? 0) > 0 &&
    Number.isSafeInteger(line.packs) && (line.packs ?? 0) > 0 &&
    Number.isSafeInteger(line.pricePerPackCents) && (line.pricePerPackCents ?? -1) >= 0 &&
    Number.isSafeInteger(line.lineTotalCents) && (line.lineTotalCents ?? -1) >= 0 &&
    // A line with arithmetically consistent cents is still not a usable
    // shopping proposal when it underbuys the original physical demand.
    calculateDecimalPackCount([{ amount: line.amount, unit: line.unit as MatchUnit }], {
      amount: line.packAmount!, unit: line.packUnit as MatchUnit,
      count: line.packCount!,
    }) === line.packs &&
    BigInt(line.packs!) * BigInt(line.pricePerPackCents!) === BigInt(line.lineTotalCents!)
}

/** Portable, user-initiated source-review notes. No comparator and no total. */
export function privateTwoStorePreviewChecklist({
  plus, deka, plusObservedAt, dekaObservedAt, within24h, sourceFresh,
  plusFresh = sourceFresh, dekaFresh = sourceFresh, describeReason,
}: {
  plus: readonly PreviewMatchLine[]; deka: readonly PreviewMatchLine[]
  plusObservedAt: string; dekaObservedAt: string
  within24h: boolean; sourceFresh: boolean
  plusFresh?: boolean; dekaFresh?: boolean
  focusStore?: 'all' | 'PLUS' | 'DekaMarkt'
  describeReason?: (value: string) => string
}): string {
  if (!Array.isArray(plus) || !Array.isArray(deka) ||
      plus.length > 200 || deka.length > 200 ||
      !plusObservedAt || !dekaObservedAt) {
    throw Error('Geen geldig oorspronkelijk winkelopnamepaar om te bewaren.')
  }
  const plusInstant = observedInstant(plusObservedAt)
  const dekaInstant = observedInstant(dekaObservedAt)
  const older = plusInstant && dekaInstant
    ? plusInstant.ns <= dekaInstant.ns ? 'PLUS' : 'DekaMarkt' : null
  const plusUsable = plusFresh && (within24h || older !== 'PLUS')
  const dekaUsable = dekaFresh && (within24h || older !== 'DekaMarkt')
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
      samePrivatePhysicalDemand(left, right)
    output.push(String(index + 1) + '. ' + clean(left?.label ?? right?.label))
    if (!demandEqual) {
      output.push('  Planner-vraag ongelijk of niet aanwezig in beide bronnen: controleren.')
      output.push('  PLUS oorspronkelijke vraag: ' + (left
        ? readablePlannerDemandAmount(left.amount) + ' ' + clean(left.unit) : 'ontbreekt'))
      output.push('  DekaMarkt oorspronkelijke vraag: ' + (right
        ? readablePlannerDemandAmount(right.amount) + ' ' + clean(right.unit) : 'ontbreekt'))
      output.push('  PLUS: ' + offer(left, describeReason, false))
      output.push('  DekaMarkt: ' + offer(right, describeReason, false), '')
      return
    }
    output.push('  Zelfde fysieke vraag: PLUS ' +
      readablePlannerDemandAmount(left!.amount) + ' ' + clean(left!.unit) +
      ' = DekaMarkt ' + readablePlannerDemandAmount(right!.amount) +
      ' ' + clean(right!.unit))
    output.push('  PLUS: ' + offer(left, describeReason, plusUsable))
    output.push('  DekaMarkt: ' + offer(right, describeReason, dekaUsable), '')
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

/** Physical demands needing match completion OR recapture due to stale/unpaired
 * source moments. All source timestamps remain original; no prices are accepted.
 */
export function privateTwoStoreMissingChecklist(
  input: Parameters<typeof privateTwoStorePreviewChecklist>[0],
): string {
  if (!Array.isArray(input.plus) || !Array.isArray(input.deka) ||
      input.plus.length > 200 || input.deka.length > 200) {
    throw Error('Het oorspronkelijke controleblad is te groot.')
  }
  const plusById = new Map(input.plus.map(line => [line.id, line]))
  const dekaById = new Map(input.deka.map(line => [line.id, line]))
  const plusInstant = observedInstant(input.plusObservedAt)
  const dekaInstant = observedInstant(input.dekaObservedAt)
  const older = plusInstant && dekaInstant
    ? plusInstant.ns <= dekaInstant.ns ? 'PLUS' : 'DekaMarkt' : null
  const plusUsable = (input.plusFresh ?? input.sourceFresh) &&
    (input.within24h || older !== 'PLUS')
  const dekaUsable = (input.dekaFresh ?? input.sourceFresh) &&
    (input.within24h || older !== 'DekaMarkt')
  const focusStore = input.focusStore ?? 'all'
  const incomplete = new Set([...plusById.keys(), ...dekaById.keys()].filter(id => {
    const left = plusById.get(id) ?? null
    const right = dekaById.get(id) ?? null
    const same = !!left && !!right && left.label === right.label &&
      samePrivatePhysicalDemand(left, right)
    const plusOpen = !same || !plusUsable || !completePreviewProposal(left)
    const dekaOpen = !same || !dekaUsable || !completePreviewProposal(right)
    return focusStore === 'PLUS' ? plusOpen : focusStore === 'DekaMarkt'
      ? dekaOpen : plusOpen || dekaOpen
  }))
  if (incomplete.size === 0) {
    throw Error('Geen openstaande of opnieuw op te nemen winkelregels.')
  }
  return privateTwoStorePreviewChecklist({
    ...input,
    plus: input.plus.filter(line => incomplete.has(line.id)),
    deka: input.deka.filter(line => incomplete.has(line.id)),
  })
}
