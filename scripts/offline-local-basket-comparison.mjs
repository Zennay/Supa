#!/usr/bin/env node
/**
 * Private, offline same-demand basket: owned local CSV observations -> canonical
 * converter -> explicit human SKU mapping -> exact physical pack arithmetic ->
 * canonical full-basket comparison -> script-free, local HTML.
 *
 * No retailer HTTP, inferred retailer licence, fuzzy auto-matching or public
 * price/savings claims. No tests, networking or data uploads are performed.
 *
 * Requires Node 24+ with --experimental-strip-types.
 */
import { open, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateCsv, joinPrivateStoreCsv } from './offline-two-store-csv-to-json.mjs'
import { convertTwoStoreCsv, convertOwnStoreCsv } from '../public/offline-two-store-csv.mjs'
import { offlinePriceJsonToCsv } from './offline-private-prices-json-to-csv.mjs'
import { calculateDecimalPackCount } from '../src/domain/decimalPackArithmetic.ts'
import { privateBasketMissingReason } from '../src/domain/privateBasketMissingReason.ts'
import { matchIngredient } from '../src/domain/matching.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

const STORES = ['PLUS', 'DekaMarkt']
const UNITS = ['g', 'kg', 'ml', 'l', 'piece']
const MAX_BYTES = 256_000
const DAY_NS = 86_400_000_000_000n
const WEEK_NS = 7n * DAY_NS
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const validText = (value, max = 160) =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  value === value.trim() && /[\p{L}\p{N}]/u.test(value) &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  !/^[=+@-]/u.test(value)
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const amountLabel = (value) => String(value).replace('.', ',')

async function readPrivateDemand(path) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) throw Error('Unsupported private file environment')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw Error('Invalid demand size')
    const bytes = await handle.readFile()
    if (!bytes.length || bytes.length > MAX_BYTES) throw Error('Invalid demand size')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    await handle.close()
  }
}

function parseDemand(text) {
  const root = JSON.parse(text)
  if (!root || Array.isArray(root) || typeof root !== 'object' ||
      Object.keys(root).some(key => !['schema', 'selectedMealCount', 'ingredients'].includes(key)) ||
      root.schema !== 'supa-private-basket-demand-v1' ||
      !Number.isSafeInteger(root.selectedMealCount) ||
      root.selectedMealCount < 1 || root.selectedMealCount > 1000 ||
      !Array.isArray(root.ingredients) ||
      root.ingredients.length < 1 || root.ingredients.length > 1000) {
    throw Error('Invalid basket demand')
  }

  const ids = new Set()
  const ingredients = root.ingredients.map(ingredient => {
    if (!ingredient || typeof ingredient !== 'object' || Array.isArray(ingredient) ||
        Object.keys(ingredient).some(key => !['id', 'label', 'amount', 'unit', 'productIds'].includes(key)) ||
        !validText(ingredient.id, 100) || ids.has(ingredient.id) ||
        !validText(ingredient.label) ||
        !UNITS.includes(ingredient.unit) ||
        (ingredient.amount !== null &&
          (typeof ingredient.amount !== 'number' || !Number.isFinite(ingredient.amount) ||
            ingredient.amount <= 0 || ingredient.amount > 100_000)) ||
        !ingredient.productIds || typeof ingredient.productIds !== 'object' ||
        Array.isArray(ingredient.productIds) ||
        Object.keys(ingredient.productIds).some(store => !STORES.includes(store))) {
      throw Error('Invalid ingredient')
    }
    ids.add(ingredient.id)
    for (const store of STORES) {
      const productId = ingredient.productIds[store]
      if (productId !== null && productId !== undefined &&
          !validText(productId, 100)) throw Error('Invalid explicit match')
    }
    return ingredient
  })
  return { selectedMealCount: root.selectedMealCount, ingredients }
}

function unresolved(ingredient, reason) {
  return {
    id: ingredient.id,
    ingredientLabel: ingredient.label,
    requirement: { amount: ingredient.amount, unit: ingredient.unit },
    status: 'unresolved',
    reasons: [reason],
    matchScore: null,
  }
}

function makeStoreBasket(store, capture, demand) {
  const products = new Map((capture?.products ?? []).map(product => [product.id, product]))
  // One physical store SKU is not two separate purchases. Until requirements
  // for a shared SKU are explicitly aggregated into a single ingredient row,
  // neither duplicate is a trustworthy whole-pack basket line.
  const selectedProductCounts = new Map()
  for (const ingredient of demand.ingredients) {
    const productId = ingredient.productIds[store]
    if (productId !== null && productId !== undefined) {
      selectedProductCounts.set(productId, (selectedProductCounts.get(productId) ?? 0) + 1)
    }
  }
  let totalCents = 0
  let matchedLineCount = 0
  let unresolvedLineCount = 0
  const lines = demand.ingredients.map(ingredient => {
    const productId = ingredient.productIds[store]
    if (!capture) {
      unresolvedLineCount++
      return unresolved(ingredient, 'Geen eigen winkelopname voor deze winkel; prijs onbekend')
    }
    if (productId === null || productId === undefined) {
      unresolvedLineCount++
      return unresolved(ingredient, 'Product niet expliciet gekozen voor deze winkel')
    }
    if (selectedProductCounts.get(productId) > 1) {
      unresolvedLineCount++
      return unresolved(ingredient,
        'Hetzelfde winkelproduct is meermaals gekoppeld; voeg de fysieke behoeften samen en kies daarna opnieuw')
    }
    const product = products.get(productId)
    const missing = privateBasketMissingReason(productId, product, ingredient.amount)
    if (missing !== null) {
      unresolvedLineCount++
      return unresolved(ingredient, missing)
    }
    const count = product.packCount ?? 1
    const packs = calculateDecimalPackCount(
      [{ amount: ingredient.amount, unit: ingredient.unit }],
      { amount: product.packAmount, unit: product.packUnit, count },
    )
    const lineTotal = packs === null ? NaN : packs * product.priceCents
    if (!Number.isSafeInteger(packs) || packs < 1 ||
        !Number.isSafeInteger(lineTotal) || lineTotal < 0 ||
        !Number.isSafeInteger(totalCents + lineTotal)) {
      unresolvedLineCount++
      return unresolved(ingredient, 'Verpakking past niet bij behoefte of hele-centberekening is ongeldig')
    }
    totalCents += lineTotal
    matchedLineCount++
    return {
      id: ingredient.id,
      ingredientLabel: ingredient.label,
      requirement: { amount: ingredient.amount, unit: ingredient.unit },
      status: 'matched',
      productId: product.id,
      productName: product.name,
      packs,
      pack: { amount: product.packAmount, unit: product.packUnit, count },
      pricePerPackCents: product.priceCents,
      lineTotalCents: lineTotal,
      matchScore: 100, // Explicit human SKU choice, not auto-matching confidence.
      reasons: ['Product-ID handmatig geselecteerd uit eigen winkelopname'],
    }
  })
  return {
    store: { id: store, name: store },
    selectedMealCount: demand.selectedMealCount,
    lines,
    totalCents,
    matchedLineCount,
    unresolvedLineCount,
  }
}

// Unit prices are informative labels only. Totals always come from canonical
// exact whole-pack math, never from an approximate per-kg/per-litre label.
function advisoryUnitPrice(line) {
  if (line.status !== 'matched') return ''
  const { amount, unit, count } = line.pack
  const base = (unit === 'kg' || unit === 'l' ? amount * 1000 : amount) * count
  const per = unit === 'g' || unit === 'kg' ? 'kg'
    : unit === 'ml' || unit === 'l' ? 'liter' : 'stuk'
  const multiplier = per === 'stuk' ? 1 : 1000
  const cents = line.pricePerPackCents * multiplier / base
  return base > 0 && Number.isFinite(cents) && cents >= 0
    ? euro.format(cents / 100) + '/' + per : ''
}

function rowCell(line) {
  if (line.status !== 'matched') return '<td class="missing"><strong>Onbekend</strong><br>' +
    escapeHtml(line.reasons.join('; ')) + '<br><small>Controleer of vul jouw eigen bronwaarneming aan.</small></td>'
  const pack = line.pack
  return '<td><strong>' + escapeHtml(line.productName) + '</strong><br>' +
    escapeHtml(String(line.packs) + ' × ' + amountLabel(pack.amount) + ' ' +
      pack.unit + (pack.count > 1 ? ' (×' + pack.count + ')' : '')) +
    '<br><small>' + escapeHtml(advisoryUnitPrice(line)) +
    ' · ' + escapeHtml(euro.format(line.pricePerPackCents / 100)) +
    ' per verpakking</small><br><b>' +
    escapeHtml(euro.format(line.lineTotalCents / 100)) + '</b></td>'
}

// Date.parse discards the sub-millisecond fraction. Source timestamps may
// legitimately carry nanoseconds; a 24h + 1ns gap must NEVER pass as paired.
function observedNanoseconds(raw) {
  const match = /\\.(\\d{1,9})[+-]\\d\\d:\\d\\d$/.exec(raw)
  const fraction = (match?.[1] ?? '').padEnd(9, '0')
  const milliseconds = Date.parse(raw)
  if (!Number.isFinite(milliseconds)) throw Error('Invalid observation time')
  return BigInt(milliseconds - Number(fraction.slice(0, 3))) * 1_000_000n +
    BigInt(fraction || '0')
}
function ageDescription(age) {
  if (age < 0n) return 'in de toekomst'
  if (age < 3_600_000_000_000n) return String(age / 60_000_000_000n) + ' minuten oud'
  if (age < DAY_NS) return String(age / 3_600_000_000_000n) + ' uur oud'
  return String(age / DAY_NS) + ' dagen oud'
}
function renderHtml(data, demand, left, right, comparison, observed, ages, gap, fresh) {
  const complete = fresh && comparison.claimable &&
    Number.isSafeInteger(comparison.deltaCents)
  const summary = complete
    ? '<strong>Volledige zelfde-mandvergelijking (privé, niet voor publicatie)</strong>' +
      '<p>PLUS: ' + euro.format(left.totalCents / 100) + ' · DekaMarkt: ' +
      euro.format(right.totalCents / 100) + '. ' +
      (comparison.deltaCents === 0 ? 'Beide mandjes zijn even duur.'
        : (comparison.deltaCents < 0 ? 'DekaMarkt' : 'PLUS') +
          ' is ' + euro.format(Math.abs(comparison.deltaCents) / 100) +
          ' voordeliger op basis van deze twee privéopnames.') + '</p>'
    : '<strong>Geen betrouwbaar volledig prijsverschil</strong>' +
      '<p>Een of meer productmatches, bedragen, hoeveelheden of opnamevoorwaarden ontbreken. ' +
      'De onderstaande bedragen zijn uitsluitend bekende privéregels, geen volledige winkelprijs.</p>'
  const notes = [
    'De opnames komen uitsluitend uit eigen aangeleverde lokale bestanden.',
    'Geen licentie, onafhankelijk winkelveldonderzoek of actuele publieke prijsclaim bewezen.',
    ...STORES.map((store, index) =>
      ages[index] === null ? store + ': geen eigen winkelopname (prijs onbekend)' :
        store + ': ' + ageDescription(ages[index]) + (ages[index] > WEEK_NS
          ? ' · ouder dan zeven dagen' : '')),
    gap === null ? 'Een tweede echte winkelopname ontbreekt; geen prijsverschil berekend.' :
      'Verschil tussen beide opname-instanten: ' +
      String(gap / 3_600_000_000_000n) + ' hele uren' +
      (gap > DAY_NS ? ' · opnieuw waarnemen bij de oudste winkel' : ''),
    !fresh ? 'Opnames zijn te oud, toekomstig of meer dan 24 uur uiteen: prijsvergelijking geblokkeerd.' : '',
    left.unresolvedLineCount + right.unresolvedLineCount > 0
      ? 'Ontbrekende producten: ' + left.unresolvedLineCount + ' bij PLUS, ' +
        right.unresolvedLineCount + ' bij DekaMarkt.' : '',
  ].filter(Boolean)
  const rows = demand.ingredients.map((ingredient, index) =>
    '<tr><th scope="row">' + escapeHtml(ingredient.label) + '<br><small>' +
    escapeHtml(ingredient.amount === null ? 'Hoeveelheid onbekend'
      : amountLabel(ingredient.amount) + ' ' + ingredient.unit) +
    '</small></th>' + rowCell(left.lines[index]) + rowCell(right.lines[index]) + '</tr>').join('\n')
  const dates = STORES.map((store, index) =>
    store + ': ' + (observed[index] === null ? 'niet aangeleverd' : escapeHtml(observed[index]))).join(' · ')
  const sourceCaptures = new Map(data.captures.map(capture => [capture.retailer, capture]))
  const matchSuggestion = (store, ingredient) => {
    const capture = sourceCaptures.get(store)
    if (!capture) return ''
    // Never auto-commit a fuzzy suggestion as a real manual match. It can
    // guide an operator to the real source ID, but comparison stays UNKNOWN.
    const decision = matchIngredient(
      { id: ingredient.id, query: ingredient.label, amount: ingredient.amount,
        unit: ingredient.unit },
      capture.products.filter(product =>
        product.available && product.priceCents !== null &&
        product.packAmount !== null),
    )
    if (decision.type !== 'match') return ''
    const product = capture.products.find(item => item.id === decision.productId)
    return product ? '<br><small>Mogelijke koppeling (niet geselecteerd): ' +
      escapeHtml(product.name) + ' · bron-ID ' +
      escapeHtml(product.id) + '. Controleer zelf en vul productIds in vraag.json in.</small>' : ''
  }
  const missingTasks = STORES.flatMap((store, index) => {
    const basket = index === 0 ? left : right
    return basket.lines.flatMap(line => line.status === 'unresolved'
      ? ['<li><b>' + escapeHtml(store) + ' · ' +
          escapeHtml(line.ingredientLabel) + '</b>: ' +
          escapeHtml(line.reasons.join('; ')) +
          matchSuggestion(store, demand.ingredients.find(item => item.id === line.id)) +
          '</li>']
      : [])
  })
  const actions = missingTasks.length
    ? '<section class="panel"><h2>Welke producten moet je nog nalopen?</h2>' +
        '<p>Controleer de echte winkelbron en kies pas daarna de bijbehorende product-ID opnieuw.</p>' +
        '<ul>' + missingTasks.join('') + '</ul></section>' : ''
  return '<!doctype html>\n<html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
    '<title>Supa · Privé twee-winkelmand</title>' +
    '<style>body{font:16px/1.55 system-ui,sans-serif;color:#193426;background:#f6f8f5;margin:0}' +
    'main{max-width:1100px;margin:auto;padding:28px 16px 70px}h1{font-size:clamp(1.5rem,4vw,2.3rem)}' +
    '.panel{background:white;border:1px solid #d2ddd4;border-radius:14px;padding:18px;margin:18px 0}' +
    '.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:640px}' +
    'th,td{border-bottom:1px solid #d9e2da;text-align:left;vertical-align:top;padding:12px}' +
    'td{width:34%}small{font-size:.82em;color:#4a6052}.missing{color:#80572a}' +
    'strong{color:#124c35}@media print{body{background:white}.panel{border:0;padding:0}main{max-width:none}}' +
    '</style></head><body><main><p>SUPA · PRIVATE OFFLINE</p><h1>Hetzelfde mandje, twee winkels</h1>' +
    '<p>Geselecteerde maaltijden: ' + demand.selectedMealCount +
    '. De product-ID’s zijn handmatig aan de eigen winkelopnames gekoppeld.</p>' +
    '<section class="panel" aria-label="Vergelijkingsstatus">' + summary + '</section>' +
    '<section class="panel"><h2>Opnames en voorwaarden</h2><p>' + dates + '</p><ul>' +
    notes.map(note => '<li>' + escapeHtml(note) + '</li>').join('') + '</ul></section>' +
    '<section class="panel"><h2>Mandje per product</h2><div class="table-wrap"><table>' +
    '<thead><tr><th>Ingredient en benodigde hoeveelheid</th><th>PLUS</th><th>DekaMarkt</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
    actions +
    '<p><small>Eenheidsprijzen zijn indicatief; kosten zijn berekend per volledige verpakking in hele eurocenten. ' +
    'Dit document verlaat het apparaat niet automatisch en bevat geen geautoriseerde publieke besparingsclaim.</small></p>' +
    '</main></body></html>\n'
}

async function main() {
  const argv = process.argv.slice(2)
  const paired = argv[0] === '--pair'
  const pricesJson = argv[0] === '--prices-json'
  const single = argv[0] === '--single'
  const args = paired || pricesJson || single ? argv.slice(1) : argv
  if (args.length !== (paired ? 4 : 3) || args.some(arg => !arg || arg.startsWith('-'))) {
    throw Error('Expected inputs')
  }
  const paths = args.map(resolve)
  if (new Set(paths).size !== paths.length) throw Error('Paths must differ')
  const sourcePaths = paths.slice(0, paired ? 2 : 1)
  const demandPath = paths.at(-2)
  const outputPath = paths.at(-1)
  const [csvFiles, demandText] = await Promise.all([
    Promise.all(sourcePaths.map(readPrivateCsv)),
    readPrivateDemand(demandPath),
  ])
  const csv = paired
    ? joinPrivateStoreCsv(csvFiles[0], csvFiles[1])
    : pricesJson ? offlinePriceJsonToCsv(csvFiles[0]) : csvFiles[0]
  // Missing retailer input remains UNKNOWN, never a fabricated second store.
  const normalizedJson = single || pricesJson
    ? convertOwnStoreCsv(csv) : convertTwoStoreCsv(csv)
  const source = JSON.parse(normalizedJson)
  const demand = parseDemand(demandText)
  const captures = Object.fromEntries(source.captures.map(c => [c.retailer, c]))
  const left = makeStoreBasket('PLUS', captures.PLUS, demand)
  const right = makeStoreBasket('DekaMarkt', captures.DekaMarkt, demand)
  const comparison = compareFullBaskets({ baseline: left, candidate: right })
  const nowNs = BigInt(Date.now()) * 1_000_000n
  const dates = STORES.map(store => captures[store]?.observedAt ?? null)
  const instants = dates.map(value => value === null ? null : observedNanoseconds(value))
  const ages = instants.map(instant => instant === null ? null : nowNs - instant)
  const gap = instants[0] === null || instants[1] === null ? null :
    (instants[0] >= instants[1] ? instants[0] - instants[1] : instants[1] - instants[0])
  const fresh = ages.every(age => age !== null && age >= 0n && age <= WEEK_NS) &&
    gap !== null && gap <= DAY_NS
  const html = renderHtml(source, demand, left, right, comparison, dates, ages, gap, fresh)
  await writeFile(outputPath, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write('Privé HTML-mandrapport opgeslagen; ' +
    (fresh && comparison.claimable ? 'volledige vergelijking aanwezig' : 'vergelijking onvolledig/onbekend') +
    '. Geen winkelprijzen of productgegevens naar de terminal geschreven.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('Privé mandrapport mislukt. Controleer eigen CSV, expliciete productkeuzes, behoefte-JSON en nieuw uitvoerpad. Geen bestand overschreven.\n')
    process.exitCode = 1
  })
}
