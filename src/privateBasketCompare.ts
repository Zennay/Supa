/**
 * Supa M3 private browser full basket comparison. A separate Vite entrypoint
 * reusing canonical domain money/pack functions; no remote data collection.
 * Own source observations are NOT written retailer rights or field-study proof.
 */
import { renderPrivateBasketSnapshot } from './privateBasketSnapshotExport.ts'
import { createPrivateBasketComparisonCsv } from './privateBasketComparisonCsv.ts'
import { currentTripKey, saveTripProgress, loadTripProgress } from './privateShoppingProgress.ts'
import { compareFullBaskets } from './domain/basketComparison.ts'
import { calculateDecimalPackCount } from './domain/decimalPackArithmetic.ts'
import { privateBasketMissingReason } from './domain/privateBasketMissingReason.ts'
import type { BasketTraceLine, OneStoreBasket } from './domain/basket.ts'
import type { MatchUnit } from './domain/matching.ts'

type StoreName = 'PLUS' | 'DekaMarkt'
type ObservedProduct = {
  id: string
  name: string
  packAmount: number | null
  packUnit: MatchUnit
  packCount?: number
  priceCents: number | null
  available: boolean
}
type Capture = { retailer: StoreName; observedAt: string; products: ObservedProduct[] }
type Source = { schema: 'supa-offline-prices-v1' | 'supa-private-single-store-prices-v1'; captures: Capture[] }
type DemandLine = {
  id: string
  label: string
  amount: number | null
  unit: MatchUnit
  productIds: Record<StoreName, string | null>
}
type Demand = { schema: 'supa-private-basket-demand-v1'; selectedMealCount: number; ingredients: DemandLine[] }

const stores: StoreName[] = ['PLUS', 'DekaMarkt']
const units: MatchUnit[] = ['g', 'kg', 'ml', 'l', 'piece']
const limit = 256000
const dayNs = 86400000000000n
const weekNs = 7n * dayNs
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

const combined = document.querySelector<HTMLInputElement>('#combined')!
const plus = document.querySelector<HTMLInputElement>('#plus')!
const deka = document.querySelector<HTMLInputElement>('#deka')!
const demandFile = document.querySelector<HTMLInputElement>('#demand')!
const sessionFile = document.querySelector<HTMLInputElement>('#session')!
const compare = document.querySelector<HTMLButtonElement>('#compare')!
const status = document.querySelector<HTMLDivElement>('#price-status')!
const result = document.querySelector<HTMLElement>('#result')!
const summary = document.querySelector<HTMLDivElement>('#summary')!
const coverageMeters = {
  PLUS: document.querySelector<HTMLProgressElement>('#coverage-plus')!,
  DekaMarkt: document.querySelector<HTMLProgressElement>('#coverage-deka')!,
}
const coverageLabels = {
  PLUS: document.querySelector<HTMLElement>('#coverage-plus-text')!,
  DekaMarkt: document.querySelector<HTMLElement>('#coverage-deka-text')!,
}
const budgetInput = document.querySelector<HTMLInputElement>('#budget-euros')!
const budgetStatus = document.querySelector<HTMLDivElement>('#budget-status')!
let budgetTotals: Record<StoreName, number | null> | null = null
let budgetValidThroughNs: Record<StoreName, bigint> | null = null
const capturesLabel = document.querySelector<HTMLParagraphElement>('#captures')!
const rows = document.querySelector<HTMLTableSectionElement>('#rows')!
const nextActions = document.querySelector<HTMLElement>('#next-actions')!
const missingItems = document.querySelector<HTMLUListElement>('#missing-items')!
let missingTasks: string[] = []
const trip = document.querySelector<HTMLElement>('#trip')!
const tripStore = document.querySelector<HTMLSelectElement>('#trip-store')!
const tripItems = document.querySelector<HTMLElement>('#trip-items')!
const tripSummary = document.querySelector<HTMLElement>('#trip-summary')!
let tripBaskets: Record<StoreName, OneStoreBasket> | null = null
let tripEligible: Record<StoreName, boolean> = { PLUS: false, DekaMarkt: false }
let tripValidUntilNs: Record<StoreName, bigint> | null = null
let tripCapturedAt: Record<StoreName, string> | null = null
let comparisonValidThroughNs: bigint | null = null
let freshnessRepaintTimer: number | null = null
let shownPriceExpiryNs: bigint | null = null
let lastPrivateSource: Source | null = null
let lastPrivateDemand: Demand | null = null
function forgetPrivateComparison(): void {
  lastPrivateSource = null
  lastPrivateDemand = null
  shownPriceExpiryNs = null
  if (freshnessRepaintTimer !== null) window.clearTimeout(freshnessRepaintTimer)
  freshnessRepaintTimer = null
}
let privateComparisonCsv: string | null = null
let privateCsvFreshUntilNs: bigint | null = null
const ticked = new Set<string>()
let inputRevision = 0

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined

const validText = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.trim() === value && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/^[=+@-]/u.test(value)

function safeTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?([+-])(\d\d):(\d\d)$/.exec(value)
  if (!m) return false
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] =
    [m[1],m[2],m[3],m[4],m[5],m[6],m[8],m[9]].map(Number)
  if (year < 2000 || year > 2100 || zoneMinute > 59 ||
      (m[7] === '+' ? zoneHour > 14 || (zoneHour === 14 && zoneMinute !== 0)
        : zoneHour > 12 || (zoneHour === 12 && zoneMinute !== 0))) return false
  const civil = new Date(0)
  civil.setUTCFullYear(year, month - 1, day)
  civil.setUTCHours(hour, minute, second, 0)
  return civil.getUTCFullYear() === year &&
    civil.getUTCMonth() === month - 1 && civil.getUTCDate() === day &&
    civil.getUTCHours() === hour && civil.getUTCMinutes() === minute &&
    civil.getUTCSeconds() === second && Number.isFinite(Date.parse(value))
}

function sourceFrom(value: unknown): Source {
  if (!record(value) || !Array.isArray(value.captures) ||
      !(value.schema === 'supa-offline-prices-v1' && value.captures.length === 2 ||
        value.schema === 'supa-private-single-store-prices-v1' && value.captures.length === 1)) {
    throw Error('Onbekend prijsbronformaat')
  }
  const known = new Set<StoreName>()
  const captures = value.captures.map((item: unknown): Capture => {
    if (!record(item) || !stores.includes(item.retailer as StoreName) ||
        known.has(item.retailer as StoreName) || !safeTime(item.observedAt) ||
        !Array.isArray(item.products) || !item.products.length || item.products.length > 1000) {
      throw Error('Ongeldige winkelopname')
    }
    const retailer = item.retailer as StoreName
    known.add(retailer)
    const ids = new Set<string>()
    const products = item.products.map((p: unknown): ObservedProduct => {
      if (!record(p) || !validText(p.id, 100) || ids.has(p.id) ||
          !validText(p.name) || !units.includes(p.packUnit as MatchUnit) ||
          !(p.packAmount === null || (typeof p.packAmount === 'number' &&
            Number.isFinite(p.packAmount) && p.packAmount > 0 && p.packAmount <= 100000)) ||
          !(p.priceCents === null || (Number.isSafeInteger(p.priceCents) &&
            (p.priceCents as number) >= 0 && (p.priceCents as number) <= 1000000)) ||
          !(p.packCount === undefined || (Number.isSafeInteger(p.packCount) &&
            (p.packCount as number) > 0 && (p.packCount as number) <= 1000)) ||
          typeof p.available !== 'boolean' ||
          (p.available && (p.packAmount === null || p.priceCents === null ||
            !Number.isSafeInteger(p.packCount)))) {
        throw Error('Ongeldige prijs of winkelproduct')
      }
      ids.add(p.id)
      return {
        id: p.id, name: p.name, packAmount: p.packAmount as number | null,
        packUnit: p.packUnit as MatchUnit, packCount: p.packCount as number | undefined,
        priceCents: p.priceCents as number | null, available: p.available,
      }
    })
    return { retailer, observedAt: item.observedAt as string, products }
  })
  if (known.size !== captures.length) throw Error('Dubbele winkelbron')
  return { schema: value.schema as Source['schema'], captures }
}

function demandFrom(value: unknown): Demand {
  if (!record(value) || value.schema !== 'supa-private-basket-demand-v1' ||
      !Number.isSafeInteger(value.selectedMealCount) ||
      (value.selectedMealCount as number) < 1 || (value.selectedMealCount as number) > 1000 ||
      !Array.isArray(value.ingredients) || value.ingredients.length < 1 ||
      value.ingredients.length > 1000 ||
      Object.keys(value).some(key => !['schema','selectedMealCount','ingredients'].includes(key))) {
    throw Error('Ongeldig fysiek mandvraagformaat')
  }
  const ids = new Set<string>()
  const ingredients = value.ingredients.map((item: unknown): DemandLine => {
    if (!record(item) || !validText(item.id, 100) || ids.has(item.id) ||
        !validText(item.label) || !units.includes(item.unit as MatchUnit) ||
        (item.amount !== null && (typeof item.amount !== 'number' ||
          !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000)) ||
        !record(item.productIds) ||
        Object.keys(item).some(key => !['id','label','amount','unit','productIds'].includes(key)) ||
        Object.keys(item.productIds).some(key => !stores.includes(key as StoreName))) {
      throw Error('Ongeldige hoeveelheid of productkoppeling')
    }
    ids.add(item.id)
    const productIds = {} as Record<StoreName, string | null>
    for (const store of stores) {
      const id = own(item.productIds, store)
      if (id !== null && id !== undefined && !validText(id, 100)) {
        throw Error('Ongeldige winkelproduct-ID')
      }
      productIds[store] = typeof id === 'string' ? id : null
    }
    return {
      id: item.id, label: item.label, amount: item.amount as number | null,
      unit: item.unit as MatchUnit, productIds,
    }
  })
  return {
    schema: 'supa-private-basket-demand-v1',
    selectedMealCount: value.selectedMealCount as number, ingredients,
  }
}

async function readSource(file: File): Promise<string> {
  if (!file.size || file.size > limit) throw Error('Bronbestand is te groot of leeg')
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
}
function parseOneOwnSource(raw: string, convertOwnStoreCsv: (csv: string) => string): Source {
  // Supa's existing standalone source validator handles user-saved JSON;
  // the same canonical CSV converter continues to govern every spreadsheet.
  const parsed: unknown = JSON.parse(raw.trimStart().startsWith('{')
    ? raw : convertOwnStoreCsv(raw))
  const source = sourceFrom(parsed)
  if (source.captures.length !== 1) throw Error('Verwacht één echte winkelopname per bestand.')
  return source
}

async function parseSource(): Promise<Source> {
  const file = combined.files?.[0]
  const left = plus.files?.[0]
  const right = deka.files?.[0]
  if ((file && (left || right)) || (!file && !left && !right)) {
    throw Error('Kies één gecombineerd bestand of eigen winkel-CSV’s')
  }
  // Use one strict canonical converter for BOTH individual source sheets.
  // Each file may have its own comma, semicolon or tab separator.
  const converterUrl = `${import.meta.env.BASE_URL}offline-two-store-csv.mjs`
  const { convertOwnStoreCsv } = await import(/* @vite-ignore */ converterUrl)
  if (file) {
    const raw = await readSource(file)
    return sourceFrom(JSON.parse(file.name.toLowerCase().endsWith('.json') ||
      raw.trimStart().startsWith('{') ? raw : convertOwnStoreCsv(raw)))
  }
  if (left && right) {
    const [a, b] = await Promise.all([readSource(left), readSource(right)])
    const first = parseOneOwnSource(a, convertOwnStoreCsv)
    const second = parseOneOwnSource(b, convertOwnStoreCsv)
    const captures = [...first.captures, ...second.captures]
    if (captures.length !== 2 || captures[0].retailer !== 'PLUS' ||
        captures[1].retailer !== 'DekaMarkt')
      throw Error('Het bestand bij PLUS moet een PLUS-opname zijn; bij DekaMarkt een DekaMarkt-opname.')
    const composed = { schema: 'supa-offline-prices-v1', captures }
    if (new TextEncoder().encode(JSON.stringify(composed)).length > limit)
      throw Error('Twee winkelbronnen samen overschrijden 256 KB')
    return sourceFrom(composed)
  }
  const one = parseOneOwnSource(await readSource((left ?? right)!), convertOwnStoreCsv)
  const selectedInput = left ? 'PLUS' : 'DekaMarkt'
  if (one.captures.length !== 1 || one.captures[0].retailer !== selectedInput)
    throw Error('Het gekozen winkelvak hoort niet bij de winkelcode in de originele opname.')
  return sourceFrom(one)
}

async function readOwnBasketInputs(): Promise<{ source: Source; demand: Demand }> {
  const ownSession = sessionFile.files?.[0]
  if (ownSession) {
    const root: unknown = JSON.parse(await readSource(ownSession))
    if (!record(root) || root.schema !== 'supa-private-basket-session-v1' ||
        Object.keys(root).sort().join(',') !== 'demand,schema,source') {
      throw Error('Dit is geen ondersteunde privésessie')
    }
    // Reuse existing strict local intake; no automatic retail provenance or
    // inferred product equivalence flows from a saved user file.
    const source = sourceFrom(root.source)
    const demand = demandFrom(root.demand)
    for (const ingredient of demand.ingredients) {
      for (const store of stores) {
        const id = ingredient.productIds[store]
        if (id === null) continue
        const capture = source.captures.find(item => item.retailer === store)
        const product = capture?.products.find(item => item.id === id)
        const family = (unit: MatchUnit) => unit === 'g' || unit === 'kg' ? 'weight'
          : unit === 'ml' || unit === 'l' ? 'volume' : 'piece'
        if (!product || family(product.packUnit) !== family(ingredient.unit)) {
          throw Error('Opgeslagen SKU komt niet overeen met eigen winkelopname')
        }
      }
    }
    return { source, demand }
  }
  const demandInput = demandFile.files?.[0]
  if (!demandInput) throw Error('Mandvraag ontbreekt')
  const [source, rawDemand] = await Promise.all([parseSource(), readSource(demandInput)])
  return { source, demand: demandFrom(JSON.parse(rawDemand)) }
}

function unresolved(d: DemandLine, reason: string): BasketTraceLine {
  return {
    id: d.id, ingredientLabel: d.label,
    requirement: { amount: d.amount, unit: d.unit },
    status: 'unresolved', reasons: [reason], matchScore: null,
  }
}
function storeBasket(store: StoreName, capture: Capture | undefined, demand: Demand): OneStoreBasket {
  if (!capture) return {
    store: { id: store, name: store }, selectedMealCount: demand.selectedMealCount,
    lines: demand.ingredients.map(item => unresolved(item,
      'Voor deze winkel is geen echte bronopname ingelezen. Prijs en beschikbaarheid onbekend.')),
    totalCents: 0, matchedLineCount: 0, unresolvedLineCount: demand.ingredients.length,
  }
  const products = new Map(capture.products.map(p => [p.id, p]))
  // A single selected SKU across two ingredient identities is not two
  // separately purchased packages. Both lines remain unknown until the user
  // combines the physical demand; never show a misleading partial pack cost.
  const selectedCounts = new Map<string, number>()
  for (const ingredient of demand.ingredients) {
    const id = ingredient.productIds[store]
    if (id !== null) selectedCounts.set(id, (selectedCounts.get(id) ?? 0) + 1)
  }
  const lines: BasketTraceLine[] = []
  let totalCents = 0
  let matchedLineCount = 0
  let unresolvedLineCount = 0
  for (const d of demand.ingredients) {
    const choice = d.productIds[store]
    if (choice !== null && (selectedCounts.get(choice) ?? 0) > 1) {
      lines.push(unresolved(d,
        'Hetzelfde winkelartikel is voor meerdere ingrediënten gekozen: voeg de fysieke hoeveelheden samen en koppel opnieuw.'))
      unresolvedLineCount++
      continue
    }
    const p = choice === null ? undefined : products.get(choice)
    const missing = privateBasketMissingReason(choice, p, d.amount)
    if (missing !== null || !p || p.priceCents === null ||
        p.packAmount === null || d.amount === null) {
      lines.push(unresolved(d, missing ?? 'De bron bevat geen compleet controleerbare fysieke winkelregel'))
      unresolvedLineCount++
      continue
    }
    const count = p.packCount ?? 1
    const packs = calculateDecimalPackCount(
      [{ amount: d.amount, unit: d.unit }],
      { amount: p.packAmount, unit: p.packUnit, count },
    )
    const cents = packs === null ? NaN : packs * p.priceCents
    if (!Number.isSafeInteger(packs) || packs! < 1 ||
        !Number.isSafeInteger(cents) || cents < 0 ||
        !Number.isSafeInteger(totalCents + cents)) {
      lines.push(unresolved(d, 'Geen veilig passend aantal volledige verpakkingen'))
      unresolvedLineCount++
      continue
    }
    totalCents += cents
    matchedLineCount++
    lines.push({
      id: d.id, ingredientLabel: d.label, requirement: { amount: d.amount, unit: d.unit },
      status: 'matched', productId: p.id, productName: p.name,
      packs: packs!, pack: { amount: p.packAmount, unit: p.packUnit, count },
      pricePerPackCents: p.priceCents, lineTotalCents: cents,
      matchScore: 100, reasons: ['Expliciet gekozen uit eigen winkelbron'],
    })
  }
  return {
    store: { id: store, name: store }, selectedMealCount: demand.selectedMealCount,
    lines, totalCents, matchedLineCount, unresolvedLineCount,
  }
}

function nanoseconds(raw: string): bigint {
  const milliseconds = Date.parse(raw)
  if (!Number.isFinite(milliseconds)) throw Error('Ongeldige waarnemingstijd')
  const fraction = (/\.(\d{1,9})[+-]\d\d:\d\d$/.exec(raw)?.[1] ?? '').padEnd(9, '0')
  return BigInt(milliseconds - Number(fraction.slice(0, 3))) * 1000000n +
    BigInt(fraction || '0')
}
const abs = (value: bigint) => value < 0n ? -value : value
function create(tag: 'strong' | 'p' | 'small' | 'li', content?: string): HTMLElement {
  const el = tag === 'strong' ? document.createElement('strong') :
    tag === 'p' ? document.createElement('p') :
      tag === 'small' ? document.createElement('small') : document.createElement('li')
  if (content !== undefined) el.textContent = content
  return el
}
function setStatus(message: string, isError = false): void {
  status.textContent = message
  status.className = 'notice' + (isError ? ' error' : '')
}
// Budget comparison is derived exclusively from two complete, fresh canonical
// whole-pack basket totals. The user supplies an optional personal amount.
function budgetInCents(text: string): number | null {
  const match = /^(0|[1-9]\d{0,6})(?:[,.](\d{1,2}))?$/.exec(text)
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000000 ? cents : null
}
function renderBudget(): void {
  const input = budgetInput.value.trim()
  if (!input) {
    budgetStatus.textContent = 'Geen budget ingevuld. De eigen mandprijzen blijven los daarvan zichtbaar.'
    budgetStatus.className = 'notice'
    return
  }
  const ceiling = budgetInCents(input)
  if (ceiling === null) {
    budgetStatus.textContent = 'Vul een positief eigen bedrag tot € 1.000.000 in, bijvoorbeeld 50,00.'
    budgetStatus.className = 'notice warning'
    return
  }
  const now = BigInt(Date.now()) * 1000000n
  const messages = stores.map(store => {
    const total = budgetTotals?.[store]
    const expiry = budgetValidThroughNs?.[store]
    if (result.hidden || total === null || total === undefined || expiry === undefined ||
        now > expiry) return store + ': onbekend (geen volledig recent eigen mandje)'
    const diff = ceiling - total
    return store + ': ' + (diff >= 0
      ? euro.format(diff / 100) + ' ruimte binnen jouw budget'
      : euro.format(-diff / 100) + ' boven jouw budget')
  })
  const eligible = stores.some(store => budgetTotals?.[store] !== null &&
    budgetTotals?.[store] !== undefined && budgetValidThroughNs?.[store] !== undefined &&
    now <= budgetValidThroughNs[store] && !result.hidden)
  budgetStatus.textContent = messages.join(' · ') + (eligible
    ? '. Alleen eigen oorspronkelijke winkelwaarnemingen; geen kassagarantie of goedkoopste-winkelclaim.'
    : '. Zonder een volledig recent winkelmandje geen budgetconclusie.')
  budgetStatus.className = eligible ? 'notice' : 'notice warning'
}
budgetInput.addEventListener('input', () => {
  clearComparisonTextPreview()
  // Editing an optional budget is still a user action: invalidate an elapsed
  // seven-day price observation before publishing any new financial context.
  if (invalidateAgedComparison()) return
  renderBudget()
})

function advisoryUnitPrice(line: Extract<BasketTraceLine,{status:'matched'}>): string {
  const pack = line.pack
  const family = pack.unit === 'g' || pack.unit === 'kg' ? 'kg' :
    pack.unit === 'ml' || pack.unit === 'l' ? 'liter' : 'stuk'
  const size = pack.amount * pack.count *
    (pack.unit === 'kg' || pack.unit === 'l' ? 1000 : 1)
  const rate = family === 'stuk' ? 1 : 1000
  const euros = (line.pricePerPackCents / 100) * rate / size
  return size > 0 && Number.isFinite(euros) && euros >= 0
    ? euro.format(euros) + '/' + family + ' (indicatief)' : 'Eenheidsprijs onbekend'
}
function lineCell(
  line: BasketTraceLine,
  observedAt: string | null,
  validCapture: boolean,
): HTMLTableCellElement {
  const cell = document.createElement('td')
  if (line.status === 'unresolved') {
    cell.textContent = 'Onbekend — ' + line.reasons.join('; ')
    return cell
  }
  // Same rule as the downloadable provenance CSV: a historical or future
  // capture must NEVER display a usable live price for this ingredient.
  // Product identity remains visible for deliberate human recollection.
  if (!validCapture) {
    cell.textContent = 'Prijs onbekend voor huidig mandje — originele ' +
      (observedAt === null ? 'winkelopname ontbreekt' :
        'opname ' + observedAt + ' is toekomstig of ouder dan zeven dagen') +
      '. Opnieuw zelf controleren: ' + line.productName + ' · SKU ' + line.productId
    return cell
  }
  const title = create('strong', line.productName)
  const pack = create('p', String(line.packs) + ' hele verpakking(en) × ' +
    String(line.pack.amount).replace('.', ',') + ' ' + line.pack.unit +
    (line.pack.count > 1 ? ' (× ' + line.pack.count + ')' : ''))
  const price = create('small', euro.format(line.pricePerPackCents / 100) +
    ' per verpakking · ' + advisoryUnitPrice(line) + ' · ' +
    euro.format(line.lineTotalCents / 100) + ' bekende privéregel')
  cell.append(title, pack, price)
  return cell
}
type TripLine = Extract<BasketTraceLine, { status: 'matched' }>

function shoppingTripLines(): TripLine[] {
  const store = tripStore.value as StoreName
  const basket = tripBaskets?.[store]
  if (!tripEligible[store] || !tripValidUntilNs ||
      BigInt(Date.now()) * 1000000n > tripValidUntilNs[store] || !basket || basket.unresolvedLineCount !== 0 ||
      basket.matchedLineCount !== basket.lines.length ||
      basket.lines.some(line => line.status !== 'matched')) return []
  return basket.lines.filter((line): line is TripLine => line.status === 'matched')
}

function tripProgress(): void {
  const lines = shoppingTripLines()
  const count = lines.filter(line => ticked.has(line.id)).length
  const remaining = lines.length - count
  const total = tripBaskets?.[tripStore.value as StoreName]?.totalCents
  tripSummary.textContent = String(count) + ' van ' + lines.length +
    ' producten afgevinkt · nog ' + remaining + ' artikel(en).' +
    (typeof total === 'number' && Number.isSafeInteger(total)
      ? ' Oorspronkelijke volledige opnameprijs: ' + euro.format(total / 100) + '.' : '') +
    ' Prijzen zijn historische privéwaarnemingen, geen kassagarantie.'
}

function nowForTripExpired(store: StoreName): boolean {
  return tripEligible[store] && !!tripValidUntilNs &&
    BigInt(Date.now()) * 1000000n > tripValidUntilNs[store]
}
function invalidateAgedComparison(): boolean {
  if (result.hidden) return false
  const nowNs = BigInt(Date.now()) * 1000000n
  // A complete two-store financial outcome must be hidden as soon as either
  // original observation ages past the seventh day.
  if (shownPriceExpiryNs !== null && nowNs > shownPriceExpiryNs &&
      lastPrivateSource && lastPrivateDemand) {
    // A backgrounded tab may not have fired the wall-clock timer. Recompute
    // using only the previously accepted original facts and keep the still
    // valid shop available rather than hiding all results.
    repaintPrivateEvidence(lastPrivateSource, lastPrivateDemand)
    return true
  }
  if (comparisonValidThroughNs !== null && nowNs > comparisonValidThroughNs) {
    result.hidden = true
    clearComparisonTextPreview()
    clearTrip()
    setStatus('Een van de oorspronkelijke winkelopnames is inmiddels ouder dan zeven dagen. Het eerder getoonde volledige prijsverschil is niet meer geldig. Open nieuwe echte winkelopnames en vergelijk opnieuw.', true)
    return true
  }
  // A single valid retailer can supply a shopping list even when the other
  // source is incomplete; expire only that retailer's list in that case.
  if (tripBaskets && tripValidUntilNs &&
      nowForTripExpired(tripStore.value as StoreName)) {
    const expired = tripStore.value as StoreName
    tripEligible[expired] = false
    const other: StoreName = expired === 'PLUS' ? 'DekaMarkt' : 'PLUS'
    if (tripEligible[other] && !nowForTripExpired(other)) {
      tripStore.value = other
      ticked.clear()
      renderTrip()
    } else {
      clearTrip()
    }
    clearComparisonTextPreview()
    setStatus('De winkelopname voor ' + expired + ' is inmiddels ouder dan zeven dagen. Deze privéboodschappenlijst is vervallen; ververs de eigen prijsbron voor die winkel.', true)
    return true
  }
  return false
}

function renderTrip(): void {
  const preview = document.querySelector<HTMLTextAreaElement>('#trip-copy-preview')!
  preview.hidden = true
  preview.value = ''
  tripItems.replaceChildren()
  const lines = shoppingTripLines()
  if (!tripBaskets || lines.length === 0) {
    trip.hidden = true
    return
  }
  trip.hidden = false
  for (const option of Array.from(tripStore.options)) {
    option.disabled = !tripEligible[option.value as StoreName]
  }
  for (const line of lines) {
    const item = document.createElement('label')
    item.className = 'trip-line'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = ticked.has(line.id)
    check.setAttribute('aria-label', line.packs + ' hele verpakkingen ' + line.productName + ' afvinken')
    check.addEventListener('change', () => {
      const preview = document.querySelector<HTMLTextAreaElement>('#trip-copy-preview')!
      preview.hidden = true
      preview.value = ''
      if (invalidateAgedComparison()) return
      if (check.checked) ticked.add(line.id)
      else ticked.delete(line.id)
      tripProgress()
    })
    const description = document.createElement('span')
    description.textContent = String(line.packs) + ' × ' + line.productName +
      ' · ' + String(line.pack.amount).replace('.', ',') + ' ' + line.pack.unit +
      (line.pack.count > 1 ? ' × ' + line.pack.count + ' per verpakking' : '') +
      ' · ' + euro.format(line.lineTotalCents / 100) + ' bij opname' +
      ' · SKU ' + line.productId
    item.append(check, description)
    tripItems.append(item)
  }
  tripProgress()
}

function validOneStoreTrip(basket: OneStoreBasket, demand: Demand, ageNs: bigint): boolean {
  return ageNs >= 0n && ageNs <= weekNs &&
    demand.ingredients.length > 0 && basket.lines.length === demand.ingredients.length &&
    basket.matchedLineCount === basket.lines.length &&
    basket.unresolvedLineCount === 0 && Number.isSafeInteger(basket.totalCents) &&
    basket.lines.every(line => line.status === 'matched')
}
function loadTrip(
  left: OneStoreBasket, right: OneStoreBasket, demand: Demand,
  ages: { PLUS: bigint; DekaMarkt: bigint },
  observed: { PLUS: bigint; DekaMarkt: bigint },
): void {
  ticked.clear()
  tripEligible = {
    PLUS: validOneStoreTrip(left, demand, ages.PLUS),
    DekaMarkt: validOneStoreTrip(right, demand, ages.DekaMarkt),
  }
  tripBaskets = tripEligible.PLUS || tripEligible.DekaMarkt
    ? { PLUS: left, DekaMarkt: right } : null
  tripValidUntilNs = {
    PLUS: observed.PLUS + weekNs,
    DekaMarkt: observed.DekaMarkt + weekNs,
  }
  tripStore.value = tripEligible.PLUS ? 'PLUS' : 'DekaMarkt'
  renderTrip()
}

function clearTrip(): void {
  const preview = document.querySelector<HTMLTextAreaElement>('#trip-copy-preview')!
  preview.hidden = true
  preview.value = ''
  ticked.clear()
  tripBaskets = null
  tripValidUntilNs = null
  tripCapturedAt = null
  tripEligible = { PLUS: false, DekaMarkt: false }
  trip.hidden = true
  tripItems.replaceChildren()
}

tripStore.addEventListener('change', () => {
  if (invalidateAgedComparison()) return
  ticked.clear()
  renderTrip()
})
document.querySelector<HTMLButtonElement>('#trip-reset')!.addEventListener('click', () => {
  ticked.clear()
  renderTrip()
})
function currentTripProgress() {
  const store = tripStore.value as StoreName
  if (result.hidden || trip.hidden || !tripBaskets || !tripCapturedAt ||
      !shoppingTripLines().length) return null
  const basket = tripBaskets[store]
  const key = currentTripKey(basket, tripCapturedAt[store])
  return key ? { key, basket } : null
}

function shoppingTripText(): string | null {
  if (result.hidden || trip.hidden || !tripBaskets) return null
  const lines = shoppingTripLines()
  if (!lines.length) return null
  const store = tripStore.value as StoreName
  const basket = tripBaskets[store]
  const content = [
    'SUPA · eigen afvinkbare boodschappenlijst · ' + store,
    'Aangemaakt op ' + new Date().toISOString(),
    'Eigen oorspronkelijke bronprijzen, geen gegarandeerde kassaprijs.',
    'Oorspronkelijke opname: ' + (tripCapturedAt?.[store] ?? 'Onbekend'),
    'Mandje: ' + euro.format(basket.totalCents / 100),
    '',
    ...lines.map(line =>
      (ticked.has(line.id) ? '[x] ' : '[ ] ') +
      line.packs + ' × ' + line.productName + ' (' +
      line.pack.amount + ' ' + line.pack.unit +
      (line.pack.count > 1 ? ', multipack ' + line.pack.count : '') + ')' +
      ' | SKU ' + line.productId + ' | ' +
      euro.format(line.lineTotalCents / 100)),
    '',
    'Gebaseerd op uitsluitend eigen winkelopnames; niet automatisch geprijsd.',
    '',
  ].join('\n')
  if (new TextEncoder().encode(content).length > 256000) return null
  return content
}

document.querySelector<HTMLButtonElement>('#trip-export')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  const content = shoppingTripText()
  if (content === null) {
    setStatus('Geen volledig en recent winkelmandje om veilig te bewaren.', true)
    return
  }
  const store = tripStore.value as StoreName
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = store === 'PLUS' ? 'supa-boodschappen-plus.txt' : 'supa-boodschappen-dekamarkt.txt'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
})

const copyPreview = document.querySelector<HTMLTextAreaElement>('#trip-copy-preview')!
document.querySelector<HTMLButtonElement>('#trip-copy')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  const content = shoppingTripText()
  if (content === null) {
    copyPreview.hidden = true
    copyPreview.value = ''
    setStatus('Geen volledig en recent winkelmandje om te selecteren.', true)
    return
  }
  copyPreview.value = content
  copyPreview.hidden = false
  copyPreview.focus()
  copyPreview.select()
  setStatus('De volledige privéboodschappenlijst is geselecteerd. Kopieer zelf via Ctrl+C, Cmd+C of de kopieeractie op je telefoon. Supa heeft geen klembordrechten nodig.')
})

document.querySelector<HTMLButtonElement>('#trip-backup')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  const trip = currentTripProgress()
  if (!trip) {
    setStatus('Geen complete, recente eigen winkelmand om afvinkstatus te bewaren.', true)
    return
  }
  try {
    const text = saveTripProgress(trip.key, ticked, trip.basket)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-prive-afvinkstatus-' + trip.key.store.toLowerCase() + '.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    setStatus('Afvinkstatus lokaal opgeslagen. Het JSON-bestand hoort uitsluitend bij deze winkel, bronopname en fysieke mand. Er is niets automatisch opgeslagen of gedeeld.')
  } catch {
    setStatus('Afvinkstatus kon niet veilig worden opgeslagen.', true)
  }
})

const restoreTrip = document.querySelector<HTMLInputElement>('#trip-restore')!
const allowPriceRefresh = document.querySelector<HTMLInputElement>('#trip-restore-price-refresh')!
restoreTrip.addEventListener('change', async () => {
  const file = restoreTrip.files?.[0]
  if (!file) return
  try {
    if (!file.size || file.size > 256000) throw Error('Ongeldig afvinkbestand')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    if (invalidateAgedComparison()) return
    const trip = currentTripProgress()
    if (!trip) throw Error('Geen huidige volledige winkelmand')
    // The saved file never replaces prices, products, quantities or timestamps.
    // Admit every line against the current physical basket before modifying ticks.
    const optIn = allowPriceRefresh.checked
    const restored = loadTripProgress(text, trip.key, trip.basket, optIn)
    if (optIn && !window.confirm('Supa heeft uitsluitend dezelfde fysieke producten en hoeveelheden gevonden. Neem alleen de oude vinkjes over naar de huidige opnieuw gecontroleerde winkelmand? Oudere productprijzen en opnametijden worden nooit hersteld.')) return
    ticked.clear()
    for (const id of restored) ticked.add(id)
    renderTrip()
    setStatus(optIn
      ? 'Uitsluitend afvinkingen voor dezelfde fysieke winkelmand hersteld na jouw bevestiging. De huidige eigen bronprijzen en huidige opnametijd blijven leidend.'
      : 'Afvinkingen voor exact deze winkelmand hersteld. Oorspronkelijke eigen opnameprijzen blijven historische bedragen.')
  } catch {
    setStatus('Afvinkstatus geweigerd. Open eerst dezelfde winkel, opname en ongewijzigde mand; huidige vinkjes blijven bewaard.', true)
  } finally {
    restoreTrip.value = ''
    allowPriceRefresh.checked = false
  }
})

function repaintPrivateEvidence(source: Source, demand: Demand): void {
  if (result.hidden) return
  const oldStore = tripStore.value as StoreName
  let saved: string | null = null
  const current = currentTripProgress()
  if (current) {
    try { saved = saveTripProgress(current.key, ticked, current.basket) }
    catch { saved = null }
  }
  show(source, demand)
  if (saved && tripEligible[oldStore]) {
    tripStore.value = oldStore
    const stillValid = currentTripProgress()
    if (stillValid) {
      try {
        const restored = loadTripProgress(saved, stillValid.key, stillValid.basket)
        ticked.clear()
        for (const id of restored) ticked.add(id)
        renderTrip()
      } catch { /* Changed product identity: never restore stale ticks. */ }
    }
  }
  setStatus('Originele bronmomenten opnieuw beoordeeld. Verlopen prijsregels zijn onbekend; ' +
    'een ander nog compleet en recent eigen winkelmandje blijft afzonderlijk bruikbaar. ' +
    'Er is geen nieuwe winkelprijs opgehaald.')
}

/**
 * Re-evaluate ORIGINAL local evidence when one retailer ages out while the
 * browser stays open. Do not refresh capture timestamps or synthesize prices.
 * Keep the still-fresh shop usable even if its peer expired, including
 * previously checked rows only for the EXACT unchanged physical basket.
 */
function scheduleFreshnessRepaint(
  source: Source, demand: Demand,
  moments: readonly (bigint | null)[], nowNs: bigint,
): void {
  if (freshnessRepaintTimer !== null) window.clearTimeout(freshnessRepaintTimer)
  freshnessRepaintTimer = null
  const upcoming = moments.filter((instant): instant is bigint =>
    instant !== null && instant <= nowNs && instant + weekNs >= nowNs)
    .map(instant => instant + weekNs)
  if (!upcoming.length) return
  const deadline = upcoming.reduce((earliest, value) => value < earliest ? value : earliest)
  const durationMs = Number((deadline - nowNs) / 1000000n) + 50
  freshnessRepaintTimer = window.setTimeout(() => {
    freshnessRepaintTimer = null
    if (result.hidden) return // Source/demand edits have revoked this result.
    repaintPrivateEvidence(source, demand)
  }, Math.max(1, durationMs))
}

function show(source: Source, demand: Demand): void {
  lastPrivateSource = source
  lastPrivateDemand = demand
  clearComparisonTextPreview()
  privateComparisonCsv = null
  privateCsvFreshUntilNs = null
  const captures = Object.fromEntries(source.captures.map(c => [c.retailer, c])) as Partial<Record<StoreName,Capture>>
  const left = storeBasket('PLUS', captures.PLUS, demand)
  const right = storeBasket('DekaMarkt', captures.DekaMarkt, demand)
  const comparison = compareFullBaskets({ baseline: left, candidate: right })
  const nowNs = BigInt(Date.now()) * 1000000n
  const start = captures.PLUS ? nanoseconds(captures.PLUS.observedAt) : null
  const end = captures.DekaMarkt ? nanoseconds(captures.DekaMarkt.observedAt) : null
  const firstAge = start === null ? -1n : nowNs - start
  const secondAge = end === null ? -1n : nowNs - end
  const gap = start !== null && end !== null ? abs(start - end) : null
  const fresh = start !== null && end !== null && gap !== null &&
    firstAge >= 0n && secondAge >= 0n &&
    firstAge <= weekNs && secondAge <= weekNs && gap <= dayNs
  const complete = fresh && comparison.claimable && comparison.deltaCents !== null &&
    Number.isSafeInteger(comparison.deltaCents)
  // A single complete, fresh retailer can supply an honest own-budget result,
  // independently of paired-price eligibility. Never imply a store winner.
  budgetTotals = {
    PLUS: validOneStoreTrip(left, demand, firstAge) ? left.totalCents : null,
    DekaMarkt: validOneStoreTrip(right, demand, secondAge) ? right.totalCents : null,
  }
  budgetValidThroughNs = { PLUS: start === null ? 0n : start + weekNs,
    DekaMarkt: end === null ? 0n : end + weekNs }
  tripCapturedAt = { PLUS: captures.PLUS?.observedAt ?? 'Geen opname',
    DekaMarkt: captures.DekaMarkt?.observedAt ?? 'Geen opname' }
  comparisonValidThroughNs = complete && start !== null && end !== null
    ? (start <= end ? start : end) + weekNs : null
  result.hidden = false
  // A native progress meter is honest only if the original store capture is
  // itself recent and its individual SKUs have trusted whole-pack prices.
  // In particular, a stale capture must show ZERO usable price coverage,
  // not a visually convincing full green bar based on historical matches.
  for (const [store, basket, age] of [
    ['PLUS', left, firstAge], ['DekaMarkt', right, secondAge],
  ] as const) {
    const meter = coverageMeters[store]
    const validAge = age >= 0n && age <= weekNs
    const count = validAge ? basket.matchedLineCount : 0
    meter.max = demand.ingredients.length
    meter.value = count
    const state = !captures[store]
      ? 'Nog geen eigen winkelopname'
      : !validAge
        ? 'Opname is toekomstig of ouder dan 7 dagen; geen bruikbare prijzen'
        : count === demand.ingredients.length
          ? 'Alle ' + count + ' fysieke regels geprijsd uit eigen recente bron'
          : count + ' van ' + demand.ingredients.length + ' fysieke regels geprijsd uit eigen recente bron'
    coverageLabels[store].textContent = state
    meter.setAttribute('aria-label', store + ': ' + state)
  }
  renderBudget()
  loadTrip(left, right, demand,
    { PLUS: firstAge, DekaMarkt: secondAge },
    { PLUS: start ?? 0n, DekaMarkt: end ?? 0n })
  rows.replaceChildren()
  const deltasByIngredient = new Map(comparison.lineDeltas.map(line => [line.id, line]))
  for (let i = 0; i < demand.ingredients.length; i++) {
    const item = demand.ingredients[i]
    const row = document.createElement('tr')
    const need = document.createElement('th')
    need.scope = 'row'
    need.textContent = item.label + ' · ' +
      (item.amount === null ? 'hoeveelheid onbekend' : String(item.amount).replace('.', ',') + ' ' + item.unit)
    const difference = document.createElement('td')
    const delta = complete ? deltasByIngredient.get(item.id)?.deltaCents : undefined
    difference.textContent = delta === undefined ? 'Onbekend: eerst beide mandjes compleet maken' :
      delta === 0 ? 'Gelijke kosten' :
        (delta < 0 ? 'DekaMarkt' : 'PLUS') + ' ' +
        euro.format(Math.abs(delta) / 100) + ' goedkoper voor dit ingrediënt'
    row.append(need,
      lineCell(left.lines[i], captures.PLUS?.observedAt ?? null, firstAge >= 0n && firstAge <= weekNs),
      lineCell(right.lines[i], captures.DekaMarkt?.observedAt ?? null, secondAge >= 0n && secondAge <= weekNs),
      difference)
    rows.append(row)
  }
  capturesLabel.textContent = 'Eigen opnames: PLUS ' +
    (captures.PLUS?.observedAt ?? 'niet ingelezen') + ' · DekaMarkt ' +
    (captures.DekaMarkt?.observedAt ?? 'niet ingelezen') + '.' +
    (gap === null ? ' Eén winkel heeft nog geen bron: geen volledige vergelijking mogelijk.' :
      ' Onderling verschil: ' + String(gap / 3600000000000n) + ' hele uren.' +
      (fresh ? ' Beide binnen zeven dagen en maximaal 24 uur uiteen.' :
        ' Opname verouderd, toekomstig of meer dan 24 uur uiteen.'))
  missingTasks = []
  for (const [store, basket] of [['PLUS', left], ['DekaMarkt', right]] as const) {
    if (!captures[store]) {
      // Eleven absent products are ONE actionable problem: this retailer
      // was never observed. A single truthful next step helps on mobile.
      missingTasks.push(store + ' · nog geen eigen bronopname. Voeg een werkelijk geobserveerde ' +
        store + '-CSV, JSON of handmatige opname toe; daarna kies je de echte SKU per ingrediënt.')
      continue
    }
    for (const line of basket.lines) {
      if (line.status === 'unresolved') {
        missingTasks.push(store + ' · ' + line.ingredientLabel + ': ' + line.reasons.join('; '))
      }
    }
  }
  if (start !== null && (firstAge < 0n || firstAge > weekNs)) missingTasks.push('PLUS · maak een nieuwe echte winkelopname; deze tijd is toekomstig of ouder dan 7 dagen.')
  if (end !== null && (secondAge < 0n || secondAge > weekNs)) missingTasks.push('DekaMarkt · maak een nieuwe echte winkelopname; deze tijd is toekomstig of ouder dan 7 dagen.')
  if (gap !== null && gap > dayNs && start !== null && end !== null) missingTasks.push((start < end ? 'PLUS' : 'DekaMarkt') +
    ' · oudere winkelopname opnieuw vastleggen; het paar ligt meer dan 24 uur uit elkaar.')
  if (!complete && missingTasks.length === 0) {
    missingTasks.push('Controleer alle fysieke aantallen, gekozen productidentiteiten en mandbedragen voordat je een volledige vergelijking maakt.')
  }
  missingItems.replaceChildren()
  for (const task of missingTasks) missingItems.append(create('li', task))
  nextActions.hidden = missingTasks.length === 0
  if (complete) {
    const delta = comparison.deltaCents!
    summary.textContent = 'Volledige privévergelijking uit je eigen waarnemingen: PLUS ' +
      euro.format(left.totalCents / 100) + ' · DekaMarkt ' +
      euro.format(right.totalCents / 100) + '. ' +
      (delta === 0 ? 'Mandjes zijn even duur.' :
        (delta < 0 ? 'DekaMarkt' : 'PLUS') + ' is ' +
        euro.format(Math.abs(delta) / 100) + ' voordeliger op deze twee eigen opnames.') +
      ' Geen openbare besparingsclaim.'
    summary.className = 'notice'
    setStatus('Beide fysieke mandjes volledig met tijdige eigen prijsbronnen berekend. Privévergelijking; geen gevalideerd publiek onderzoek.')
  } else {
    // A complete OWN one-store basket is a useful shopping price, even if
    // its peer is absent, incomplete or more than 24 hours apart. Never turn
    // those independent totals into a claim of a two-store price difference.
    const knownStores = stores.map(store => {
      const cents = budgetTotals?.[store]
      const capture = captures[store]
      return cents === null || cents === undefined || !capture
        ? store + ': volledig recent mandje onbekend'
        : store + ': ' + euro.format(cents / 100) +
          ' voor het volledige eigen mandje (opname ' + capture.observedAt + ')'
    })
    summary.textContent = 'Geen volledig betrouwbaar prijsverschil of goedkoopste winkel. ' +
      knownStores.join(' · ') + '. PLUS mist ' +
      left.unresolvedLineCount + ' fysieke regel(s); DekaMarkt mist ' +
      right.unresolvedLineCount + ' regel(s).' +
      (fresh ? '' : ' De twee originele bronmomenten voldoen niet samen aan de zeven-dagen- en 24-uursvoorwaarden.') +
      ' Alleen onafhankelijke complete eigen winkelmandbedragen zijn getoond; geen kassagarantie.'
    summary.className = 'notice warning'
    setStatus('Onvolledige of verouderde vergelijking; geen winnaar of volledige winkelbedragen gepubliceerd.')
  }
  // Export the same canonical whole-pack facts already shown on the screen.
  // Do not export prices from expired/future captures, or any paired savings
  // figure when even one physical line/time condition is unknown.
  try {
    privateComparisonCsv = createPrivateBasketComparisonCsv({
      ingredients: demand.ingredients,
      captures,
      baskets: { PLUS: left, DekaMarkt: right },
      fresh: {
        PLUS: firstAge >= 0n && firstAge <= weekNs,
        DekaMarkt: secondAge >= 0n && secondAge <= weekNs,
      },
      paired: complete,
      deltas: new Map(comparison.lineDeltas.map(line => [line.id, line.deltaCents] as const)),
    })
    // An already expired peer cannot block exporting the still-usable
    // one-store private basket with unknown fields on the missing side.
    const expiry = [start, end].filter((value): value is bigint =>
      value !== null && value <= nowNs && value + weekNs >= nowNs)
      .map(value => value + weekNs)
    privateCsvFreshUntilNs = expiry.length ? expiry.reduce((earliest, value) =>
      value < earliest ? value : earliest) : null
  } catch {
    privateComparisonCsv = null
    privateCsvFreshUntilNs = null
  }
  // Expiry must continue protecting the visible page even if a report
  // exceeds the optional CSV limit or the export could not be generated.
  const visibleDeadlines = [start, end].filter((value): value is bigint =>
    value !== null && value <= nowNs && value + weekNs >= nowNs)
    .map(value => value + weekNs)
  shownPriceExpiryNs = visibleDeadlines.length
    ? visibleDeadlines.reduce((a, b) => a < b ? a : b) : null
  scheduleFreshnessRepaint(source, demand, [start, end], nowNs)
}

for (const el of [sessionFile, combined, plus, deka, demandFile]) {
  if (!el) continue
  el.addEventListener('change', () => {
    inputRevision++
    forgetPrivateComparison()
    result.hidden = true
    clearComparisonTextPreview()
    budgetTotals = null
    budgetValidThroughNs = null
    renderBudget()
    clearTrip()
    setStatus('Bronbestanden gewijzigd. Klik opnieuw op Vergelijk; eerdere prijsuitkomst is niet meer geldig.')
    if (el === sessionFile) {
      combined.value = ''
      plus.value = ''
      deka.value = ''
      demandFile.value = ''
    } else {
      sessionFile.value = ''
      if (el === combined) {
        plus.value = ''
        deka.value = ''
      } else if (el === plus || el === deka) {
        combined.value = ''
      }
    }
  })
}
compare?.addEventListener('click', async () => {
  forgetPrivateComparison()
  const snapshotRevision = inputRevision
  compare.disabled = true
  result.hidden = true
  clearComparisonTextPreview()
  budgetTotals = null
  budgetValidThroughNs = null
  renderBudget()
  clearTrip()
  setStatus('Lokale eigen bestanden worden verwerkt…')
  try {
    const { source, demand } = await readOwnBasketInputs()
    if (snapshotRevision !== inputRevision) return
    show(source, demand)
  } catch {
    if (snapshotRevision !== inputRevision) return
    setStatus('Geen veilige volledige vergelijking mogelijk. Controleer jouw privésessie of eigen CSV/JSON, productkoppelingen en benodigde hoeveelheden. Er wordt geen bedrag als volledig getoond.', true)
  } finally {
    compare.disabled = false
  }
})
document.querySelector<HTMLButtonElement>('#download-missing')!.addEventListener('click', () => {
  if (result.hidden || nextActions.hidden || missingTasks.length === 0) return
  const content = [
    'SUPA · privé ontbrekende winkelgegevens',
    'Genereerd: ' + new Date().toISOString(),
    'Geen veronderstelde prijzen of aankoopclaims.',
    '',
    ...missingTasks.map(item => '- ' + item),
    '',
  ].join('\n')
  if (new TextEncoder().encode(content).length > 256000) {
    setStatus('De privé checklist is te groot om te downloaden. Gebruik de getoonde lijst.', true)
    return
  }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'supa-ontbrekende-winkelgegevens.txt'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
})
// Mobile-friendly, opt-in text version of only the currently visible private
// result. No clipboard permission, data upload, public price or savings claim.
const comparisonTextPreview = document.querySelector<HTMLTextAreaElement>('#comparison-text-preview')!
function clearComparisonTextPreview(): void {
  comparisonTextPreview.value = ''
  comparisonTextPreview.hidden = true
}
function privateComparisonText(): string | null {
  if (result.hidden) return null
  const tableLines = Array.from(rows.querySelectorAll('tr')).map(row => {
    const cells = Array.from(row.cells, cell => cell.textContent?.trim() ?? '')
    if (cells.length !== 4) throw Error('Onvolledige privéregel')
    return cells.join(' | ')
  })
  if (!tableLines.length || tableLines.length > 1000) return null
  renderBudget()
  const budget = budgetInCents(budgetInput.value.trim()) === null ? [] : [
    'Optioneel eigen budget: ' + (budgetStatus.textContent ?? 'Onbekend'),
  ]
  const content = [
    'SUPA · uitsluitend eigen lokale prijsopnames · PRIVÉ',
    'Moment van maken: ' + new Date().toISOString(),
    'Historische privévergelijking; geen actuele kassagarantie of publieke besparingsclaim.',
    '',
    summary.textContent ?? 'Geen volledig prijsverschil bekend.',
    capturesLabel.textContent ?? 'Bronmomenten onbekend.',
    ...budget,
    '',
    'Ingrediënt en fysieke behoefte | PLUS | DekaMarkt | Verschil',
    ...tableLines,
    ...(nextActions.hidden ? [] : ['', 'Nog zelf te controleren:',
      ...missingTasks.map(task => '- ' + task)]),
    '',
    'Alleen daadwerkelijk eigen ingevoerde bronprijzen; onbekend is nooit €0.',
    '',
  ].join('\n')
  return new TextEncoder().encode(content).length <= 256000 ? content : null
}
document.querySelector<HTMLButtonElement>('#download-txt')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  const text = privateComparisonText()
  if (!text) {
    setStatus('Geen geldig zichtbaar privéoverzicht om als tekst te bewaren.', true)
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'supa-eigen-winkelvergelijking-prive.txt'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  setStatus('Jouw historische privéoverzicht is lokaal als TXT aangeboden; voor nieuwe prijzen moet je opnieuw waarnemen.')
})
document.querySelector<HTMLButtonElement>('#select-txt')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  const text = privateComparisonText()
  if (!text) {
    clearComparisonTextPreview()
    setStatus('Geen geldig zichtbaar privéoverzicht om veilig te selecteren.', true)
    return
  }
  comparisonTextPreview.value = text
  comparisonTextPreview.hidden = false
  comparisonTextPreview.focus()
  comparisonTextPreview.select()
  setStatus('Je eigen privéoverzicht is geselecteerd. Kopieer het zelf met Ctrl+C, Cmd+C of de kopieeractie op je telefoon. Geen klembordtoegang voor Supa.')
})

document.querySelector<HTMLButtonElement>('#download-csv')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  if (result.hidden || !privateComparisonCsv || privateCsvFreshUntilNs === null ||
      BigInt(Date.now()) * 1000000n > privateCsvFreshUntilNs) {
    setStatus('Maak opnieuw een privévergelijking met je huidige eigen bronopnames voordat je CSV exporteert. Onbekende bedragen worden nooit als nul opgeslagen.', true)
    return
  }
  const url = URL.createObjectURL(new Blob([privateComparisonCsv], {
    type: 'text/csv;charset=utf-8',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'supa-prive-winkelmand-prijzen.csv'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  setStatus('Gespecificeerde privé CSV lokaal opgeslagen: echte originele SKU’s, bronmomenten, hele centen en ontbrekende regels. Een leeg bedrag is onbekend, niet €0. Gebruik dit rapport niet als bronrechten- of besparingsbewijs.')
})

document.querySelector<HTMLButtonElement>('#download-html')!.addEventListener('click', () => {
  if (invalidateAgedComparison() || result.hidden) {
    setStatus('Maak eerst een actuele privévergelijking voor je een momentopname bewaart.', true)
    return
  }
  try {
    const reportRows = Array.from(rows.querySelectorAll('tr')).map(row => {
      const cells = Array.from(row.cells, cell => cell.innerText || cell.textContent || '')
      if (cells.length !== 4) throw Error('Onvolledige zichtbare tabel')
      return cells as [string, string, string, string]
    })
    const html = renderPrivateBasketSnapshot({
      capturedAt: new Date().toISOString(),
      summary: (summary.textContent ?? '') +
        (budgetInCents(budgetInput.value.trim()) !== null && budgetTotals
          ? ' Eigen budget: ' + (budgetStatus.textContent ?? '') : ''),
      sourceMoments: capturesLabel.textContent ?? '',
      rows: reportRows,
      nextActions: nextActions.hidden ? [] : [...missingTasks],
    })
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-prive-winkelvergelijking.html'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    setStatus('Historische privévergelijking lokaal opgeslagen als scriptvrije HTML. Voor actuele winkelprijzen moet je opnieuw waarnemen.')
  } catch {
    setStatus('Privé HTML kon niet veilig worden gemaakt. Gebruik printen of open de vergelijking opnieuw.', true)
  }
})

document.querySelector<HTMLButtonElement>('#print')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  if (!result.hidden) window.print()
})

/** Same-tab handoff from the local SKU mapping wizard.
 *  No files, sources or prices are stored or transported off-device.
 *  Re-admit the exact inputs before any monetary result is shown.
 */
document.addEventListener('supa:compare-private-basket', (event: Event) => {
  result.hidden = true
  clearComparisonTextPreview()
  budgetTotals = null
  budgetValidThroughNs = null
  renderBudget()
  clearTrip()
  try {
    const payload = (event as CustomEvent<{ source: unknown; demand: unknown }>).detail
    if (!payload) throw Error('Private inputs missing')
    const source = sourceFrom(payload.source)
    const demand = demandFrom(payload.demand)
    show(source, demand)
  } catch {
    setStatus('Geen veilige volledige vergelijking mogelijk. Controleer beide lokale bronopnames, expliciete producten en fysieke hoeveelheden.', true)
  }
})

// The mapping wizard notifies us before replacing source/demand: do not
// retain former private product/price data in a dormant expiry callback.
document.addEventListener('supa:private-basket-invalidated', () => {
  forgetPrivateComparison()
  result.hidden = true
  clearComparisonTextPreview()
  clearTrip()
})

// A private source can become too old while the app is open in a background tab.
// Refuse to expose the old full comparison or export list on return to the tab.
window.addEventListener('focus', () => { invalidateAgedComparison(); renderBudget() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { invalidateAgedComparison(); renderBudget() }
})
