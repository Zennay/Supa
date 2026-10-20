import type { OfflineCapture, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/** The existing canonical, nine-column offline CSV importer accepts these exact
 * names. Original identity is only a lookup aid, NEVER an observation grant. */
const columns = ['retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available'] as const

type Identity = Readonly<{ id: string; name: string }>
type Reobservation = Readonly<{ store: OfflineRetailer; originalObservedAt: string;
  products: readonly Identity[] }>

function validOriginalIdentity(text: unknown, max: number): text is string {
  if (typeof text !== 'string' || !text || text.length > max ||
      text.trim() !== text || !/[\p{L}\p{N}]/u.test(text) ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text)) return false
  // Excel can evaluate cells with formula prefixes even when CSV-quoted.
  // Never mutate an original SKU with a leading apostrophe: that would make
  // the newly captured product a *different* SKU on canonical reimport.
  const leading = text.normalize('NFKC')
    .replace(/^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}]*/gu, '')
  return !/^[=+@\-\u2212]/u.test(leading)
}

function collect(capture: OfflineCapture): Reobservation {
  if (!capture || (capture.retailer !== 'PLUS' && capture.retailer !== 'DekaMarkt') ||
      typeof capture.observedAt !== 'string' ||
      !Array.isArray(capture.products) || capture.products.length < 1 ||
      capture.products.length > 1000)
    throw new Error('Kies een oorspronkelijke PLUS- of DekaMarkt-winkelopname.')
  const products: Identity[] = []
  const seen = new Set<string>()
  for (const product of capture.products) {
    if (!product ||
        !validOriginalIdentity(product.id, 100) ||
        !validOriginalIdentity(product.name, 160))
      throw new Error('Een oorspronkelijke SKU of naam is niet geschikt voor een CSV-invulblad. Gebruik de lege opnamegids.')
    if (seen.has(product.id))
      throw new Error('Dubbele originele SKU. Maak eerst een nieuwe correcte winkelopname.')
    seen.add(product.id)
    products.push({ id: product.id, name: product.name })
  }
  return { store: capture.retailer, originalObservedAt: capture.observedAt, products }
}

const literalCsv = (text: string): string => '"' + text.replace(/"/gu, '""') + '"'

/** A genuine full-store recapture sheet, not a valid observation yet.
 * NO previous observedAt, pack price, stock state, pack size or units survive.
 * Capturing ONLY some old rows never silently rolls forward missing old prices.
 */
export function privateFullStoreRecaptureCsv(capture: OfflineCapture,
  delimiter: ',' | ';' = ','): string {
  if (delimiter !== ',' && delimiter !== ';')
    throw new Error('CSV-scheiding moet komma of puntkomma zijn.')
  const source = collect(capture)
  const lines = [
    columns.join(delimiter),
    ...source.products.map(product => [
      literalCsv(source.store), '', literalCsv(product.id), literalCsv(product.name),
      '', '', '', '', '',
    ].join(delimiter)),
  ]
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000)
    throw new Error('Het nieuwe invulblad overschrijdt 256 kB. Maak kleinere echte opnames.')
  return csv
}

/** Separate field instructions; cannot be mistaken for CSV price evidence. */
export function privateFullStoreRecaptureGuide(capture: OfflineCapture): string {
  const source = collect(capture)
  const lines = [
    'SUPA · nieuwe echte bronopname · ' + source.store,
    'Oude originele opname: ' + source.originalObservedAt,
    'Dit is een privé ZOEKLIJST, geen nieuwe of actuele retailerprijsbron.',
    'Oorspronkelijke SKU en naam zijn uitsluitend herkenningshulpen.',
    'Het CSV-blad bevat GEEN oude prijzen, verpakkingen, beschikbaarheid of bronmoment.',
    '',
    '1. Leg zelf een werkelijk nieuw ISO 8601-bronmoment met UTC-offset vast.',
    '2. Bevestig per artikel de oorspronkelijke SKU/naam, echte verpakking,',
    '   eenheid (g/kg/ml/l/piece), multipack, prijs in HELE eurocenten',
    '   en beschikbaarheid (true of false).',
    '3. Gebruik hetzelfde echte opname-uur per winkel in iedere ingevulde rij.',
    '4. Niet meer gevonden? Verwijder die rij uit het CSV-bestand of vul',
    '   alleen werkelijke onbeschikbaarheid in; verzin geen prijs van € 0.',
    '5. Bewaar SKU-kolommen als tekst bij spreadsheetbewerking (voorloopnullen).',
    '6. Controleer het gehele winkelbestand via Supa Planner/Vergelijk.',
    '   Een import blijft privé en vereist handmatige SKU- en pakgoedkeuring.',
    '',
    'Originele artikelen om zelf opnieuw te bekijken: ' + source.products.length,
    'Geen onafhankelijke bronrechten, werkelijke nieuwe observatie of besparing bewezen.',
  ]
  const text = lines.join('\n') + '\n'
  if (new TextEncoder().encode(text).length > 120000)
    throw new Error('De bronhandleiding is te groot.')
  return text
}

/** One same-workbook field route for BOTH original retailer inventories.
 * It deliberately does not synthesize an aligned capture time or cross-store
 * SKU correspondence: only the canonical reviewed planner basket does that.
 */
export function privatePairedStoreRecaptureCsv(
  plus: OfflineCapture, deka: OfflineCapture,
  delimiter: ',' | ';' = ',',
): string {
  if (plus?.retailer !== 'PLUS' || deka?.retailer !== 'DekaMarkt')
    throw new Error('Selecteer de oorspronkelijke PLUS- en DekaMarkt-opnames.')
  const first = privateFullStoreRecaptureCsv(plus, delimiter).replace(/^\uFEFF/u, '')
    .trimEnd().split('\r\n')
  const second = privateFullStoreRecaptureCsv(deka, delimiter).replace(/^\uFEFF/u, '')
    .trimEnd().split('\r\n')
  if (!first.length || first[0] !== second[0])
    throw new Error('De twee winkelbladen hebben geen identiek CSV-formaat.')
  const csv = '\uFEFF' + [first[0], ...first.slice(1), ...second.slice(1)]
    .join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000)
    throw new Error('Gecombineerde PLUS/Deka-opname groter dan 256 kB. Gebruik twee losse winkelbladen.')
  return csv
}

export function privatePairedStoreRecaptureGuide(
  plus: OfflineCapture, deka: OfflineCapture,
): string {
  if (plus?.retailer !== 'PLUS' || deka?.retailer !== 'DekaMarkt')
    throw new Error('Selecteer oorspronkelijke PLUS- en DekaMarkt-opnames.')
  // Make sure both complete original identity lists are canonical and
  // unambiguous before offering one dual-store field capture.
  const first = collect(plus)
  const second = collect(deka)
  const text = [
    'SUPA · nieuwe volledige bronopnames PLUS en DekaMarkt',
    'PLUS eerdere opname: ' + first.originalObservedAt,
    'DekaMarkt eerdere opname: ' + second.originalObservedAt,
    'Identiteiten: PLUS ' + first.products.length +
      ', DekaMarkt ' + second.products.length + '.',
    'Dit bestand bevat geen nieuwe waarneming, actuele prijs of bronrechten.',
    'De oude SKU en productnaam dienen ALLEEN om producten terug te vinden.',
    '',
    'Vul per winkel elke daadwerkelijk opnieuw bekeken rij in.',
    'Gebruik per winkel precies één werkelijke nieuwe ISO-tijd met UTC-offset.',
    'Voor een eventuele vergelijking moeten die twee ECHTE opnames maximaal',
    '24 uur uiteen liggen en binnen het geldige 7-daagse bronvenster vallen.',
    'Bepaal verpakking/eenheid, beschikbaarheid en prijs in hele eurocenten',
    'uitsluitend vanuit de nieuwe bron; oude waarden zijn bewust leeg.',
    'Sla SKU-kolommen op als tekst om voorloopnullen te behouden.',
    'Verwijder niet opnieuw gevonden regels of registreer werkelijk niet-beschikbaar.',
    'Importeer het ingevulde CSV-bestand in Supa Vergelijk; controleer beide',
    'winkelproducten en het identieke fysieke weekmandje handmatig.',
    'Geen volledige dekking? Het prijsverschil blijft onbekend.',
  ].join('\n') + '\n'
  if (new TextEncoder().encode(text).length > 120000)
    throw new Error('De gecombineerde bronhandleiding is te groot.')
  return text
}
