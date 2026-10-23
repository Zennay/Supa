/** Local, unaccepted PLUS/Deka source review; never a retailer importer or savings report. */
import { literalCsv } from '../../privateBasketComparisonCsv.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import type { PreviewMatchLine } from './CaptureMatchingPreview.tsx'
import { completePreviewProposal } from './privateTwoStorePreviewChecklist.ts'
import { samePrivatePhysicalDemand } from './samePrivatePhysicalDemand.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'

type Input = {
  plus: readonly PreviewMatchLine[]
  deka: readonly PreviewMatchLine[]
  plusObservedAt: string
  dekaObservedAt: string
  within24h: boolean
  sourceFresh: boolean
  plusFresh: boolean
  dekaFresh: boolean
  onlyOpen?: boolean
  focusStore?: 'all' | 'PLUS' | 'DekaMarkt'
  delimiter?: ',' | ';' | '\t'
}
const header = [
  'status', 'ingredient_id', 'ingredient', 'PLUS_oorspronkelijke_vraag',
  'DekaMarkt_oorspronkelijke_vraag', 'fysiek_dezelfde_vraag',
  'PLUS_bronmoment', 'PLUS_originele_sku', 'PLUS_product',
  'PLUS_pakhoeveelheid', 'PLUS_pakeenheid', 'PLUS_stuks_per_verpakking',
  'PLUS_pakprijs_cent_onbevestigd', 'PLUS_hele_verpakkingen',
  'PLUS_regel_cent_onbevestigd', 'PLUS_eenheidsprijs_indicatief', 'PLUS_matchstatus',
  'PLUS_bron_url', 'PLUS_bronsoort', 'PLUS_snapshot_sha256',
  'DekaMarkt_bronmoment', 'DekaMarkt_originele_sku', 'DekaMarkt_product',
  'DekaMarkt_pakhoeveelheid', 'DekaMarkt_pakeenheid', 'DekaMarkt_stuks_per_verpakking',
  'DekaMarkt_pakprijs_cent_onbevestigd', 'DekaMarkt_hele_verpakkingen',
  'DekaMarkt_regel_cent_onbevestigd', 'DekaMarkt_eenheidsprijs_indicatief',
  'DekaMarkt_matchstatus', 'DekaMarkt_bron_url', 'DekaMarkt_bronsoort',
  'DekaMarkt_snapshot_sha256', 'vervolgactie',
] as const

function quantity(line: PreviewMatchLine | undefined): string {
  return line ? readablePlannerDemandAmount(line.amount) + ' ' + line.unit : ''
}
function storeColumns(line: PreviewMatchLine | undefined, observedAt: string, fresh: boolean): string[] {
  if (!line) return [observedAt, ...Array<string>(9).fill(''), 'Ontbrekende bronmatch', '', '', '']
  if (!completePreviewProposal(line)) {
    // Keep identifiable original product facts even if its proposed price is
    // unusable. A blank SKU, package or price must never become invented zero.
    const missing = [
      !line.originalSku?.trim() ? 'productcode' : '',
      !line.product?.trim() ? 'productnaam' : '',
      !Number.isFinite(line.packAmount) || (line.packAmount ?? 0) <= 0 ||
        !line.packUnit || !Number.isSafeInteger(line.packCount) ||
        (line.packCount ?? 0) <= 0 ? 'verpakking' : '',
      !Number.isSafeInteger(line.pricePerPackCents) ||
        (line.pricePerPackCents ?? -1) < 0 ? 'hele-pak-prijs' : '',
      line.status !== 'matched' ? 'ingrediëntmatch' : '',
    ].filter(Boolean)
    return [observedAt, line.originalSku ?? '', line.product ?? '',
      Number.isFinite(line.packAmount) && (line.packAmount ?? 0) > 0
        ? readablePlannerDemandAmount(line.packAmount) : '',
      line.packUnit ?? '', Number.isSafeInteger(line.packCount) &&
        (line.packCount ?? 0) > 0 ? String(line.packCount) : '',
      '', '', '', '',
      'Nog controleren: ' + (missing.join(', ') || 'fysieke pakdekking / regelberekening') +
        (line.reasons.length ? '; ' + line.reasons.join('; ') : ''),
      line.sourceUrl ?? '', line.sourceKind ?? '', line.sourceSha256 ?? '']
  }
  return [observedAt, line.originalSku, line.product,
    readablePlannerDemandAmount(line.packAmount), line.packUnit,
    String(line.packCount), fresh ? String(line.pricePerPackCents) : '',
    String(line.packs), fresh ? String(line.lineTotalCents) : '',
    fresh ? line.unitPrice ?? '' : '',
    fresh ? 'Onbevestigd bronvoorstel' : 'Oude/onbruikbare bron; prijs opnieuw opnemen',
    line.sourceUrl ?? '', line.sourceKind ?? '', line.sourceSha256 ?? '']
}

/** Original candidate money only after canonical arithmetic; never deltas or totals. */
export function privateTwoStoreReviewCsv(input: Input): string {
  const { plus, deka, plusObservedAt, dekaObservedAt, within24h,
    sourceFresh, plusFresh, dekaFresh, onlyOpen = false, focusStore = 'all',
    delimiter = ';' } = input
  if (!Array.isArray(plus) || !Array.isArray(deka) ||
      plus.length > 200 || deka.length > 200 || !plusObservedAt || !dekaObservedAt) {
    throw Error('Geen geldig paar originele winkelopnames voor het overzicht.')
  }
  const ids = new Set<string>()
  for (const source of [plus, deka]) {
    const seen = new Set<string>()
    for (const line of source) {
      if (typeof line?.id !== 'string' || !line.id || seen.has(line.id)) {
        throw Error('Het winkelconcept bevat dubbele of ontbrekende ingrediëntregels.')
      }
      seen.add(line.id)
      ids.add(line.id)
    }
  }
  const plusRows = new Map(plus.map(line => [line.id, line]))
  const dekaRows = new Map(deka.map(line => [line.id, line]))
  const plusInstant = observedInstant(plusObservedAt)
  const dekaInstant = observedInstant(dekaObservedAt)
  const older = plusInstant && dekaInstant
    ? plusInstant.ns <= dekaInstant.ns ? 'PLUS' : 'DekaMarkt' : null
  const plusUsable = plusFresh && (within24h || older !== 'PLUS')
  const dekaUsable = dekaFresh && (within24h || older !== 'DekaMarkt')
  const body: string[][] = []
  for (const id of ids) {
    const left = plusRows.get(id)
    const right = dekaRows.get(id)
    const equal = !!left && !!right && left.label === right.label &&
      samePrivatePhysicalDemand(left, right)
    const plusOpen = !equal || !plusUsable || !completePreviewProposal(left ?? null)
    const dekaOpen = !equal || !dekaUsable || !completePreviewProposal(right ?? null)
    const complete = !plusOpen && !dekaOpen
    const open = plusOpen || dekaOpen
    if (onlyOpen && !(focusStore === 'PLUS' ? plusOpen :
      focusStore === 'DekaMarkt' ? dekaOpen : open)) continue
    const reason = !equal ? 'Corrigeer de oorspronkelijke fysieke Planner-vraag' :
      !plusFresh && !dekaFresh ? 'Neem beide winkelbronnen opnieuw op' :
      !plusFresh ? 'Neem PLUS opnieuw op; bron verouderd of ongeldig' :
      !dekaFresh ? 'Neem DekaMarkt opnieuw op; bron verouderd of ongeldig' :
      !within24h ? older
        ? 'Neem de oudste winkel (' + older + ') opnieuw op; meer dan 24 uur verschil'
        : 'Controleer beide bronmomenten: meer dan 24 uur uiteen' :
      !complete ? 'Controleer beide originele artikelen, verpakking en pakprijs' :
      'Na eigen controle kan de reguliere bronimport worden bevestigd'
    body.push([
      open ? 'Openstaand' : 'Alleen voorstel', id, left?.label ?? right?.label ?? '',
      quantity(left), quantity(right), equal ? 'ja' : 'nee',
      // Different physical demand means these cannot be compared; preserve
      // the original SKU/pack facts but suppress even draft money cells.
      ...storeColumns(left, plusObservedAt, plusUsable && equal),
      ...storeColumns(right, dekaObservedAt, dekaUsable && equal), reason,
    ])
  }
  if (onlyOpen && body.length === 0) throw Error('Er zijn geen openstaande winkelregels.')
  const output = [
    header.join(delimiter),
    ...body.map(row => row.map(value => literalCsv(value)).join(delimiter)),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(output).length > 256000) {
    throw Error('Het eigen broncontroleoverzicht is te groot.')
  }
  return output
}
