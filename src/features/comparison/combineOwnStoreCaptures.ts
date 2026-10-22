import { parseOfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'

/** A standalone spreadsheet separator, never part of a sourced SKU or price. */
export function splitOwnStorePastedSheets(raw: string): string[] {
  // Clipboard/spreadsheet exports often leave an empty boundary line or
  // horizontal spaces around the visible --- separator. Strip only boundary
  // line breaks; keep every original CSV field/space for strict admission.
  const removeOuterLineBreaks = (value: string) =>
    value.replace(/^(?:\r\n|\n|\r)+|(?:\r\n|\n|\r)+$/gu, '')
  const sheets = removeOuterLineBreaks(raw)
    .split(/(?:\r\n|\n|\r)[ \t]*---[ \t]*(?:\r\n|\n|\r)/u)
    .map(removeOuterLineBreaks)
  if (sheets.length > 2) throw Error('Gebruik precies één losse --- regel tussen twee winkelbladen.')
  if (sheets.some(sheet => !sheet.trim())) throw Error('Beide originele winkelbladen moeten productgegevens bevatten.')
  return sheets
}

/** Combine two strictly admitted single-retailer captures without editing any
 * original SKU, observed timestamp, package, available flag or price. */
export function combineTwoOwnShopCaptures(inputs: readonly string[], nowMs = Date.now()): string {
  if (inputs.length !== 2) throw Error('Geef twee afzonderlijke winkelopnames.')
  const captures: unknown[] = []
  const shops = new Set<string>()
  for (const source of inputs) {
    const parsed = parseOfflinePriceSnapshots(source, nowMs)
    const names = Object.keys(parsed.captures)
    if (names.length !== 1) throw Error('Per blad precies één waargenomen winkel.')
    if (shops.has(names[0])) throw Error('Dubbele winkel: kies PLUS en DekaMarkt.')
    shops.add(names[0])
    const original: unknown = JSON.parse(source)
    if (!original || typeof original !== 'object' ||
        !('captures' in original) || !Array.isArray(original.captures) ||
        original.captures.length !== 1) throw Error('Originele opname ongeldig.')
    captures.push(original.captures[0])
  }
  const combined = JSON.stringify({ schema: 'supa-offline-prices-v1', captures })
  const accepted = parseOfflinePriceSnapshots(combined, nowMs)
  if (!accepted.captures.PLUS || !accepted.captures.DekaMarkt)
    throw Error('PLUS of DekaMarkt ontbreekt.')
  return combined
}
