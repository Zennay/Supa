/** Strict offline adapter: Supa-owned price JSON -> existing canonical CSV admission. */
const HEADER = 'retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available'
const STORES = new Set(['PLUS', 'DekaMarkt'])
const FIELDS = ['id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available']
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const only = (x, keys) => Object.keys(x).every(k => keys.includes(k))
const cell = x => '"' + String(x).replaceAll('"', '""') + '"'

export function offlinePriceJsonToCsv(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 256000) {
    throw Error('Ongeldige eigen prijsbron')
  }
  const source = JSON.parse(text)
  if (!record(source) || !only(source, ['schema', 'captures']) ||
      source.schema !== 'supa-offline-prices-v1' ||
      !Array.isArray(source.captures) || source.captures.length !== 2) {
    throw Error('Ongeldig Supa prijsbronformaat')
  }
  const seen = new Set()
  const rows = [HEADER]
  for (const capture of source.captures) {
    if (!record(capture) || !only(capture, ['retailer', 'observedAt', 'products']) ||
        !STORES.has(capture.retailer) || seen.has(capture.retailer) ||
        typeof capture.observedAt !== 'string' ||
        !Array.isArray(capture.products) || capture.products.length < 1 ||
        capture.products.length > 1000) throw Error('Ongeldige eigen winkelopname')
    seen.add(capture.retailer)
    for (const p of capture.products) {
      if (!record(p) || !only(p, FIELDS) || typeof p.id !== 'string' ||
          typeof p.name !== 'string' || typeof p.packUnit !== 'string' ||
          typeof p.available !== 'boolean' ||
          !(p.packAmount === null || typeof p.packAmount === 'number') ||
          !(p.priceCents === null || typeof p.priceCents === 'number') ||
          !(p.packCount === null || p.packCount === undefined || typeof p.packCount === 'number')) {
        throw Error('Ongeldige eigen productgegevens')
      }
      // Missing stays missing, never infer a pack, capture, price or SKU.
      rows.push([capture.retailer, capture.observedAt, p.id, p.name,
        p.packAmount ?? '', p.packUnit, p.packCount ?? '',
        p.priceCents ?? '', p.available ? 'true' : 'false'].map(cell).join(','))
    }
  }
  if (seen.size !== STORES.size) throw Error('Twee winkelbronnen vereist')
  const csv = rows.join('\n') + '\n'
  if (new TextEncoder().encode(csv).length > 256000) throw Error('Eigen bron te groot')
  return csv
}
