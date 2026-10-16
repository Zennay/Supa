/**
 * Private operator-only side of the multi-retailer CLI compare command.
 * Never treat raw SQLite effective_price_cents as a current or lawful offer.
 * Delegates rights, freshness, stock, source host and offer chronology to
 * already reviewed product-core gates before exposing any price text.
 */
import { DatabaseSync } from 'node:sqlite'
import { planDailyRefresh } from './daily-refresh.mjs'
import { findFreshProducts } from './retailer-search-api.mjs'

const fail = () => { throw new Error('Private matched retailer comparison refused') }
const money = cents => '€' + (cents / 100).toFixed(2)
const printable = value => String(value).replace(
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' '
).slice(0, 200)

/**
 * An operator-supplied legal policy is not itself real retailer permission;
 * the normal canonical PLUS/Deka M1 gate remains an independent deny.
 * Emit no names or individual prices before BOTH scopes are checked.
 */
export async function compareApprovedLocalCatalog({
  query, dbPath, policyPath,
  sourceGatePath = 'evidence/m1/source-permission-gate.v1.json',
  now = new Date(), write = text => process.stdout.write(text + '\n'),
} = {}) {
  if (typeof query !== 'string' || query.trim().length < 2 ||
      query.length > 80 || /[\u0000-\u001f\u007f]/.test(query) ||
      typeof dbPath !== 'string' || !dbPath.trim() ||
      typeof policyPath !== 'string' || !policyPath.trim() ||
      typeof sourceGatePath !== 'string' || !sourceGatePath.trim() ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      typeof write !== 'function') fail()

  // This canonical admission is the same one as the locally gated search API.
  // Default deny: if policy path / canonical rights are absent or malformed,
  // do not even open the SQLite DB, let alone show an item's price.
  let approved
  try {
    approved = await planDailyRefresh({ policyPath, sourceGatePath, now })
  } catch { fail() }
  if (approved.length === 0) {
    write('SUPA privé vergelijking: geen goedgekeurde databronnen. Geen prijzen getoond.')
    return { approvedSourceCount: 0, matchedGroups: 0, displayedRows: 0,
      historicalFieldSavingsProven: false, publicPriceClaimsAllowed: false }
  }

  let database
  let groups
  try {
    database = new DatabaseSync(dbPath, { readOnly: true })
    // Only these rows have approved scope, correct source host, ≤24h archive
    // timestamp, available stock and a physically ACTIVE offer price.
    const fresh = findFreshProducts(database, approved, query, now)
    const idStmt = database.prepare(
      'SELECT m.canonical_id FROM product_matches m ' +
      'JOIN products p ON p.id = m.product_id ' +
      'WHERE p.retailer_id=? AND p.url=? LIMIT 2')
    groups = new Map()
    for (const row of fresh) {
      const matches = idStmt.all(row.supermarket, row.sourceUrl)
      // Do not guess when the same URL has contradictory SKU/match mappings.
      if (matches.length !== 1 ||
          !Number.isSafeInteger(matches[0].canonical_id)) continue
      const key = matches[0].canonical_id
      if (!groups.has(key)) groups.set(key, [])
      const rows = groups.get(key)
      if (!rows.some(previous => previous.supermarket === row.supermarket)) {
        rows.push({
          supermarket: row.supermarket,
          name: printable(row.name),
          priceCents: row.priceCents,
          regularPriceCents: row.regularPriceCents,
          offer: row.offer,
          observedAt: row.observedAt,
        })
      }
    }
  } catch {
    fail()
  } finally {
    database?.close()
  }

  const matched = [...groups.entries()]
    .filter(([, rows]) => new Set(rows.map(row => row.supermarket)).size >= 2)
    .sort((a,b) => a[0] - b[0])
  write('SUPA PRIVÉ: goedgekeurde, recente online bronobservaties; GEEN veldmand of bewezen besparing.')
  for (const [, rows] of matched) {
    write('--- Handmatig te verifiëren productmatch ---')
    for (const row of rows.sort((a,b) => a.supermarket.localeCompare(b.supermarket))) {
      write(printable(row.supermarket) + ': ' + row.name + ' ' + money(row.priceCents) +
        (row.offer ? ' (actie, normaal ' + money(row.regularPriceCents) + ')' : '') +
        ' · archief ' + printable(row.observedAt))
    }
  }
  if (matched.length === 0) write('Geen twee recent goedgekeurde winkels met dezelfde productmatch.')
  return {
    approvedSourceCount: approved.length,
    matchedGroups: matched.length,
    displayedRows: matched.reduce((count, [, rows]) => count + rows.length, 0),
    historicalFieldSavingsProven: false,
    publicPriceClaimsAllowed: false,
  }
}
