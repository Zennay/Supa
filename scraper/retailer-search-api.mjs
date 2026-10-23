/**
 * SUPA local search API for its existing nine-retailer SQLite scraper DB.
 * No live retailer fetch; no invented discounts; 24-hour freshness gate.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { adapters } from './adapters/index.mjs'
import { planDailyRefresh } from './daily-refresh.mjs'
import { renderRetailerSearchHtml } from './retailer-search-html.mjs'

const MAX_AGE_MS = 24 * 3600_000
const expectedHosts = Object.fromEntries(adapters.map(a => [a.id, a.host]))
const cents = n => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000
const text = (v,max=200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
function queryText(input) {
  if (typeof input !== 'string' || input.length > 80 ||
      /[\x00-\x1f\x7f]/.test(input)) return null
  const q = input.trim().replace(/\s+/g,' ')
  return q.length >= 2 ? q : null
}
function safeSourceUrl(raw, id) {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && u.host === expectedHosts[id] &&
      !u.username && !u.password && !u.hash && !u.search &&
      u.href === raw ? u.href : null
  } catch { return null }
}

/**
 * Discounts must be active at the actual UTC instant, not Date.parse's
 * rounded-millisecond approximation. Date.parse also normalizes impossible
 * civil days in some runtimes (e.g. February 30), so validate first.
 * An undefined result means invalid; null means the existing unknown boundary.
 * Invalid dates cannot create discounts or public savings claims.
 */
function offerInstantNanos(value) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!m) return undefined
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  const hours = Number(m[4]), minutes = Number(m[5]), seconds = Number(m[6])
  const calendar = new Date(0)
  calendar.setUTCFullYear(year, month - 1, day)
  if (calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day ||
      hours > 23 || minutes > 59 || seconds > 59) return undefined
  if (m[8] !== 'Z') {
    const offsetH = Number(m[8].slice(1, 3))
    const offsetM = Number(m[8].slice(4))
    if (offsetH > 14 || offsetM > 59 ||
        (offsetH === 14 && offsetM !== 0)) return undefined
  }
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return undefined
  return BigInt(ms) * 1_000_000n +
    BigInt((m[7] ?? '').padEnd(9, '0').slice(3) || '0')
}

export function findFreshProducts(database, approvedIds, query, now = new Date()) {
  const q = queryText(query)
  if (!q || !Array.isArray(approvedIds) || approvedIds.length === 0 ||
      approvedIds.length > 12 || !Number.isFinite(now?.getTime?.()) ||
      approvedIds.some(id => !Object.hasOwn(expectedHosts,id))) return []
  const ids = [...new Set(approvedIds)]
  const sql = 'SELECT p.retailer_id, r.name AS retailer_name, p.name, p.brand, ' +
    'p.pack_text, p.pack_amount, p.pack_count, p.pack_unit, p.url, ' +
    'lp.price_cents, lp.promo_price_cents, lp.promo_valid_until, ' +
    // Existing deployed SQLite "latest_prices" views lack the campaign start.
    // Read from the exact same latest price row without migrating the view.
    '(SELECT price.promo_valid_from FROM prices price WHERE price.product_id=p.id ' +
    'ORDER BY price.last_seen_at DESC, price.id DESC LIMIT 1) AS promo_valid_from, ' +
    'lp.observed_at, lp.availability ' +
    'FROM products p JOIN retailers r ON r.id=p.retailer_id ' +
    'JOIN latest_prices lp ON lp.product_id=p.id ' +
    'WHERE p.retailer_id IN (' + ids.map(() => '?').join(',') + ') ' +
    "AND lower(p.name) LIKE ? ESCAPE '\\' " +
    "AND lp.availability='available' AND lp.observed_at>=? " +
    'AND lp.observed_at<=? ORDER BY lp.observed_at DESC, lower(p.name) LIMIT 250'
  const rows = database.prepare(sql).all(...ids,
    '%' + q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%',
    new Date(now.getTime()-MAX_AGE_MS).toISOString(),now.toISOString())
  const results = []
  for (const row of rows) {
    const url = safeSourceUrl(row.url, row.retailer_id)
    const timestamp = Date.parse(row.observed_at)
    if (!url || !Number.isFinite(timestamp) ||
        now.getTime()-timestamp < 0 || now.getTime()-timestamp > MAX_AGE_MS ||
        !cents(row.price_cents) || !text(row.name) ||
        !text(row.retailer_name,90)) continue
    // A future or reversed campaign is not a current discount, even when
    // the product row is fresh and the promotional cents are positive.
    const starts = offerInstantNanos(row.promo_valid_from)
    const ends = offerInstantNanos(row.promo_valid_until)
    const nowNanos = BigInt(now.getTime()) * 1_000_000n
    const hasOffer = cents(row.promo_price_cents) &&
      starts !== undefined && ends !== undefined &&
      (starts === null || starts <= nowNanos) &&
      (ends === null || ends >= nowNanos) &&
      (starts === null || ends === null || starts <= ends)
    const effective = hasOffer && row.promo_price_cents<row.price_cents
      ? row.promo_price_cents : row.price_cents
    if (!cents(effective)) continue
    results.push({
      supermarket:row.retailer_id, supermarketName:row.retailer_name,
      name:row.name,brand:text(row.brand,120)?row.brand:null,
      pack:text(row.pack_text,120)?row.pack_text:null,
      packAmount:row.pack_amount,packUnit:row.pack_unit,packCount:row.pack_count,
      priceCents:effective,regularPriceCents:row.price_cents,
      offer:Boolean(hasOffer && effective<row.price_cents),
      observedAt:row.observed_at,sourceUrl:url,availability:'available',
    })
    if(results.length>=40)break
  }
  return results
}

export async function handleRetailerSearch(requestUrl,{dbPath,policyPath,sourceGatePath='evidence/m1/source-permission-gate.v1.json',now=new Date()}) {
  const parsed = new URL(requestUrl,'http://localhost')
  if(parsed.pathname!=='/api/retailer-products')
    return {status:404,body:{error:'not-found'}}
  const q=queryText(parsed.searchParams.get('q'))
  if(!q)return {status:400,body:{error:'enter-2-to-80-characters'}}
  let approved
  try {approved=await planDailyRefresh({policyPath,sourceGatePath,now})}
  catch {return {status:503,body:{error:'retailer-source-policy-unavailable'}}}
  if(!approved.length)
    return {status:200,body:{results:[],availability:'sources-not-approved',asOf:now.toISOString()}}
  let db
  try {
    db=new DatabaseSync(dbPath,{readOnly:true})
    return {status:200,body:{results:findFreshProducts(db,approved,q,now),
      availability:'fresh-observations-only',asOf:now.toISOString()}}
  }catch {
    return {status:503,body:{error:'retailer-database-unavailable'}}
  }finally {db?.close()}
}
export function startRetailerSearchServer({dbPath,policyPath,sourceGatePath='evidence/m1/source-permission-gate.v1.json',port=4317,host='127.0.0.1'}) {
  if(!dbPath||!policyPath||host!=='127.0.0.1'||!Number.isSafeInteger(port)||
    port<1024||port>65535)throw Error('Safe local retailer API configuration required')
  return createServer(async(req,res)=>{
    if (req.method==='GET' && typeof req.url==='string' &&
        new URL(req.url,'http://localhost').pathname==='/retailer-zoeken') {
      const route=new URL(req.url,'http://localhost')
      const raw=route.searchParams.get('q')??''
      const q=queryText(raw)
      const data=q ? await handleRetailerSearch('/api/retailer-products?q='+
        encodeURIComponent(q),{dbPath,policyPath,sourceGatePath}) :
        {status:200,body:{results:[]}}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8',
        'cache-control':'no-store','x-content-type-options':'nosniff',
        'x-frame-options':'SAMEORIGIN',
        'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'; base-uri 'none'"})
      res.end(renderRetailerSearchHtml(raw,data.body))
      return
    }
    const result=req.method==='GET'&&typeof req.url==='string'
      ?await handleRetailerSearch(req.url,{dbPath,policyPath,sourceGatePath})
      :{status:405,body:{error:'method-not-allowed'}}
    res.writeHead(result.status,{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'})
    res.end(JSON.stringify(result.body))
  }).listen(port,host)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const dbPath=process.env.SUPA_SCRAPER_DB
  const policyPath=process.env.SUPA_SCRAPER_POLICY
  if(!dbPath||!policyPath)throw Error('SUPA_SCRAPER_DB and SUPA_SCRAPER_POLICY required')
  startRetailerSearchServer({dbPath,policyPath,sourceGatePath:process.env.SUPA_SOURCE_PERMISSION_GATE||'evidence/m1/source-permission-gate.v1.json'})
  console.log('SUPA retailer search listening on loopback only')
}
