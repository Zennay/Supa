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

const fail = () => { throw new Error('Private matched retailer comparison refused') }
const money = cents => '€' + (cents / 100).toFixed(2)
const printable = value => String(value).replace(
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' '
).slice(0, 200)

const gcd = (left, right) => {
  while (right !== 0n) {
    const next = left % right
    left = right
    right = next
  }
  return left
}

// A canonical ID alone does not prove equal physical pack contents.
// Normalize mass/volume exactly and keep multipack count in the identity.
function physicalPackKey(row) {
  const unit = typeof row.packUnit === 'string' ? row.packUnit.trim().toLowerCase() : ''
  const family = ({ g: 'mass', kg: 'mass', ml: 'volume', l: 'volume', piece: 'piece' })[unit]
  const amount = row.packAmount
  const count = row.packCount
  if (!family || typeof amount !== 'number' || !Number.isFinite(amount) ||
      amount <= 0 || amount > 1000000 || !Number.isSafeInteger(count) ||
      count < 1 || count > 1000) return null
  if (unit === 'piece' && !Number.isSafeInteger(amount)) return null
  const match = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(String(amount))
  if (!match) return null
  const fraction = match[2] ?? ''
  let numerator = BigInt(match[1] + fraction)
  let denominator = 10n ** BigInt(fraction.length)
  const factor = unit === 'kg' || unit === 'l' ? 1000n : 1n
  numerator *= factor * BigInt(count)
  const divisor = gcd(numerator, denominator)
  numerator /= divisor
  denominator /= divisor
  return `${family}:${numerator}/${denominator}:count:${count}`
}

function sameProductObservation(left, right) {
  return left.supermarket === right.supermarket &&
    left.name === right.name &&
    left.sourceUrl === right.sourceUrl &&
    left.observedAt === right.observedAt &&
    left.priceCents === right.priceCents &&
    left.regularPriceCents === right.regularPriceCents &&
    left.offer === right.offer &&
    left.packKey === right.packKey
}

function physicalPackLabel(row) {
  return String(row.packAmount) + ' ' + String(row.packUnit) + ' × ' + String(row.packCount)
}

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
      const packKey = physicalPackKey(row)
      const group = groups.get(key) ?? { packKey, rows: [], invalid: false }
      if (!packKey) {
        group.invalid = true
        groups.set(key, group)
        continue
      }
      if (group.invalid) {
        groups.set(key, group)
        continue
      }
      if (group.packKey !== packKey) {
        group.invalid = true
        groups.set(key, group)
        continue
      }
      const candidate = {
        supermarket: row.supermarket,
        name: printable(row.name),
        sourceUrl: row.sourceUrl,
        observedAt: row.observedAt,
        priceCents: row.priceCents,
        regularPriceCents: row.regularPriceCents,
        offer: row.offer,
        packKey,
        packAmount: row.packAmount,
        packUnit: row.packUnit,
        packCount: row.packCount,
      }
      const previous = group.rows.find(item => item.supermarket === row.supermarket)
      if (previous) {
        if (!sameProductObservation(previous, candidate)) group.invalid = true
        groups.set(key, group)
        continue
      }
      group.rows.push(candidate)
      groups.set(key, group)
    }
  } catch {
    fail()
  } finally {
    database?.close()
  }

  const matched = [...groups.entries()]
    .filter(([, group]) => !group.invalid && new Set(group.rows.map(row => row.supermarket)).size >= 2)
    .sort((a,b) => a[0] - b[0])
  write('SUPA PRIVÉ: goedgekeurde, recente online bronobservaties; GEEN veldmand of bewezen besparing.')
  for (const [, group] of matched) {
    write('--- Handmatig te verifiëren productmatch; identieke fysieke verpakking vereist ---')
    for (const row of group.rows.sort((a,b) => a.supermarket.localeCompare(b.supermarket))) {
      write(printable(row.supermarket) + ': ' + row.name + ' [' + physicalPackLabel(row) + '] ' + money(row.priceCents) +
        (row.offer ? ' (actie, normaal ' + money(row.regularPriceCents) + ')' : '') +
        ' · archief ' + printable(row.observedAt))
    }
  }
  if (matched.length === 0) write('Geen twee recent goedgekeurde winkels met dezelfde productmatch.')
  return {
    approvedSourceCount: approved.length,
    matchedGroups: matched.length,
    displayedRows: matched.reduce((count, [, group]) => count + group.rows.length, 0),
    historicalFieldSavingsProven: false,
    publicPriceClaimsAllowed: false,
  }
}
