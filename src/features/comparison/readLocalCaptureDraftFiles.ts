/**
 * Offline-only reading of user-selected, *untrusted* spreadsheet drafts.
 * Returning the exact decoded text does not admit products, prices or permissions.
 * The canonical source preflight runs only after an explicit preview click.
 */
const maxDraftBytes = 256_000
const allowedDraftFilename = /\.(?:csv|tsv|txt)$/iu

export async function readLocalCaptureDraftFiles(files: readonly File[]): Promise<string[]> {
  if (files.length < 1 || files.length > 2) {
    throw Error('Kies één of twee originele winkelbladen (.csv, .tsv of .txt).')
  }
  // Reject the whole selection before reading any file. No partial restore.
  for (const file of files) {
    if (!allowedDraftFilename.test(file.name) || !file.size ||
        file.size > maxDraftBytes) {
      throw Error('Gebruik alleen een niet-leeg CSV-, TSV- of TXT-winkelblad tot 256 kB.')
    }
  }
  const output: string[] = []
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > maxDraftBytes) {
      throw Error('Het gekozen winkelblad is leeg of groter dan 256 kB.')
    }
    let original: string
    try {
      // Keep a leading BOM visible to the canonical parser: do not silently
      // rewrite the physical source the user is about to review.
      original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(bytes)
    } catch {
      throw Error('Dit winkelblad is geen geldige UTF-8-tekst. Exporteer als UTF-8 CSV.')
    }
    if (!original.trim() || original.includes('\0')) {
      throw Error('Het gekozen winkelblad bevat geen bruikbare tekst.')
    }
    output.push(original)
  }
  return output
}
