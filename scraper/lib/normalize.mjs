// Normalisation shared by every adapter: money in whole cents, pack sizes in
// base units (g, ml, piece), validated GTINs and comparable name tokens.

export function toCents(value) {
  if (value === null || value === undefined || value === '') return null
  let n
  if (typeof value === 'number') n = value
  else if (typeof value === 'string') {
    let s = value.trim().replace(/^€\s*/, '').replace(/\s+/g, '')
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else return null
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null
  return Math.round(n * 100)
}

const UNIT_MAP = new Map([
  ['g', ['g', 1]],
  ['gr', ['g', 1]],
  ['gram', ['g', 1]],
  ['grams', ['g', 1]],
  ['grm', ['g', 1]],
  ['kg', ['g', 1000]],
  ['kilo', ['g', 1000]],
  ['kilogram', ['g', 1000]],
  ['kgm', ['g', 1000]],
  ['mg', ['g', 0.001]],
  ['ml', ['ml', 1]],
  ['mlt', ['ml', 1]],
  ['milliliter', ['ml', 1]],
  ['cl', ['ml', 10]],
  ['centiliter', ['ml', 10]],
  ['dl', ['ml', 100]],
  ['l', ['ml', 1000]],
  ['lt', ['ml', 1000]],
  ['ltr', ['ml', 1000]],
  ['liter', ['ml', 1000]],
  ['litre', ['ml', 1000]],
  ['st', ['piece', 1]],
  ['stk', ['piece', 1]],
  ['stuk', ['piece', 1]],
  ['stuks', ['piece', 1]],
  ['h87', ['piece', 1]],
  ['pcs', ['piece', 1]],
  ['rol', ['piece', 1]],
  ['rollen', ['piece', 1]],
  ['tabs', ['piece', 1]],
  ['tabletten', ['piece', 1]],
  ['zakjes', ['piece', 1]],
  ['capsules', ['piece', 1]],
  ['cups', ['piece', 1]],
  ['pads', ['piece', 1]],
  ['wasbeurten', ['piece', 1]],
  ['plakken', ['piece', 1]],
  ['eieren', ['piece', 1]],
])

const UNIT_PATTERN = [...UNIT_MAP.keys()].sort((a, b) => b.length - a.length).join('|')
const NUM = '(\\d+(?:[.,]\\d+)?)'
const MULTI_RE = new RegExp(`(\\d+)\\s*[x×]\\s*${NUM}\\s*(${UNIT_PATTERN})\\b`, 'i')
const SINGLE_RE = new RegExp(`${NUM}\\s*-?\\s*(${UNIT_PATTERN})\\b`, 'i')

function num(s) {
  return Number(String(s).replace(',', '.'))
}

export function unitFromCode(code) {
  if (!code) return null
  const hit = UNIT_MAP.get(String(code).trim().toLowerCase())
  return hit ?? null
}

// Returns { amount, unit, count } where amount is per item in base units and
// count the number of items in the pack. Unknown => amount null.
export function parsePack(text) {
  const empty = { amount: null, unit: null, count: 1 }
  if (typeof text !== 'string' || !text.trim()) return empty
  const s = text.toLowerCase().replace(/ /g, ' ')

  const multi = MULTI_RE.exec(s)
  if (multi) {
    const [base, factor] = UNIT_MAP.get(multi[3].toLowerCase())
    const count = Number(multi[1])
    const amount = num(multi[2]) * factor
    if (count > 0 && amount > 0) return { amount: round(amount), unit: base, count }
  }
  const single = SINGLE_RE.exec(s)
  if (single) {
    const [base, factor] = UNIT_MAP.get(single[2].toLowerCase())
    const amount = num(single[1]) * factor
    if (amount > 0) {
      if (base === 'piece') return { amount: 1, unit: 'piece', count: amount }
      return { amount: round(amount), unit: base, count: 1 }
    }
  }
  if (/\b(per stuk|stuk|los)\b/.test(s)) return { amount: 1, unit: 'piece', count: 1 }
  return empty
}

export function packFromAmount(amount, unitCode) {
  const unit = unitFromCode(unitCode)
  const n = typeof amount === 'string' ? num(amount) : amount
  if (!unit || !Number.isFinite(n) || n <= 0) return { amount: null, unit: null, count: 1 }
  const [base, factor] = unit
  if (base === 'piece') return { amount: 1, unit: 'piece', count: n }
  return { amount: round(n * factor), unit: base, count: 1 }
}

function round(n) {
  return Math.round(n * 1000) / 1000
}

export function totalPackQuantity(pack) {
  if (!pack || pack.amount === null || !pack.unit) return null
  return round(pack.amount * (pack.count || 1))
}

// GTIN-8/12/13/14 with valid check digit, normalised to 13 digits when
// possible (GTIN-14 with leading 0 and UPC-12 collapse onto EAN-13).
export function normalizeGtin(value) {
  if (value === null || value === undefined) return null
  let s = String(value).replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(s.length)) return null
  if (!/[1-9]/.test(s)) return null
  const digits = s.split('').map(Number)
  const check = digits.pop()
  let sum = 0
  for (let i = digits.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += digits[i] * w
  if ((10 - (sum % 10)) % 10 !== check) return null
  if (s.length === 12) s = '0' + s
  if (s.length === 14 && s.startsWith('0')) s = s.slice(1)
  return s
}

// In-store / variable-measure GTINs (prefix 02, 20-29 for EAN-13) are
// retailer-internal and must never be used to match across retailers.
export function isGlobalGtin(gtin) {
  if (!gtin) return false
  if (gtin.length === 8) return !/^[02]/.test(gtin)
  if (gtin.length === 13) return !/^(0[2]|2\d)/.test(gtin)
  return true
}

export function cleanText(value) {
  if (typeof value !== 'string') return null
  const s = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

export function foldText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' en ')
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const NAME_STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'met', 'van', 'voor', 'in', 'op', 'of', 'per',
  'pak', 'fles', 'zak', 'doos', 'blik', 'pot', 'tube', 'stuk', 'stuks', 'st',
  'krat', 'set', 'bak', 'beker', 'netje', 'tray', 'kuipje', 'rol', 'x',
])

export function nameTokens(name, brand) {
  const brandTokens = new Set(foldText(brand).split(' ').filter(Boolean))
  return foldText(name)
    .replace(new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(${UNIT_PATTERN})\\b`, 'g'), ' ')
    .split(' ')
    .filter((t) => t && !NAME_STOPWORDS.has(t) && !brandTokens.has(t) && !/^\d+$/.test(t))
}

export function normalizeAvailability(value) {
  if (value === true) return 'available'
  if (value === false) return 'unavailable'
  if (typeof value !== 'string') return 'unknown'
  const v = value.toLowerCase()
  if (/instock|instoreonly|limitedavailability|onlineonly/.test(v)) return 'available'
  if (/outofstock|discontinued|soldout|preorder/.test(v)) return 'unavailable'
  return 'unknown'
}

// Build a canonical product record; adapters fill what they know.
export function makeRecord(fields) {
  const pack =
    fields.pack ??
    (fields.packText ? parsePack(fields.packText) : { amount: null, unit: null, count: 1 })
  const priceCents = fields.priceCents ?? null
  let promoPriceCents = fields.promoPriceCents ?? null
  if (promoPriceCents !== null && priceCents !== null && promoPriceCents >= priceCents) {
    promoPriceCents = null
  }
  const gtin = normalizeGtin(fields.gtin)
  return {
    retailer: fields.retailer,
    sourceId: String(fields.sourceId),
    url: fields.url ?? null,
    name: cleanText(fields.name),
    brand: cleanText(fields.brand),
    gtin,
    extraGtins: (fields.extraGtins ?? []).map(normalizeGtin).filter((g) => g && g !== gtin),
    category: cleanText(fields.category),
    packText: cleanText(fields.packText),
    packAmount: pack.amount,
    packUnit: pack.unit,
    packCount: pack.count ?? 1,
    imageUrl: fields.imageUrl ?? null,
    priceCents,
    promoPriceCents,
    promoLabel: cleanText(fields.promoLabel),
    promoValidFrom: fields.promoValidFrom ?? null,
    promoValidUntil: fields.promoValidUntil ?? null,
    availability: fields.availability ?? 'unknown',
  }
}

export function isValidRecord(record) {
  return Boolean(record && record.retailer && record.sourceId && record.name)
}
