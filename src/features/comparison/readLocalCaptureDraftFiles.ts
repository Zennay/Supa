/**
 * Offline-only reading of user-selected, untrusted spreadsheet drafts.
 * All app and standalone comparison screens share the same bounded decoder
 * from the static offline import layer. Decoding is never price approval,
 * SKU matching or retailer permission; canonical source admission still follows.
 */
const maxDraftBytes = 256_000
const allowedDraftFilename = /\.(?:csv|tsv|txt)$/iu

type SourceReadOptions = { preserveBom?: boolean }
type SourceTextReader = (file: File, options?: SourceReadOptions) => Promise<string>

async function sharedSourceTextReader(): Promise<SourceTextReader> {
  // The public mapping page is an unbundled static module, so it cannot import
  // this TypeScript file. Keep both routes on the same decoder without duplicating
  // the UTF-8 / BOM-marked UTF-16 rules or the original source admission.
  const moduleUrl = `${import.meta.env.BASE_URL}own-source-text.mjs`
  const loaded: unknown = await import(/* @vite-ignore */ moduleUrl)
  if (!loaded || typeof loaded !== 'object' ||
      !('readOwnSourceTextFile' in loaded) ||
      typeof loaded.readOwnSourceTextFile !== 'function') {
    throw Error('De gedeelde lokale bronbestandslezer ontbreekt.')
  }
  return loaded.readOwnSourceTextFile as SourceTextReader
}

/**
 * Read a user-owned source file without guessing its retailer, price or clock.
 * Excel Unicode Text is accepted only for .txt/.tsv with an explicit UTF-16
 * LE/BE BOM. CSV/JSON remain strict UTF-8. Raw recovery may preserve its BOM.
 */
export async function readOwnSourceTextFile(
  file: File, options: SourceReadOptions = {},
): Promise<string> {
  if (!file.size || file.size > maxDraftBytes) {
    throw Error('Kies een niet-leeg eigen bronbestand tot 256 kB.')
  }
  return (await sharedSourceTextReader())(file, options)
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
  for (const file of files) output.push(await readOwnSourceTextFile(file, { preserveBom: true }))
  return output
}
