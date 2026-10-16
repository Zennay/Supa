/**
 * SUPA local search API for its existing nine-retailer SQLite scraper DB.
 * No live retailer fetch; no invented discounts; 24-hour freshness gate.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { adapters } from './adapters/index.mjs'
import { loadReviewedDailyPolicy } from './daily-source-policy.mjs'

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

export function findFreshProducts(database, approvedIds, query, now = new Date()) {
  const q = queryText(query)
  if (!q || !Array.isArray(approvedIds) || approvedIds.length === 0 ||
      approvedIds.length > 12 || !Number.isFinite(now?.getTime?.()) ||
      approvedIds.some(id => !Object.hasOwn(expectedHosts,id))) return []
  const ids = [...new Set(approvedIds)]
  const sql = 'SELECT p.retailer_id, r.name AS retailer_name, p.name, p.brand, ' +
    'p.pack_text, p.pack_amount, p.pack_count, p.pack_unit, p.url, ' +
    'lp.price_cents, lp.promo_price_cents, lp.promo_valid_until, ' +
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
    const hasOffer = cents(row.promo_price_cents) &&
      (!row.promo_valid_until ||
       (Number.isFinite(Date.parse(row.promo_valid_until)) &&
        Date.parse(row.promo_valid_until)>=now.getTime()))
    const effective = hasOffer && row.promo_price_cents<row.price_cents
      ? row.promo_price_cents : row.price_cents
    if (!cents(effective)) continue
    results.push({
      supermarket:row.retailer_id, supermarketName:row.retailer_name,
      name:row.name,brand:text(row.brand,120)?row.brand:null,
      pack:text(row.pack_text,120)?row.pack_text:null,
      priceCents:effective,regularPriceCents:row.price_cents,
      offer:Boolean(hasOffer && effective<row.price_cents),
      observedAt:row.observed_at,sourceUrl:url,availability:'available',
    })
    if(results.length>=40)break
  }
  return results
}

export async function handleRetailerSearch(requestUrl,{dbPath,policyPath,now=new Date()}) {
  const parsed = new URL(requestUrl,'http://localhost')
  if(parsed.pathname!=='/api/retailer-products')
    return {status:404,body:{error:'not-found'}}
  const q=queryText(parsed.searchParams.get('q'))
  if(!q)return {status:400,body:{error:'enter-2-to-80-characters'}}
  let approved
  try {approved=await loadReviewedDailyPolicy(policyPath,now)}
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
export function startRetailerSearchServer({dbPath,policyPath,port=4317,host='127.0.0.1'}) {
  if(!dbPath||!policyPath||host!=='127.0.0.1'||!Number.isSafeInteger(port)||
    port<1024||port>65535)throw Error('Safe local retailer API configuration required')
  return createServer(async(req,res)=>{
    const result=req.method==='GET'&&typeof req.url==='string'
      ?await handleRetailerSearch(req.url,{dbPath,policyPath})
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
  startRetailerSearchServer({dbPath,policyPath})
  console.log('SUPA retailer search listening on loopback only')
}
