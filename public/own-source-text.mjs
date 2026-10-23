/**
 * One bounded, offline decoder for user-owned Supa source files.
 * Decoding never approves a price, SKU, retailer identity or source permission.
 */
const MAX_BYTES = 256_000

export async function readOwnSourceTextFile(file, { preserveBom = false } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || !file.size || file.size > MAX_BYTES) {
    throw Error('Kies een niet-leeg eigen bronbestand tot 256 kB.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
    throw Error('Het gekozen bronbestand is leeg of groter dan 256 kB.')
  }

  const isUtf16Le = bytes[0] === 0xff && bytes[1] === 0xfe
  const isUtf16Be = bytes[0] === 0xfe && bytes[1] === 0xff
  if ((isUtf16Le || isUtf16Be) && !/\.(?:tsv|txt)$/iu.test(String(file.name ?? ''))) {
    throw Error('UTF-16 wordt alleen ondersteund bij een eigen .tsv- of .txt-bestand met BOM. Bewaar CSV en JSON als UTF-8.')
  }

  let source
  try {
    source = new TextDecoder(
      isUtf16Le ? 'utf-16le' : isUtf16Be ? 'utf-16be' : 'utf-8',
      { fatal: true, ignoreBOM: preserveBom },
    ).decode(bytes)
  } catch {
    throw Error('Dit bronbestand heeft een ongeldige tekstcodering. Gebruik UTF-8 of expliciet UTF-16 TSV.')
  }
  if (!source.trim() || source.includes('\0')) {
    throw Error('Het gekozen bronbestand bevat geen bruikbare tekst of ongeldige NUL-tekens.')
  }
  return source
}
