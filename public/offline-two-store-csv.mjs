/** Shared, network-free CSV importer used by the Node CLI and browser converter. */
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
]
const RETAILERS = ['PLUS', 'DekaMarkt']
const UNITS = ['g', 'kg', 'ml', 'l', 'piece']
const MAX_BYTES = 256000
const error = (message) => { throw new Error(message) }

function parseCsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) {
    error('CSV ontbreekt of is groter dan 256 kB.')
  }
  if (text.startsWith('\uFEFF')) text = text.slice(1)
  if (text.includes('\u0000')) error('CSV bevat ongeldige tekens.')
  const rows = []
  let record = []
  let cell = ''
  let quoted = false
  let justClosed = false
  let atStart = true
  const finishCell = () => {
    record.push(cell)
    cell = ''
    justClosed = false
    atStart = true
  }
  const finishRecord = () => {
    finishCell()
    rows.push(record)
    record = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else { quoted = false; justClosed = true }
      } else {
        cell += c
      }
      continue
    }
    if (c === '"') {
      if (!atStart || justClosed) error('CSV aanhalingstekens zijn ongeldig.')
      quoted = true
      atStart = false
    } else if (c === ',') {
      finishCell()
    } else if (c === '\n' || c === '\r') {
      if (c === '\r') {
        if (text[i + 1] !== '\n') error('CSV-regelafbreking ongeldig.')
        i++
      }
      finishRecord()
    } else {
      if (justClosed) error('Tekens na een gesloten CSV-veld.')
      cell += c
      atStart = false
    }
  }
  if (quoted) error('CSV bevat een niet-afgesloten tekstveld.')
  if (record.length || cell.length || justClosed || !atStart) finishRecord()
  return rows
}

const validLabel = (value, limit) =>
  value.length > 0 && value.length <= limit && value === value.trim() &&
  /[\p{L}\p{N}]/u.test(value) &&
  !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(value) &&
  !/^[=+@-]/u.test(value)
const parsePositiveNumber = (text, ceiling) => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) return null
  const number = Number(text)
  return Number.isFinite(number) && number > 0 && number <= ceiling ? number : null
}
const parseInteger = (text, min, max) =>
  /^(?:0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text)) &&
  Number(text) >= min && Number(text) <= max ? Number(text) : null

function validObservedAt(raw) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?([+-])(\d\d):(\d\d)$/.exec(raw)
  if (!match) return false
  const [, y, m, d, h, minute, second, , sign, tzHour, tzMinute] = match
  const [year, month, day, hour, min, sec, zoneH, zoneM] =
    [y, m, d, h, minute, second, tzHour, tzMinute].map(Number)
  if (year < 2000 || year > 2100 || zoneM > 59 ||
      (sign === '+' ? zoneH > 14 || (zoneH === 14 && zoneM !== 0)
        : zoneH > 12 || (zoneH === 12 && zoneM !== 0))) return false
  const civil = new Date(0)
  civil.setUTCFullYear(year, month - 1, day)
  civil.setUTCHours(hour, min, sec, 0)
  return civil.getUTCFullYear() === year && civil.getUTCMonth() === month - 1 &&
    civil.getUTCDate() === day && civil.getUTCHours() === hour &&
    civil.getUTCMinutes() === min && civil.getUTCSeconds() === sec &&
    Number.isFinite(Date.parse(raw))
}

/**
 * Convert only caller-supplied observations. Unknown package/price stays null,
 * and is NEVER promoted to purchasable inventory or savings evidence.
 */
function convertStoreCsv(text, allowOne) {
  const rows = parseCsv(text)
  if (!rows.length || HEADER.some((h, i) => rows[0][i] !== h) ||
      rows[0].length !== HEADER.length) {
    error('CSV-kop moet exact zijn: ' + HEADER.join(','))
  }
  const captures = new Map()
  const seen = new Map()
  for (const retailer of RETAILERS) seen.set(retailer, new Set())
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const location = 'CSV-regel ' + (i + 1)
    if (row.length !== HEADER.length) error(location + ': verwacht negen kolommen.')
    const [retailer, observedAt, id, name, pack, unit, count, cents, availableText] = row
    if (!RETAILERS.includes(retailer)) error(location + ': onbekende winkel.')
    // The downloaded Planner sheet contains NO retailer identities, prices or
    // source observation. Its truly untouched rows carry no product facts and
    // are deliberately ignored. Partially entered rows must NOT be skipped.
    // Only a real, explicitly completed source row can become a product.
    if (observedAt === '' && id === '' && name === '' && pack === '' &&
        count === '' && cents === '' && availableText === 'false' &&
        (unit === '' || UNITS.includes(unit))) {
      continue
    }
    if (!validLabel(id, 100)) error(location + ': product-ID ongeldig.')
    if (!UNITS.includes(unit)) error(location + ': eenheid moet g/kg/ml/l/piece zijn.')
    if (!['true', 'false'].includes(availableText)) {
      error(location + ': beschikbaarheid moet letterlijk true of false zijn.')
    }
    // A row with even one entered identity, time or product field is NOT blank.
    // Do not silently discard a partial capture: report the exact CSV row so
    // the user can finish it or deliberately clear every observation field.
    if (!validObservedAt(observedAt)) error(location + ': werkelijke ISO-tijd met UTC-offset vereist.')
    if (!validLabel(name, 160)) error(location + ': productnaam ongeldig of ontbreekt.')
    if (seen.get(retailer).has(id)) error(location + ': dubbele product-ID.')
    seen.get(retailer).add(id)
    const available = availableText === 'true'
    const amount = pack === '' ? null : parsePositiveNumber(pack, 100000)
    if (pack !== '' && amount === null) error(location + ': verpakkingsinhoud ongeldig.')
    const priceCents = cents === '' ? null : parseInteger(cents, 0, 1000000)
    if (cents !== '' && priceCents === null) error(location + ': prijs in hele eurocenten vereist.')
    const packCount = count === '' ? null : parseInteger(count, 1, 1000)
    if (count !== '' && packCount === null) error(location + ': multipack-aantal ongeldig.')
    if (available && (amount === null || priceCents === null || packCount === null)) {
      error(location + ': beschikbaar product vereist gemeten verpakking, multipack en prijs.')
    }
    if (!captures.has(retailer)) captures.set(retailer, { retailer, observedAt, products: [] })
    const capture = captures.get(retailer)
    if (capture.observedAt !== observedAt) {
      error(location + ': een winkelopname mag maar één waarnemingstijd hebben.')
    }
    if (capture.products.length >= 1000) error(location + ': maximaal 1.000 producten per winkel.')
    const product = { id, name, packAmount: amount, packUnit: unit, priceCents, available }
    if (packCount !== null) product.packCount = packCount
    capture.products.push(product)
  }
  if (!captures.size || (!allowOne && (captures.size !== 2 || !RETAILERS.every(store => captures.has(store))))) {
    error('CSV vereist expliciet de echte waarnemingen van de geselecteerde winkel(s).')
  }
  const value = {
    schema: captures.size === 1 ? 'supa-private-single-store-prices-v1' : 'supa-offline-prices-v1',
    captures: RETAILERS.filter(store => captures.has(store)).map(store => captures.get(store)),
  }
  const json = JSON.stringify(value, null, 2) + '\n'
  if (new TextEncoder().encode(json).length > MAX_BYTES) error('Gegenereerde JSON is groter dan 256 kB.')
  return json
}


// The canonical two-store importer remains strict and unchanged in what it admits.
// This explicit single-store path keeps the absent retailer absent (no fake time,
// product, zero-price row or invented second observation).
export const convertTwoStoreCsv = text => convertStoreCsv(text, false)
export const convertOwnStoreCsv = text => convertStoreCsv(text, true)

/**
 * Read-only local worksheet preview. Reuse the exact importer rather than
 * implementing a second, more permissive way to accept prices. A blank row
 * is explicitly unobserved, never a free product or a source observation.
 * Returned counts contain no original labels, SKUs, timestamps or prices.
 */
export function previewOwnStoreCsv(text) {
  const rows = parseCsv(text)
  if (!rows.length || rows[0].length !== HEADER.length ||
      HEADER.some((field, index) => rows[0][index] !== field)) {
    error('CSV-kop moet exact zijn: ' + HEADER.join(','))
  }
  const blanks = Object.fromEntries(RETAILERS.map(store => [store, 0]))
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index]
    if (row.length !== HEADER.length) error('CSV-regel ' + (index + 1) + ': verwacht negen kolommen.')
    const [store, time, id, name, amount, unit, count, cents, available] = row
    if (!RETAILERS.includes(store)) error('CSV-regel ' + (index + 1) + ': onbekende winkel.')
    if (time === '' && id === '' && name === '' && amount === '' &&
        count === '' && cents === '' && available === 'false' &&
        (unit === '' || UNITS.includes(unit))) {
      blanks[store]++
    }
  }
  const admitted = JSON.parse(convertOwnStoreCsv(text))
  return {
    stores: admitted.captures.map(capture => ({
      retailer: capture.retailer,
      enteredProducts: capture.products.length,
      unobservedRows: blanks[capture.retailer],
      observedAt: capture.observedAt,
      unavailableProducts: capture.products.filter(p => !p.available || p.priceCents === null).length,
      // Display only. These are the user's original, canonically admitted
      // local source fields, NOT independently verified retailer facts.
      previewProducts: capture.products.slice(0, 12).map(p => ({
        id: p.id, name: p.name, packAmount: p.packAmount, packUnit: p.packUnit,
        packCount: p.packCount ?? 1, priceCents: p.priceCents, available: p.available,
      })),
    })),
    unobservedOtherStoreRows: RETAILERS
      .filter(store => !admitted.captures.some(c => c.retailer === store))
      .reduce((total, store) => total + blanks[store], 0),
  }
}
