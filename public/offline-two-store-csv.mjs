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
export function convertTwoStoreCsv(text) {
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
    if (!validLabel(id, 100)) error(location + ': product-ID ongeldig.')
    if (!UNITS.includes(unit)) error(location + ': eenheid moet g/kg/ml/l/piece zijn.')
    if (!['true', 'false'].includes(availableText)) {
      error(location + ': beschikbaarheid moet letterlijk true of false zijn.')
    }
    // The planner deliberately exports one unobserved demand row per store.
    // No product name, package, price or time exists for such a row. Omit it
    // instead of inventing a retailer SKU. The existing basket matcher then
    // leaves the corresponding ingredient unresolved, never priced at €0.
    if (name === '' && pack === '' && count === '' && cents === '' && availableText === 'false') {
      continue
    }
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
  if (captures.size !== 2 || !RETAILERS.every(store => captures.has(store))) {
    error('CSV vereist minimaal één expliciete rij voor elk van de twee winkels.')
  }
  const value = { schema: 'supa-offline-prices-v1', captures: RETAILERS.map(store => captures.get(store)) }
  const json = JSON.stringify(value, null, 2) + '\n'
  if (new TextEncoder().encode(json).length > MAX_BYTES) error('Gegenereerde JSON is groter dan 256 kB.')
  return json
}

