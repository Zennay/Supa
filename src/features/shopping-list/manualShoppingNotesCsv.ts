/** Private spreadsheet transfer for unpriced notes; never retailer evidence. */
import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'
import { privateNoteDuplicateKey } from './manualShoppingNoteIdentity.ts'
type Row = Pick<UnpricedShoppingNote, 'label' | 'store' | 'done'>
const header = 'supa-eigen-ongeprijsd-v1;winkel;artikel;afgevinkt'
const stores = new Set(['Algemeen', 'PLUS', 'DekaMarkt'])
const safeLabel = (label: string) => label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim()
// Always treat spreadsheet-compatible formula starters as literal shopper
// text, even after control, format, combining-mark and braille-blank prefixes.
// NFKC is inspection-only: the actual private label stays unchanged.
function potentialFormula(value: string): boolean {
  const inspected = value.normalize('NFKC').replace(
    /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}\p{Cc}\p{Zs}\p{Zl}\p{Zp}\u2800]*/u, '')
  return /^[=+@\-\u2212]/u.test(inspected)
}
function spreadsheetSafe(value: string): string {
  return value.startsWith("'") || potentialFormula(value) ? "'" + value : value
}
function originalCell(value: string): string {
  if (value.startsWith("''")) return value.slice(1)
  return value.startsWith("'") && potentialFormula(value.slice(1)) ? value.slice(1) : value
}
const quote = (value: string) => '"' + spreadsheetSafe(value).replace(/"/gu, '""') + '"'
export function exportUnpricedShoppingCsv(notes: readonly Row[]): string {
  return '\ufeff' + header + '\r\n' + notes.map(note =>
    ['eigen', note.store, note.label, note.done ? 'ja' : 'nee'].map(quote).join(';')).join('\r\n') + '\r\n'
}
/** The same four private columns as CSV, for spreadsheet-native file exchange.
 * Keep formula-shaped and literal apostrophe labels inert; reject cell-breaking
 * characters instead of silently changing a user's original grocery text.
 */
export function exportUnpricedShoppingTsv(notes: readonly Row[]): string {
  const lines = notes.map(note => {
    if (safeLabel(note.label) !== note.label)
      throw Error('Een boodschappenomschrijving bevat ongeldige tabeltekens.')
    return ['eigen', note.store, note.label, note.done ? 'ja' : 'nee']
      .map(spreadsheetSafe).join('\t')
  })
  return '\ufeff' + header.replace(/;/gu, '\t') + '\r\n' + lines.join('\r\n') + '\r\n'
}
/** Strict bounded semicolon CSV reader; no spreadsheet formula execution. */
export function importUnpricedShoppingCsv(source: string): Row[] {
  if (new TextEncoder().encode(source).length > 32768) throw Error('CSV groter dan 32 kB.')
  const text = source.replace(/^\ufeff/u, '')
  const rows: string[][] = []
  let fields: string[] = [], value = '', inside = false, endedQuote = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inside) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++ }
      else if (char === '"') { inside = false; endedQuote = true }
      else {
        if (char === '\r' || char === '\n') throw Error('CSV-velden mogen geen regeleinden bevatten.')
        value += char
      }
      continue
    }
    if (char === '"' && !value && !endedQuote) { inside = true; continue }
    if (char === ';') { fields.push(value); value = ''; endedQuote = false; continue }
    if (char === '\r') {
      if (text[i + 1] !== '\n') throw Error('CSV moet geldige CRLF-regeleinden hebben.')
      i++
    } else if (char !== '\n') {
      if (endedQuote || char === '"') throw Error('CSV bevat ongeldige aanhalingstekens.')
      value += char
      continue
    }
    fields.push(value); value = ''; endedQuote = false
    rows.push(fields); fields = []
    if (rows.length > 102) throw Error('Maximaal 100 eigen boodschappen.')
  }
  if (inside) throw Error('CSV heeft een onafgesloten tekstveld.')
  if (value || fields.length) rows.push([...fields, value])
  if (rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop()
  if (!rows.length || rows[0].join(';') !== header)
    throw Error('Gebruik alleen de Supa-CSV voor eigen ongeprijsde boodschappen.')
  if (rows.length < 2 || rows.length > 101) throw Error('CSV moet 1–100 boodschappen bevatten.')
  const seen = new Set<string>()
  return rows.slice(1).map(columns => {
    if (columns.length !== 4 || columns[0] !== 'eigen' || !stores.has(columns[1]) ||
        !['ja', 'nee'].includes(columns[3])) throw Error('CSV bevat een ongeldig artikel, winkel of vinkje.')
    const label = safeLabel(originalCell(columns[2]))
    if (!label || label.length > 140 || label !== originalCell(columns[2]))
      throw Error('CSV bevat een ongeldige omschrijving (max. 140 tekens).')
    const store = columns[1] as Row['store']
    const key = privateNoteDuplicateKey(store, label)
    if (seen.has(key)) throw Error('CSV bevat dubbele boodschappen bij dezelfde winkel.')
    seen.add(key)
    return { store, label, done: columns[3] === 'ja' }
  })
}

/** Excel/Calc clipboard copies cells as TSV, not as a .csv file. Only accept
 * Supa's exact unpriced four-column contract; never infer price columns. */
export function importUnpricedShoppingPaste(source: string): Row[] {
  if (new TextEncoder().encode(source).length > 32768) throw Error('Tabel groter dan 32 kB.')
  const unmarked = source.replace(/^\ufeff/u, '')
  // Existing Supa CSV remains the only accepted semicolon format. A simple
  // personal Excel/Calc tab-copy can be accepted without price/source columns.
  if (!unmarked.includes('\t')) return importUnpricedShoppingCsv(source)
  if (unmarked.includes('\r') && !unmarked.includes('\r\n'))
    throw Error('Gebruik een tabel met normale regeleinden.')
  const lines = unmarked.replace(/\r\n/gu, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  const heading = lines[0]?.split('\t')
  const supa = heading?.join('\t') === header.replace(/;/gu, '\t')
  const simple = heading?.join('\t').toLocaleLowerCase('nl-NL')
  const allowed = ['winkel\tartikel', 'artikel\twinkel',
    'winkel\tartikel\tafgevinkt', 'artikel\twinkel\tafgevinkt']
  if (!supa && !allowed.includes(simple ?? ''))
    throw Error('Gebruik kolommen winkel/artikel (eventueel afgevinkt), zonder prijs- of SKU-kolommen.')
  if (lines.length < 2 || lines.length > 101) throw Error('Plak 1–100 eigen boodschappen.')
  const storeFirst = supa || simple?.startsWith('winkel\t')
  const hasDone = supa || simple?.endsWith('\tafgevinkt')
  const originalRows = lines.slice(1).map(line => {
    if (line.includes('\r')) throw Error('Tabel bevat ongeldige regeleinden.')
    const cells = line.split('\t')
    if (cells.length !== (supa ? 4 : hasDone ? 3 : 2) ||
        (supa && cells[0] !== 'eigen')) throw Error('Tabel bevat extra of ontbrekende kolommen.')
    if (supa) return cells
    const store = cells[storeFirst ? 0 : 1]
    const label = cells[storeFirst ? 1 : 0]
    const checked = hasDone ? cells[2] : 'nee'
    return ['eigen', store, label, checked]
  })
  // Route both formats through the same exact validation for labels, stores,
  // duplicates and opt-in preview. No SKU, price or retailer proof is inferred.
  // A copied Supa cell already contains the literal-text apostrophe from its
  // CSV export. Re-escaping that cell would turn a leading '=...' label into
  // an extra apostrophe. Ordinary untrusted tables require the escape.
  const rawQuote = (value: string) => '"' + value.replace(/"/gu, '""') + '"'
  const encode = supa ? rawQuote : quote
  const csv = '\ufeff' + header + '\r\n' +
    originalRows.map(cells => cells.map(encode).join(';')).join('\r\n') + '\r\n'
  return importUnpricedShoppingCsv(csv)
}
