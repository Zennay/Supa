/** Private spreadsheet transfer for unpriced notes; never retailer evidence. */
import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'
type Row = Pick<UnpricedShoppingNote, 'label' | 'store' | 'done'>
const header = 'supa-eigen-ongeprijsd-v1;winkel;artikel;afgevinkt'
const stores = new Set(['Algemeen', 'PLUS', 'DekaMarkt'])
const safeLabel = (label: string) => label.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim()
function spreadsheetSafe(value: string): string {
  if (value.startsWith("'")) return "'" + value
  return /^[\s\u200b-\u200f\ufeff]*[=+@-]/u.test(value) ? "'" + value : value
}
function originalCell(value: string): string {
  if (value.startsWith("''")) return value.slice(1)
  if (/^'[\s\u200b-\u200f\ufeff]*[=+@-]/u.test(value)) return value.slice(1)
  return value
}
const quote = (value: string) => '"' + spreadsheetSafe(value).replace(/"/gu, '""') + '"'
export function exportUnpricedShoppingCsv(notes: readonly Row[]): string {
  return '\ufeff' + header + '\r\n' + notes.map(note =>
    ['eigen', note.store, note.label, note.done ? 'ja' : 'nee'].map(quote).join(';')).join('\r\n') + '\r\n'
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
    const key = JSON.stringify([store, label.normalize('NFC').toLocaleLowerCase('nl-NL')])
    if (seen.has(key)) throw Error('CSV bevat dubbele boodschappen bij dezelfde winkel.')
    seen.add(key)
    return { store, label, done: columns[3] === 'ja' }
  })
}

/** Excel/Calc clipboard copies cells as TSV, not as a .csv file. Only accept
 * Supa's exact unpriced four-column contract; never infer price columns. */
export function importUnpricedShoppingPaste(source: string): Row[] {
  if (!source.replace(/^\ufeff/u, '').startsWith('supa-eigen-ongeprijsd-v1\t')) {
    return importUnpricedShoppingCsv(source)
  }
  if (new TextEncoder().encode(source).length > 32768) throw Error('Tabel groter dan 32 kB.')
  const lines = source.replace(/^\ufeff/u, '').replace(/\r\n/gu, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (!lines.length || lines[0] !== header.replace(/;/gu, '\t'))
    throw Error('Plak vier kolommen uit het eigen ongeprijsde Supa-invulblad.')
  if (lines.length < 2 || lines.length > 101) throw Error('Plak 1–100 eigen boodschappen.')
  const originalRows = lines.slice(1).map(line => {
    if (line.includes('\r')) throw Error('Tabel bevat ongeldige regeleinden.')
    const cells = line.split('\t')
    if (cells.length !== 4 || cells[0] !== 'eigen') throw Error('Tabel bevat extra of ontbrekende kolommen.')
    return cells
  })
  // Reuse exactly the same admitted schema, duplicate checking and length limits.
  const csv = '\ufeff' + header + '\r\n' +
    originalRows.map(cells => cells.map(quote).join(';')).join('\r\n') + '\r\n'
  return importUnpricedShoppingCsv(csv)
}
