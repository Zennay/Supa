/**
 * Private operator-only side of the multi-retailer CLI compare command.
 * Never treat raw SQLite effective_price_cents as a current or lawful offer.
 * Delegates rights, freshness, stock, source host and offer chronology to
 * already reviewed product-core gates before exposing any price text.
 */
import { DatabaseSync } from 'node:sqlite'
import { types as nodeTypes } from 'node:util'
import { planDailyRefresh } from './daily-refresh.mjs'
import { findFreshProducts } from './retailer-search-api.mjs'
import { foldText, isGlobalGtin, nameNumbers, normalizeGtin } from './lib/normalize.mjs'

const fail = () => { throw new Error('Private matched retailer comparison refused') }
// Persisted product_matches may have been built before pack-safe matching.
// A canonical ID alone is not a trustworthy whole-pack price equivalence.
const physicalPackKey = ({pack_amount, pack_unit, pack_count, pack_text}) => {
  if (typeof pack_amount !== 'number' || !Number.isFinite(pack_amount) ||
      pack_amount <= 0 || !['g', 'ml', 'piece'].includes(pack_unit) ||
      !Number.isSafeInteger(pack_count) || pack_count <= 0 ||
      typeof pack_text !== 'string' || !pack_text.trim() ||
      /\d\s*[-–]\s*\d/.test(pack_text)) return null
  const total = pack_amount * pack_count
  if (!Number.isFinite(total) || total <= 0) return null
  return JSON.stringify([pack_unit, pack_count, total])
}

/**
 * A persisted canonical ID is historical, not current identity evidence.
 * Require complete current brand/name facts, then accept either an exact
 * normalized brand+name match or a valid shared global GTIN. A shared GTIN
 * never overrides conflicting brand or product-identity numbers (0% vs 100%).
 */
function productIdentityEvidence(row) {
  const brandKey = foldText(row.brand)
  const nameKey = foldText(row.name)
  if (!brandKey || !nameKey) return null
  const gtins = typeof row.gtins === 'string'
    ? [...new Set(row.gtins.split(',').map(normalizeGtin).filter(gtin => gtin && isGlobalGtin(gtin)))]
    : []
  return { brandKey, nameKey, identityNumbers: nameNumbers(row.name), gtins }
}

function sameProductIdentity(left, right) {
  if (!left || !right || !left.brandKey || left.brandKey !== right.brandKey ||
      !left.nameKey || !right.nameKey ||
      left.identityNumbers !== right.identityNumbers) return false
  if (left.nameKey === right.nameKey) return true
  return left.gtins.some(gtin => right.gtins.includes(gtin))
}
const money = cents => '€' + (cents / 100).toFixed(2)
const printable = value => String(value).replace(
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' '
).slice(0, 200)

// Snapshot an inert, fixed options record BEFORE JavaScript destructuring can
// run caller getters, Proxy traps or inherited field hooks. Never read fields
// from an untrusted options object directly.
function ownOptions(input) {
  if (input === null || typeof input !== 'object' ||
      nodeTypes.isProxy(input) || Array.isArray(input)) fail()
  const proto = Object.getPrototypeOf(input)
  if (proto !== Object.prototype && proto !== null) fail()
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const permitted = new Set([
    'query', 'dbPath', 'policyPath', 'sourceGatePath', 'now', 'write',
  ])
  const own = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !permitted.has(key) ||
        !Object.hasOwn(descriptors[key], 'value')) fail()
    own[key] = descriptors[key].value
  }
  return own
}

/**
 * An operator-supplied legal policy is not itself real retailer permission;
 * the normal canonical PLUS/Deka M1 gate remains an independent deny.
 * Emit no names or individual prices before BOTH scopes are checked.
 */
export async function compareApprovedLocalCatalog(options = {}) {
  const safe = ownOptions(options)
  const query = safe.query
  const dbPath = safe.dbPath
  const policyPath = safe.policyPath
  const sourceGatePath = safe.sourceGatePath === undefined
    ? 'evidence/m1/source-permission-gate.v1.json' : safe.sourceGatePath
  const clock = safe.now === undefined ? new Date() : safe.now
  const write = safe.write === undefined
    ? text => process.stdout.write(text + '\n') : safe.write
  // Calling a custom Date#getTime() would run arbitrary caller code.
  // Validate built-in Date brand/prototype and invoke the native method only.
  if (nodeTypes.isProxy(clock) || !nodeTypes.isDate(clock) ||
      Object.getPrototypeOf(clock) !== Date.prototype) fail()
  const millis = Date.prototype.getTime.call(clock)
  if (!Number.isFinite(millis)) fail()
  const now = new Date(millis)
  if (typeof query !== 'string' || query.trim().length < 2 ||
      query.length > 80 || /[\u0000-\u001f\u007f]/.test(query) ||
      typeof dbPath !== 'string' || !dbPath.trim() ||
      typeof policyPath !== 'string' || !policyPath.trim() ||
      typeof sourceGatePath !== 'string' || !sourceGatePath.trim() ||
      typeof write !== 'function' || nodeTypes.isProxy(write)) fail()

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
      'SELECT m.canonical_id, p.pack_amount, p.pack_unit, p.pack_count, p.pack_text, ' +
      'p.brand, p.name, (SELECT group_concat(g.gtin) FROM product_gtins g ' +
      'WHERE g.product_id = p.id) AS gtins FROM product_matches m ' +
      'JOIN products p ON p.id = m.product_id ' +
      'WHERE p.retailer_id=? AND p.url=? LIMIT 2')
    groups = new Map()
    const invalidGroups = new Set()
    for (const row of fresh) {
      const matches = idStmt.all(row.supermarket, row.sourceUrl)
      // Do not guess when the same URL has contradictory SKU/match mappings.
      if (matches.length !== 1 ||
          !Number.isSafeInteger(matches[0].canonical_id)) continue
      const key = matches[0].canonical_id
      const packKey = physicalPackKey(matches[0])
      const identity = productIdentityEvidence(matches[0])
      if (!packKey || !identity) { invalidGroups.add(key); continue }
      if (!groups.has(key)) groups.set(key, [])
      const rows = groups.get(key)
      // A stale canonical ID cannot bridge different brands or named variants.
      if (rows.length > 0 && !sameProductIdentity(rows[0].identity, identity)) {
        invalidGroups.add(key)
      }
      // One retailer having several physical rows under one canonical ID is
      // ambiguous even if the first candidate happens to match the other
      // retailer. Refuse the *entire group* rather than picking arbitrarily.
      if (rows.some(previous => previous.supermarket === row.supermarket)) {
        invalidGroups.add(key)
        continue
      }
      rows.push({
          packKey,
          identity,
          supermarket: row.supermarket,
          name: printable(row.name),
          priceCents: row.priceCents,
          regularPriceCents: row.regularPriceCents,
          offer: row.offer,
          observedAt: row.observedAt,
        })
    }
    // Keep the group rejection marker inside the successful read phase;
    // later rendering must never re-admit stale canonical links.
    for (const [key, rows] of groups) {
      if (rows.some(row => row.packKey !== rows[0].packKey)) invalidGroups.add(key)
      if (invalidGroups.has(key)) groups.delete(key)
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
