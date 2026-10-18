/**
 * Offline-only, human-readable CSV receipt for the private two-store browser.
 * This is NOT a retailer importer, rights attestation or public savings report.
 * An empty money cell means UNKNOWN, never zero. All cents stay whole integers.
 */
import type { OneStoreBasket, BasketTraceLine } from './domain/basket.ts'
import type { MatchUnit } from './domain/matching.ts'

type Store = 'PLUS' | 'DekaMarkt'
type Capture = { observedAt: string }
type DemandRow = { id: string; label: string; amount: number | null; unit: MatchUnit }
type StoreBaskets = Record<Store, OneStoreBasket>
type StoreFreshness = Record<Store, boolean>
type SourceMoments = Partial<Record<Store, Capture>>

const storeNames: Store[] = ['PLUS', 'DekaMarkt']
const header = [
  'soort', 'ingredient_id', 'ingredient', 'behoefte', 'eenheid',
  'PLUS_opnametijd', 'PLUS_product_id', 'PLUS_product', 'PLUS_hele_verpakkingen',
  'PLUS_pakprijs_cent', 'PLUS_regel_cent', 'PLUS_indicatief_euro_per_eenheid', 'PLUS_status',
  'DekaMarkt_opnametijd', 'DekaMarkt_product_id', 'DekaMarkt_product',
  'DekaMarkt_hele_verpakkingen', 'DekaMarkt_pakprijs_cent', 'DekaMarkt_regel_cent',
  'DekaMarkt_indicatief_euro_per_eenheid', 'DekaMarkt_status',
  'verschil_cent_DekaMarkt_minus_PLUS', 'vergelijking',
]

function literalCsv(value: unknown, signedMoneyDelta = false): string {
  const raw = String(value ?? '')
  // NFKC discovers compatibility characters (e.g. full-width equals);
  // invisible marks may precede spreadsheet formula operators.
  const prefix = /^[\p{White_Space}\p{Cf}\p{Mn}\p{Mc}\p{Me}]*[=+@-]/u
  // A negative difference is canonical arithmetic, not untrusted formula text.
  // All other user-supplied text still receives conservative formula escaping.
  const text = signedMoneyDelta && /^-\d+$/.test(raw)
    ? raw : prefix.test(raw.normalize('NFKC')) ? "'" + raw : raw
  return '"' + text.replaceAll('"', '""') + '"'
}

function advisory(line: Extract<BasketTraceLine, { status: 'matched' }>): string {
  const count = line.pack.count
  const metric = line.pack.unit === 'kg' || line.pack.unit === 'l' ? 1000 : 1
  const quantity = line.pack.amount * count * metric
  const unitAmount = line.pack.unit === 'piece' ? 1 : 1000
  const centsPerUnit = line.pricePerPackCents * unitAmount / quantity
  if (!(quantity > 0) || !Number.isFinite(centsPerUnit) || centsPerUnit < 0) return ''
  const label = line.pack.unit === 'g' || line.pack.unit === 'kg' ? 'kg'
    : line.pack.unit === 'ml' || line.pack.unit === 'l' ? 'liter' : 'stuk'
  return (centsPerUnit / 100).toFixed(2) + ' EUR/' + label + ' (indicatief)'
}

function storeColumns(
  capture: Capture | undefined,
  fresh: boolean,
  line: BasketTraceLine,
): string[] {
  if (!capture) return ['', '', '', '', '', '', '', 'Geen eigen bronopname']
  if (!fresh) return [capture.observedAt, '', '', '', '', '', '', 'Opname toekomstig of ouder dan 7 dagen']
  if (line.status !== 'matched') {
    return [capture.observedAt, '', '', '', '', '', '', 'Onbekend: ' + line.reasons.join('; ')]
  }
  return [
    capture.observedAt, line.productId, line.productName, String(line.packs),
    String(line.pricePerPackCents), String(line.lineTotalCents), advisory(line), 'Eigen bronregel',
  ]
}

function completeOwnStore(basket: OneStoreBasket, fresh: boolean): boolean {
  return fresh && basket.lines.length > 0 && basket.unresolvedLineCount === 0 &&
    basket.matchedLineCount === basket.lines.length && Number.isSafeInteger(basket.totalCents) &&
    basket.lines.every(line => line.status === 'matched')
}

/** Exactly one private schema; never use this human receipt as 9-column source data. */
export function createPrivateBasketComparisonCsv(input: {
  ingredients: DemandRow[]
  captures: SourceMoments
  baskets: StoreBaskets
  fresh: StoreFreshness
  paired: boolean
  deltas: ReadonlyMap<string, number>
}): string {
  const { ingredients, captures, baskets, fresh, paired, deltas } = input
  if (!ingredients.length ||
      baskets.PLUS.lines.length !== ingredients.length ||
      baskets.DekaMarkt.lines.length !== ingredients.length) {
    throw new Error('Onvolledig privémandje')
  }
  const comparable = paired && storeNames.every(store => completeOwnStore(baskets[store], fresh))
  const rows: string[][] = [header]
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i]
    const delta = comparable ? deltas.get(item.id) : undefined
    rows.push([
      'ingredient', item.id, item.label, item.amount === null ? '' : String(item.amount), item.unit,
      ...storeColumns(captures.PLUS, fresh.PLUS, baskets.PLUS.lines[i]),
      ...storeColumns(captures.DekaMarkt, fresh.DekaMarkt, baskets.DekaMarkt.lines[i]),
      delta === undefined ? '' : String(delta),
      comparable && delta !== undefined ? 'Volledig privé vergelijkbaar' : 'Verschil onbekend',
    ])
  }
  const plusTotal = completeOwnStore(baskets.PLUS, fresh.PLUS) ? baskets.PLUS.totalCents : null
  const dekaTotal = completeOwnStore(baskets.DekaMarkt, fresh.DekaMarkt) ? baskets.DekaMarkt.totalCents : null
  const totalDelta = comparable && plusTotal !== null && dekaTotal !== null
    ? dekaTotal - plusTotal : null
  // Construct summary rows using the same fixed schema as every ingredient.
  // All unknown financial cells remain empty, including incomplete totals.
  const totalRow = new Array<string>(header.length).fill('')
  totalRow[0] = 'mandje_totaal'
  totalRow[5] = captures.PLUS?.observedAt ?? ''
  totalRow[10] = plusTotal === null ? '' : String(plusTotal)
  totalRow[12] = plusTotal === null ? 'Totaal onbekend' : 'Compleet eigen winkelmandje'
  totalRow[13] = captures.DekaMarkt?.observedAt ?? ''
  totalRow[18] = dekaTotal === null ? '' : String(dekaTotal)
  totalRow[20] = dekaTotal === null ? 'Totaal onbekend' : 'Compleet eigen winkelmandje'
  totalRow[21] = totalDelta === null ? '' : String(totalDelta)
  totalRow[22] = totalDelta === null
    ? 'Geen volledige twee-winkelvergelijking' : 'Volledige private bronvergelijking'
  rows.push(totalRow)
  const note = new Array<string>(header.length).fill('')
  note[0] = 'toelichting'
  note[2] = 'Uitsluitend eigen bronopnames. Geen actuele kassagarantie, bronrecht of openbare besparingsclaim.'
  note[22] = 'Leeg bedrag betekent onbekend, niet nul.'
  rows.push(note)
  if (rows.some(row => row.length !== header.length)) {
    throw new Error('Ongeldig privé CSV-overzicht')
  }
  const csv = rows.map(row => row.map((cell, column) => literalCsv(cell, column === 21)).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000) {
    throw new Error('Privé CSV-overzicht te groot')
  }
  return csv
}
