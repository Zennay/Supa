/**
 * Offline-only, human-readable CSV receipt for the private two-store browser.
 * This is NOT a retailer importer, rights attestation or public savings report.
 * An empty money cell means UNKNOWN, never zero. All cents stay whole integers.
 */
import type { OneStoreBasket, BasketTraceLine } from './domain/basket.ts'
import type { MatchUnit } from './domain/matching.ts'
import { privatePackUnitRate } from './features/comparison/privateUnitPrice.ts'
import { compareFullBaskets } from './domain/basketComparison.ts'
import { calculateDecimalPackCount } from './domain/decimalPackArithmetic.ts'

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
  'PLUS_pakinhoud', 'PLUS_pakeenheid', 'PLUS_stuks_per_verpakking',
  'PLUS_pakprijs_cent', 'PLUS_regel_cent', 'PLUS_indicatief_euro_per_eenheid', 'PLUS_status',
  'DekaMarkt_opnametijd', 'DekaMarkt_product_id', 'DekaMarkt_product',
  'DekaMarkt_hele_verpakkingen', 'DekaMarkt_pakinhoud',
  'DekaMarkt_pakeenheid', 'DekaMarkt_stuks_per_verpakking',
  'DekaMarkt_pakprijs_cent', 'DekaMarkt_regel_cent',
  'DekaMarkt_indicatief_euro_per_eenheid', 'DekaMarkt_status',
  'verschil_cent_DekaMarkt_minus_PLUS', 'vergelijking',
]

export function literalCsv(value: unknown, signedMoneyDelta = false): string {
  const raw = String(value ?? '')
  // NFKC discovers compatibility characters (e.g. full-width equals);
  // invisible marks and format controls may precede formula operators.
  // Apply the same conservative boundary to personal price reports and
  // shopping-note exports; NFKC changes only inspection, not original text.
  const prefix = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Mark}]*[=+@\-\u2212]/u
  // A negative difference is canonical arithmetic, not untrusted formula text.
  // All other user-supplied text still receives conservative formula escaping.
  const text = signedMoneyDelta && /^-\d+$/.test(raw)
    ? raw : prefix.test(raw.normalize('NFKC')) ? "'" + raw : raw
  return '"' + text.replaceAll('"', '""') + '"'
}

function advisory(line: Extract<BasketTraceLine, { status: 'matched' }>): string {
  const rate = privatePackUnitRate({
    amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count,
    priceCents: line.pricePerPackCents,
  })
  if (!rate) return ''
  const cents = rate.roundedCentsPerUnit
  // Exact cent formatting: don't reintroduce a binary floating rounding step
  // after matching a user's original pack and whole-pack price.
  return String(Math.floor(cents / 100)) + '.' + String(cents % 100).padStart(2, '0') +
    ' EUR/' + rate.unit + ' (indicatief)'
}

function storeColumns(
  capture: Capture | undefined,
  fresh: boolean,
  line: BasketTraceLine,
): string[] {
  if (!capture) return [...new Array<string>(10).fill(''), 'Geen eigen bronopname']
  if (!fresh) return [capture.observedAt, ...new Array<string>(9).fill(''), 'Opname toekomstig of ouder dan 7 dagen']
  if (line.status !== 'matched') {
    return [capture.observedAt, ...new Array<string>(9).fill(''), 'Onbekend: ' + line.reasons.join('; ')]
  }
  return [
    capture.observedAt, line.productId, line.productName, String(line.packs),
    String(line.pack.amount), line.pack.unit, String(line.pack.count),
    String(line.pricePerPackCents), String(line.lineTotalCents), advisory(line),
    'Eigen bronregel',
  ]
}

// Resolve original physical demand by canonical ID, not position, before
// emitting price rows to a spreadsheet (which is read outside the app).
function storeLinesForDemand(
  basket: OneStoreBasket, ingredients: readonly DemandRow[],
): BasketTraceLine[] {
  if (!Array.isArray(basket.lines) || basket.lines.length !== ingredients.length ||
      !Number.isSafeInteger(basket.selectedMealCount) || basket.selectedMealCount <= 0)
    throw new Error('Ongeldige privémand: de fysieke vraag is veranderd')
  const byId = new Map<string, BasketTraceLine>()
  for (let index = 0; index < basket.lines.length; index++) {
    if (!Object.hasOwn(basket.lines, index)) throw new Error('Onvolledige mandregel')
    const line = basket.lines[index]
    if (!line || typeof line.id !== 'string' || byId.has(line.id))
      throw new Error('Dubbele of ontbrekende ingrediënten in privémand')
    byId.set(line.id, line)
  }
  return ingredients.map(need => {
    const line = byId.get(need.id)
    if (!line || line.ingredientLabel !== need.label ||
        line.requirement.unit !== need.unit ||
        line.requirement.amount !== need.amount) {
      throw new Error('Originele ingrediëntvraag wijkt af van het geprijsde mandje')
    }
    return line
  })
}

function completeOwnStore(basket: OneStoreBasket, fresh: boolean): boolean {
  if (!fresh || !basket.lines.length ||
      basket.unresolvedLineCount !== 0 ||
      basket.matchedLineCount !== basket.lines.length ||
      !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0) return false
  let total = 0
  for (const line of basket.lines) {
    if (!line || line.status !== 'matched' ||
        !Number.isSafeInteger(line.packs) || line.packs <= 0 ||
        !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents <= 0 ||
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents <= 0 ||
        !Number.isSafeInteger(line.pricePerPackCents * line.packs) ||
        line.pricePerPackCents * line.packs !== line.lineTotalCents ||
        calculateDecimalPackCount([line.requirement], {
          amount: line.pack.amount, unit: line.pack.unit, count: line.pack.count,
        }) !== line.packs) return false
    total += line.lineTotalCents
    if (!Number.isSafeInteger(total)) return false
  }
  return total === basket.totalCents
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
  if (!ingredients.length || new Set(ingredients.map(item => item.id)).size !== ingredients.length)
    throw new Error('Onvolledig of dubbel privémandje')
  const plusLines = storeLinesForDemand(baskets.PLUS, ingredients)
  const dekaLines = storeLinesForDemand(baskets.DekaMarkt, ingredients)
  const verifiedStores = storeNames.every(store => completeOwnStore(baskets[store], fresh[store]))
  const checked = paired && verifiedStores
    ? compareFullBaskets({ baseline: baskets.PLUS, candidate: baskets.DekaMarkt })
    : null
  const comparable = checked?.claimable === true && checked.deltaCents !== null
  const canonicalDeltas = comparable
    ? new Map(checked.lineDeltas.map(item => [item.id, item.deltaCents]))
    : null
  if (comparable && (deltas.size !== canonicalDeltas!.size ||
      [...canonicalDeltas!].some(([id, cents]) => deltas.get(id) !== cents)))
    throw new Error('Prijsverschil komt niet overeen met de originele mandregels')
  const rows: string[][] = [header]
  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i]
    const delta = comparable ? canonicalDeltas!.get(item.id) : undefined
    rows.push([
      'ingredient', item.id, item.label, item.amount === null ? '' : String(item.amount), item.unit,
      ...storeColumns(captures.PLUS, fresh.PLUS, plusLines[i]),
      ...storeColumns(captures.DekaMarkt, fresh.DekaMarkt, dekaLines[i]),
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
  totalRow[13] = plusTotal === null ? '' : String(plusTotal)
  totalRow[15] = plusTotal === null ? 'Totaal onbekend' : 'Compleet eigen winkelmandje'
  totalRow[16] = captures.DekaMarkt?.observedAt ?? ''
  totalRow[24] = dekaTotal === null ? '' : String(dekaTotal)
  totalRow[26] = dekaTotal === null ? 'Totaal onbekend' : 'Compleet eigen winkelmandje'
  totalRow[27] = totalDelta === null ? '' : String(totalDelta)
  totalRow[28] = totalDelta === null
    ? 'Geen volledige twee-winkelvergelijking' : 'Volledige private bronvergelijking'
  rows.push(totalRow)
  const note = new Array<string>(header.length).fill('')
  note[0] = 'toelichting'
  note[2] = 'Uitsluitend eigen bronopnames. Geen actuele kassagarantie, bronrecht of openbare besparingsclaim.'
  note[28] = 'Leeg bedrag betekent onbekend, niet nul.'
  rows.push(note)
  if (rows.some(row => row.length !== header.length)) {
    throw new Error('Ongeldig privé CSV-overzicht')
  }
  const csv = rows.map(row => row.map((cell, column) => literalCsv(cell, column === 27)).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000) {
    throw new Error('Privé CSV-overzicht te groot')
  }
  return csv
}
