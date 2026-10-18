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
const status = document.querySelector<HTMLDivElement>('#status')!
const result = document.querySelector<HTMLElement>('#result')!
const summary = document.querySelector<HTMLDivElement>('#summary')!
const capturesLabel = document.querySelector<HTMLParagraphElement>('#captures')!
const rows = document.querySelector<HTMLTableSectionElement>('#rows')!

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const own = (value: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(value, key) ? value[key] : undefined

const validText = (value: unknown, max = 160): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.trim() === value && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/^[=+@-]/u.test(value)

function safeTime(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?[+-]\d\d:\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value))
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
  return file.text()
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
  const lines: BasketTraceLine[] = []
  let totalCents = 0
  let matchedLineCount = 0
  let unresolvedLineCount = 0
  for (const d of demand.ingredients) {
    const choice = d.productIds[store]
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
function create(tag: string, content?: string): HTMLElement {
  const el = document.createElement(tag)
  if (content !== undefined) el.textContent = content
  return el
}
function setStatus(message: string, isError = false): void {
  status.textContent = message
  status.className = 'notice' + (isError ? ' error' : '')
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
    ' per verpakking · ' + euro.format(line.lineTotalCents / 100) + ' bekende privéregel')
  cell.append(title, pack, price)
  return cell
}
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
  const fresh = firstAge >= 0n && secondAge >= 0n &&
    firstAge <= weekNs && secondAge <= weekNs && gap <= dayNs
  const complete = fresh && comparison.claimable && comparison.deltaCents !== null &&
    Number.isSafeInteger(comparison.deltaCents)
  result.hidden = false
  rows.replaceChildren()
  for (let i = 0; i < demand.ingredients.length; i++) {
    const item = demand.ingredients[i]
    const row = document.createElement('tr')
    const need = document.createElement('th')
    need.scope = 'row'
    need.textContent = item.label + ' · ' +
      (item.amount === null ? 'hoeveelheid onbekend' : String(item.amount).replace('.', ',') + ' ' + item.unit)
    row.append(need, lineCell(left.lines[i]), lineCell(right.lines[i]))
    rows.append(row)
  }
  capturesLabel.textContent = 'Eigen opnames: PLUS ' + captures.PLUS.observedAt +
    ' · DekaMarkt ' + captures.DekaMarkt.observedAt +
    '. Onderling verschil: ' + String(gap / 3600000000000n) + ' hele uren.' +
    (fresh ? ' Beide binnen zeven dagen en maximaal 24 uur uiteen.' :
      ' Verouderd, toekomstig of meer dan 24 uur uiteen: hercontroleer beide bronnen.')
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
  el.addEventListener('change', () => {
    result.hidden = true
    setStatus('Bronbestanden gewijzigd. Klik opnieuw op Vergelijk; eerdere prijsuitkomst is niet meer geldig.')
    if (el === combined) {
      plus.value = ''
      deka.value = ''
    } else if (el === plus || el === deka) {
      combined.value = ''
    }
  })
}
compare.addEventListener('click', async () => {
  compare.disabled = true
  result.hidden = true
  setStatus('Lokale eigen bestanden worden verwerkt…')
  try {
    const file = demandFile.files?.[0]
    if (!file || !file.size || file.size > limit) throw Error('Mandvraag ontbreekt')
    const [source, demand] = await Promise.all([
      parseSource(), file.text().then(data => demandFrom(JSON.parse(data))),
    ])
    show(source, demand)
  } catch {
    setStatus('Geen veilige volledige vergelijking mogelijk. Controleer jouw eigen CSV/JSON, productkoppelingen en benodigde hoeveelheden. Er wordt geen bedrag als volledig getoond.', true)
  } finally {
    compare.disabled = false
  }
})
document.querySelector<HTMLButtonElement>('#print')!.addEventListener('click', () => {
  if (!result.hidden) window.print()
})
