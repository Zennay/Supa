/**
 * Supa M3 private browser full basket comparison. A separate Vite entrypoint
 * reusing canonical domain money/pack functions; no remote data collection.
 * Own source observations are NOT written retailer rights or field-study proof.
 */
import { compareFullBaskets } from './domain/basketComparison.ts'
import { calculateDecimalPackCount } from './domain/decimalPackArithmetic.ts'
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
type Source = { schema: 'supa-offline-prices-v1'; captures: [Capture, Capture] }
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
const csvHeader = 'retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available'
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

const combined = document.querySelector<HTMLInputElement>('#combined')!
const plus = document.querySelector<HTMLInputElement>('#plus')!
const deka = document.querySelector<HTMLInputElement>('#deka')!
const demandFile = document.querySelector<HTMLInputElement>('#demand')!
const compare = document.querySelector<HTMLButtonElement>('#compare')!
const status = document.querySelector<HTMLDivElement>('#price-status')!
const result = document.querySelector<HTMLElement>('#result')!
const summary = document.querySelector<HTMLDivElement>('#summary')!
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
let comparisonValidThroughNs: bigint | null = null
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
  if (!record(value) || own(value, 'schema') !== 'supa-offline-prices-v1' ||
      !Array.isArray(value.captures) || value.captures.length !== 2) {
    throw Error('Onbekend prijsbronformaat')
  }
  const known = new Set<StoreName>()
  const captures = value.captures.map((item: unknown): Capture => {
    if (!record(item) || !stores.includes(item.retailer as StoreName) ||
        known.has(item.retailer as StoreName) || !safeTime(item.observedAt) ||
        !Array.isArray(item.products) || item.products.length > 1000) {
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
  if (known.size !== 2) throw Error('Twee winkelbronnen vereist')
  return { schema: 'supa-offline-prices-v1', captures: captures as [Capture, Capture] }
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
function withoutCsvHeader(value: string): string {
  const source = value.startsWith('\uFEFF') ? value.slice(1) : value
  const index = source.indexOf('\n')
  if (index < 0 || source.slice(0, index).replace(/\r$/, '') !== csvHeader) {
    throw Error('CSV-kop ontbreekt of is ongeldig')
  }
  const body = source.slice(index + 1)
  if (!body) throw Error('Winkelbron bevat geen productregels')
  return body.endsWith('\n') ? body : body + '\n'
}
async function parseSource(): Promise<Source> {
  const file = combined.files?.[0]
  const left = plus.files?.[0]
  const right = deka.files?.[0]
  if ((file && (left || right)) || (!file && (!left || !right))) {
    throw Error('Kies één gecombineerd bestand of twee aparte winkel-CSV’s')
  }
  if (file && file.name.toLowerCase().endsWith('.json')) {
    return sourceFrom(JSON.parse(await readSource(file)))
  }
  let csv: string
  if (file) csv = await readSource(file)
  else {
    const [a, b] = await Promise.all([readSource(left!), readSource(right!)])
    csv = csvHeader + '\n' + withoutCsvHeader(a) + withoutCsvHeader(b)
  }
  if (new TextEncoder().encode(csv).length > limit) throw Error('Samengevoegde bron overschrijdt 256 KB')
  // Existing strict canonical reader is intentionally served unchanged from public.
  const canonicalUrl = '/offline-two-store-csv.mjs'
  const { convertTwoStoreCsv } = await import(/* @vite-ignore */ canonicalUrl)
  return sourceFrom(JSON.parse(convertTwoStoreCsv(csv)))
}

function unresolved(d: DemandLine, reason: string): BasketTraceLine {
  return {
    id: d.id, ingredientLabel: d.label,
    requirement: { amount: d.amount, unit: d.unit },
    status: 'unresolved', reasons: [reason], matchScore: null,
  }
}
function storeBasket(store: StoreName, capture: Capture, demand: Demand): OneStoreBasket {
  const products = new Map(capture.products.map(p => [p.id, p]))
  const chosenIds = new Set<string>()
  const lines: BasketTraceLine[] = []
  let totalCents = 0
  let matchedLineCount = 0
  let unresolvedLineCount = 0
  for (const d of demand.ingredients) {
    const choice = d.productIds[store]
    if (choice !== null && chosenIds.has(choice)) {
      lines.push(unresolved(d, 'Hetzelfde winkelartikel is dubbel gekozen: combineer de fysieke behoefte in één ingrediëntregel.'))
      unresolvedLineCount++
      continue
    }
    if (choice !== null) chosenIds.add(choice)
    const p = choice === null ? undefined : products.get(choice)
    if (!p || !p.available || p.priceCents === null ||
        p.packAmount === null || d.amount === null) {
      lines.push(unresolved(d, !choice ? 'Nog geen gecontroleerde winkelproductkeuze' :
        'Geen bruikbaar eigen product, hoeveelheid of prijs'))
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
function lineCell(line: BasketTraceLine): HTMLTableCellElement {
  const cell = document.createElement('td')
  if (line.status === 'unresolved') {
    cell.textContent = 'Onbekend — ' + line.reasons.join('; ')
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
  const basket = tripBaskets?.[tripStore.value as StoreName]
  if (!basket || basket.unresolvedLineCount !== 0 ||
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

function invalidateAgedComparison(): boolean {
  if (result.hidden || comparisonValidThroughNs === null) return false
  const nowNs = BigInt(Date.now()) * 1000000n
  if (nowNs <= comparisonValidThroughNs) return false
  result.hidden = true
  clearTrip()
  setStatus('Een van de oorspronkelijke winkelopnames is inmiddels ouder dan zeven dagen. Open recente werkelijke opnames en vergelijk opnieuw; het oude volledige prijsverschil is niet meer geldig.', true)
  return true
}

function renderTrip(): void {
  tripItems.replaceChildren()
  const lines = shoppingTripLines()
  if (!tripBaskets || lines.length === 0) {
    trip.hidden = true
    return
  }
  trip.hidden = false
  for (const line of lines) {
    const item = document.createElement('label')
    item.className = 'trip-line'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = ticked.has(line.id)
    check.setAttribute('aria-label', line.packs + ' hele verpakkingen ' + line.productName + ' afvinken')
    check.addEventListener('change', () => {
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

function loadTrip(left: OneStoreBasket, right: OneStoreBasket, complete: boolean): void {
  ticked.clear()
  tripBaskets = complete ? { PLUS: left, DekaMarkt: right } : null
  tripStore.value = 'PLUS'
  renderTrip()
}

function clearTrip(): void {
  ticked.clear()
  tripBaskets = null
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
document.querySelector<HTMLButtonElement>('#trip-export')!.addEventListener('click', () => {
  if (invalidateAgedComparison()) return
  if (result.hidden || trip.hidden || !tripBaskets) return
  const lines = shoppingTripLines()
  if (!lines.length) return
  const store = tripStore.value as StoreName
  const basket = tripBaskets[store]
  const content = [
    'SUPA · eigen afvinkbare boodschappenlijst · ' + store,
    'Aangemaakt op ' + new Date().toISOString(),
    'Eigen oorspronkelijke bronprijzen, geen gegarandeerde kassaprijs.',
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
  if (new TextEncoder().encode(content).length > 256000) {
    setStatus('Boodschappenlijst overschrijdt de veilige lokale exportgrootte.', true)
    return
  }
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

function show(source: Source, demand: Demand): void {
  const captures = Object.fromEntries(source.captures.map(c => [c.retailer, c])) as Record<StoreName,Capture>
  const left = storeBasket('PLUS', captures.PLUS, demand)
  const right = storeBasket('DekaMarkt', captures.DekaMarkt, demand)
  const comparison = compareFullBaskets({ baseline: left, candidate: right })
  const nowNs = BigInt(Date.now()) * 1000000n
  const start = nanoseconds(captures.PLUS.observedAt)
  const end = nanoseconds(captures.DekaMarkt.observedAt)
  const firstAge = nowNs - start
  const secondAge = nowNs - end
  const gap = abs(start - end)
  comparisonValidThroughNs = (start <= end ? start : end) + weekNs
  const fresh = firstAge >= 0n && secondAge >= 0n &&
    firstAge <= weekNs && secondAge <= weekNs && gap <= dayNs
  const complete = fresh && comparison.claimable && comparison.deltaCents !== null &&
    Number.isSafeInteger(comparison.deltaCents)
  result.hidden = false
  loadTrip(left, right, complete)
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
    row.append(need, lineCell(left.lines[i]), lineCell(right.lines[i]), difference)
    rows.append(row)
  }
  capturesLabel.textContent = 'Eigen opnames: PLUS ' + captures.PLUS.observedAt +
    ' · DekaMarkt ' + captures.DekaMarkt.observedAt +
    '. Onderling verschil: ' + String(gap / 3600000000000n) + ' hele uren.' +
    (fresh ? ' Beide binnen zeven dagen en maximaal 24 uur uiteen.' :
      ' Verouderd, toekomstig of meer dan 24 uur uiteen: hercontroleer beide bronnen.')
  missingTasks = []
  for (const [store, basket] of [['PLUS', left], ['DekaMarkt', right]] as const) {
    for (const line of basket.lines) {
      if (line.status === 'unresolved') {
        missingTasks.push(store + ' · ' + line.ingredientLabel + ': ' + line.reasons.join('; '))
      }
    }
  }
  if (firstAge < 0n || firstAge > weekNs) missingTasks.push('PLUS · maak een nieuwe echte winkelopname; deze tijd is toekomstig of ouder dan 7 dagen.')
  if (secondAge < 0n || secondAge > weekNs) missingTasks.push('DekaMarkt · maak een nieuwe echte winkelopname; deze tijd is toekomstig of ouder dan 7 dagen.')
  if (gap > dayNs) missingTasks.push((start < end ? 'PLUS' : 'DekaMarkt') +
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
    summary.textContent = 'Geen volledig betrouwbaar prijsverschil. PLUS mist ' +
      left.unresolvedLineCount + ' regel(s); DekaMarkt mist ' + right.unresolvedLineCount +
      ' regel(s).' + (fresh ? '' : ' Eén of beide opnames voldoet niet aan de tijdvoorwaarden.') +
      ' Bekende regelprijzen zijn geen volledige winkelprijs. Controleer ontbrekende SKU’s, aantallen en bronmomenten.'
    summary.className = 'notice warning'
    setStatus('Onvolledige of verouderde vergelijking; geen winnaar of volledige winkelbedragen gepubliceerd.')
  }
}

for (const el of [combined, plus, deka, demandFile]) {
  if (!el) continue
  el.addEventListener('change', () => {
    inputRevision++
    result.hidden = true
    clearTrip()
    setStatus('Bronbestanden gewijzigd. Klik opnieuw op Vergelijk; eerdere prijsuitkomst is niet meer geldig.')
    if (el === combined) {
      plus.value = ''
      deka.value = ''
    } else if (el === plus || el === deka) {
      combined.value = ''
    }
  })
}
compare?.addEventListener('click', async () => {
  const snapshotRevision = inputRevision
  compare.disabled = true
  result.hidden = true
  clearTrip()
  setStatus('Lokale eigen bestanden worden verwerkt…')
  try {
    const file = demandFile.files?.[0]
    if (!file || !file.size || file.size > limit) throw Error('Mandvraag ontbreekt')
    const [source, demand] = await Promise.all([
      parseSource(), file.arrayBuffer().then(bytes => demandFrom(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))),
    ])
    if (snapshotRevision !== inputRevision) return
    show(source, demand)
  } catch {
    if (snapshotRevision !== inputRevision) return
    setStatus('Geen veilige volledige vergelijking mogelijk. Controleer jouw eigen CSV/JSON, productkoppelingen en benodigde hoeveelheden. Er wordt geen bedrag als volledig getoond.', true)
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

// A private source can become too old while the app is open in a background tab.
// Refuse to expose the old full comparison or export list on return to the tab.
window.addEventListener('focus', invalidateAgedComparison)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') invalidateAgedComparison()
})
