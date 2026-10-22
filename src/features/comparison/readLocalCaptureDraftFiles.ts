/**
 * Offline-only reading of user-selected, *untrusted* spreadsheet drafts.
 * Decoding a file is NOT price approval, SKU matching or retailer permission.
 * Existing source conversion and canonical capture admission must still run.
 */
const maxDraftBytes = 256_000
const allowedDraftFilename = /\.(?:csv|tsv|txt)$/iu
const allowedSourceFilename = /\.(?:csv|tsv|txt|json)$/iu

/**
 * Read a user-owned source file without guessing its retailer, price or clock.
 * Excel's "Unicode Text" TSV may carry an explicit UTF-16 LE/BE BOM; other
 * formats remain strictly UTF-8. Never guess a legacy encoding from content.
 * Keep the BOM visible for the established CSV/JSON normalization layer.
 */
export async function readOwnSourceTextFile(file: File): Promise<string> {
  if (!allowedSourceFilename.test(file.name) || !file.size || file.size > maxDraftBytes) {
    throw Error('Kies een niet-leeg CSV-, TSV-, TXT- of JSON-bronbestand tot 256 kB.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > maxDraftBytes)
    throw Error('Het gekozen bronbestand is leeg of groter dan 256 kB.')
  const isUtf16Le = bytes[0] === 0xff && bytes[1] === 0xfe
  const isUtf16Be = bytes[0] === 0xfe && bytes[1] === 0xff
  const isUnicodeTsv = isUtf16Le || isUtf16Be
  if (isUnicodeTsv && !/\.tsv$/iu.test(file.name))
    throw Error('UTF-16 wordt alleen ondersteund bij een eigen .tsv-bestand met BOM. Bewaar CSV en JSON als UTF-8.')
  let source: string
  try {
    source = new TextDecoder(
      isUtf16Le ? 'utf-16le' : isUtf16Be ? 'utf-16be' : 'utf-8',
      { fatal: true, ignoreBOM: true },
    ).decode(bytes)
  } catch {
    throw Error('Dit bronbestand heeft een ongeldige tekstcodering. Gebruik UTF-8 of expliciet UTF-16 TSV.')
  }
  if (!source.trim() || source.includes('\0'))
    throw Error('Het gekozen bronbestand bevat geen bruikbare tekst of ongeldige NUL-tekens.')
  return source
}

export async function readLocalCaptureDraftFiles(files: readonly File[]): Promise<string[]> {
  if (files.length < 1 || files.length > 2) {
    throw Error('Kies één of twee originele winkelbladen (.csv, .tsv of .txt).')
  }
  // Reject the entire selection before reading anything. No partial restore.
  for (const file of files) {
    if (!allowedDraftFilename.test(file.name) || !file.size ||
        file.size > maxDraftBytes) {
      throw Error('Gebruik alleen een niet-leeg CSV-, TSV- of TXT-winkelblad tot 256 kB.')
    }
  }
  const output: string[] = []
  for (const file of files) output.push(await readOwnSourceTextFile(file))
  return output
}
