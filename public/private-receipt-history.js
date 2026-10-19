'use strict'
// Entirely offline. No imports, requests, browser storage or retailer endpoints.
// Compare exported private receipts; NEVER convert these derived reports to price sources.
const $ = id => document.getElementById(id)
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores = ['PLUS', 'DekaMarkt']
const units = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const controls = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u
const rec = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const safeText = (v, max=250) => typeof v === 'string' && v.trim().length > 0 &&
  v.length <= max && !controls.test(v)
const cents = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const positive = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const decimal = v => typeof v === 'number' && Number.isFinite(v) && v > 0

// Reject impossible civil dates, unsupported offsets and millisecond rounding
// before checking the real physical <=24h pairing of each exported receipt.
function instant(value) {
  if (!safeText(value, 80)) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1,7).map(Number)
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59 || second > 59) return null
  const checked = new Date(Date.UTC(year, month - 1, day))
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month-1 ||
      checked.getUTCDate() !== day) return null
  if (m[8] !== 'Z') {
    const zoneHours = Number(m[8].slice(1,3)), zoneMinutes = Number(m[8].slice(4))
    const valid = m[8][0] === '+' ?
      (zoneHours < 14 || (zoneHours === 14 && zoneMinutes === 0)) :
      (zoneHours < 12 || (zoneHours === 12 && zoneMinutes === 0))
    if (!valid || zoneMinutes > 59) return null
  }
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return null
  const fraction = (m[7] || '').padEnd(9, '0')
  return BigInt(millis) * 1000000n + BigInt(fraction.slice(3) || '0')
}
function product(p) {
  if (!rec(p) || !rec(p.package) ||
      !safeText(p.sourceProductId, 120) || !safeText(p.sourceProductName) ||
      !positive(p.packagesNeeded) || !decimal(p.package.amount) ||
      !units.has(p.package.unit) || !positive(p.package.count) ||
      !cents(p.pricePerPackageCents) || !cents(p.totalWholePackagesCents) ||
      p.packagesNeeded * p.pricePerPackageCents !== p.totalWholePackagesCents) return null
  return {
    id:p.sourceProductId, name:p.sourceProductName,
    packs:p.packagesNeeded, amount:p.package.amount,
    unit:p.package.unit, count:p.package.count,
    total:p.totalWholePackagesCents
  }
}
function readReceipt(raw) {
  if (new TextEncoder().encode(raw).length > 512000) throw Error('Bestand te groot')
  const v = JSON.parse(raw)
  if (!rec(v) || v.kind !== 'supa-private-derived-two-store-week-report' ||
      v.schemaVersion !== 1 || v.currency !== 'EUR' ||
      v.sourceImportable !== false || v.verifiedRetailerObservations !== false ||
      v.publicSavingsClaimEligible !== false || !rec(v.stores) ||
      !rec(v.wholeBasket) || v.wholeBasket.samePhysicalDemand !== true ||
      v.wholeBasket.observedWithin24Hours !== true ||
      !Array.isArray(v.products) || !v.products.length || v.products.length > 200) throw Error('Geen Supa-rapport')
  const dates = {}, totals = {}, rows = new Map()
  for (const store of stores) {
    const ref = v.stores[store]
    if (!rec(ref) || !cents(ref.totalWholePackagesCents)) throw Error('Geen mandtotaal')
    dates[store] = instant(ref.observedAt)
    if (dates[store] === null) throw Error('Ongeldig bronmoment')
    totals[store] = ref.totalWholePackagesCents
  }
  const diff = dates.PLUS > dates.DekaMarkt ? dates.PLUS - dates.DekaMarkt : dates.DekaMarkt - dates.PLUS
  if (diff > 86400000000000n) throw Error('Opnames te ver uiteen')
  const sum = { PLUS:0, DekaMarkt:0 }
  for (const entry of v.products) {
    if (!rec(entry) || !safeText(entry.ingredientId, 120) || !safeText(entry.ingredient) ||
        !rec(entry.demand) || !decimal(entry.demand.amount) || !units.has(entry.demand.unit) ||
        rows.has(entry.ingredientId) || !Number.isSafeInteger(entry.dekaMinusPlusCents)) throw Error('Productregel ongeldig')
    const plus = product(entry.PLUS), deka = product(entry.DekaMarkt)
    if (!plus || !deka || deka.total - plus.total !== entry.dekaMinusPlusCents) throw Error('Prijsregel ongeldig')
    sum.PLUS += plus.total
    sum.DekaMarkt += deka.total
    if (!cents(sum.PLUS) || !cents(sum.DekaMarkt)) throw Error('Onveilig mandtotaal')
    rows.set(entry.ingredientId, {
      id:entry.ingredientId, name:entry.ingredient,
      amount:entry.demand.amount, unit:entry.demand.unit,
      PLUS:plus, DekaMarkt:deka
    })
  }
  if (stores.some(store => sum[store] !== totals[store]) ||
      !cents(v.wholeBasket.absoluteDifferenceCents) ||
      v.wholeBasket.absoluteDifferenceCents !== Math.abs(totals.PLUS - totals.DekaMarkt) ||
      v.wholeBasket.cheapestStore !== (totals.PLUS === totals.DekaMarkt ? null :
        totals.PLUS < totals.DekaMarkt ? 'PLUS' : 'DekaMarkt')) throw Error('Mandtotalen ongeldig')
  return { dates, totals, rows, textDates:{
    PLUS:v.stores.PLUS.observedAt, DekaMarkt:v.stores.DekaMarkt.observedAt
  } }
}
function sameProduct(a,b) {
  return a.id === b.id && a.name === b.name && a.packs === b.packs &&
    a.amount === b.amount && a.unit === b.unit && a.count === b.count
}
function compare(old, fresh) {
  if (fresh.dates.PLUS <= old.dates.PLUS || fresh.dates.DekaMarkt <= old.dates.DekaMarkt)
    throw Error('De tweede opname moet voor beide winkels later zijn dan de eerste.')
  if (old.rows.size !== fresh.rows.size)
    throw Error('De fysieke weekvraag verschilt: aantal ingrediënten ongelijk.')
  const rows = []
  for (const [id, a] of old.rows) {
    const b = fresh.rows.get(id)
    if (!b || a.name !== b.name || a.amount !== b.amount || a.unit !== b.unit)
      throw Error('Een fysiek ingrediënt of benodigde hoeveelheid is veranderd. Geen zuivere prijsontwikkeling.')
    if (!stores.every(store => sameProduct(a[store], b[store])))
      throw Error('Een SKU, productnaam, pakinhoud of pakaantal is veranderd. Dit is geen zuivere prijsontwikkeling.')
    rows.push({
      id, name:a.name, old:a, fresh:b,
      plusChange:b.PLUS.total - a.PLUS.total,
      dekaChange:b.DekaMarkt.total - a.DekaMarkt.total,
    })
  }
  const changes = {
    PLUS:fresh.totals.PLUS - old.totals.PLUS,
    DekaMarkt:fresh.totals.DekaMarkt - old.totals.DekaMarkt,
  }
  if (rows.reduce((s,r)=>s+r.plusChange,0) !== changes.PLUS ||
      rows.reduce((s,r)=>s+r.dekaChange,0) !== changes.DekaMarkt)
    throw Error('Prijswijzigingen sluiten niet op de oorspronkelijke mandtotalen aan.')
  return {changes,rows:rows.sort((a,b)=>
    Math.max(Math.abs(b.plusChange),Math.abs(b.dekaChange)) -
    Math.max(Math.abs(a.plusChange),Math.abs(a.dekaChange)) ||
    a.name.localeCompare(b.name,'nl'))}
}
const el = (tag, text='', className='') => {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}
function movement(amount) {
  if (amount === 0) return 'ongewijzigd'
  return (amount > 0 ? '+' : '−')+euro.format(Math.abs(amount)/100)
}
let localTextExport = null
function render(old,fresh,result) {
  const wrap=$('summary'), body=$('rows')
  wrap.replaceChildren(); body.replaceChildren()
  $('context').textContent =
    'Eerder: PLUS '+old.textDates.PLUS+' en Deka '+old.textDates.DekaMarkt+
    ' · Later: PLUS '+fresh.textDates.PLUS+' en Deka '+fresh.textDates.DekaMarkt
  for (const store of stores) {
    const card=el('article','','notice')
    card.append(el('strong',store),el('p',euro.format(old.totals[store]/100)+' → '+
      euro.format(fresh.totals[store]/100)),el('strong',
      'Historische mandverandering: '+movement(result.changes[store]),
      result.changes[store]>0?'delta-up':result.changes[store]<0?'delta-down':''))
    wrap.append(card)
  }
  for (const line of result.rows) {
    const tr=el('tr')
    const item=el('th',line.name)
    item.scope='row'
    item.append(el('div','SKU PLUS '+line.old.PLUS.id+' · Deka '+line.old.DekaMarkt.id,'small'))
    tr.append(item)
    for (const store of stores) tr.append(el('td',euro.format(line.old[store].total/100)+
      ' → '+euro.format(line.fresh[store].total/100)))
    const delta=el('td')
    delta.append(el('div','PLUS: '+movement(line.plusChange),
      line.plusChange>0?'delta-up':line.plusChange<0?'delta-down':''))
    delta.append(el('div','DekaMarkt: '+movement(line.dekaChange),
      line.dekaChange>0?'delta-up':line.dekaChange<0?'delta-down':''))
    tr.append(delta); body.append(tr)
  }
  localTextExport = [
    'Supa · eigen offline historische PLUS/Deka-prijsvergelijking',
    'Alleen twee eigen afgeleide rapporten; geen actuele prijs of onafhankelijk besparingsbewijs.',
    'PLUS eerste bronmoment: '+old.textDates.PLUS,
    'PLUS tweede bronmoment: '+fresh.textDates.PLUS,
    'DekaMarkt eerste bronmoment: '+old.textDates.DekaMarkt,
    'DekaMarkt tweede bronmoment: '+fresh.textDates.DekaMarkt,
    'PLUS hele-verpakkingenmand: '+euro.format(old.totals.PLUS/100)+' → '+
      euro.format(fresh.totals.PLUS/100)+' ('+movement(result.changes.PLUS)+')',
    'DekaMarkt hele-verpakkingenmand: '+euro.format(old.totals.DekaMarkt/100)+' → '+
      euro.format(fresh.totals.DekaMarkt/100)+' ('+movement(result.changes.DekaMarkt)+')',
    '',
    'Dezelfde fysieke vraag en bronproducten per ingredient:',
    ...result.rows.map(line => line.name+' | PLUS SKU '+line.old.PLUS.id+
      ' | Deka SKU '+line.old.DekaMarkt.id+
      ' | PLUS '+movement(line.plusChange)+
      ' | DekaMarkt '+movement(line.dekaChange)),
    '',
    'Geen actuele kassagarantie, retailerrecht of geverifieerde besparing.'
  ].join('\n')+'\n'
  $('download').disabled=false
  $('result').hidden=false
}
let readSerial=0
$('compare').addEventListener('click',async()=>{
  const serial=++readSerial
  $('result').hidden=true
  localTextExport=null; $('download').disabled=true
  const a=$('old').files?.[0], b=$('new').files?.[0]
  if (!a || !b){$('status').textContent='Kies eerst twee eigen JSON-rapporten.';return}
  if (!a.size || !b.size || a.size>512000 || b.size>512000){
    $('status').textContent='Elk rapport moet gevuld zijn en maximaal 512 kB groot.';return}
  $('compare').disabled=true
  try {
    const raws=await Promise.all([a.text(),b.text()])
    if(serial!==readSerial)return
    const old=readReceipt(raws[0]), fresh=readReceipt(raws[1])
    const result=compare(old,fresh)
    render(old,fresh,result)
    $('status').textContent='Twee historische privérapporten voor exact dezelfde producten vergeleken. Geen actuele prijsclaim.'
  }catch{
    if(serial===readSerial)$('status').textContent=
      'Deze rapporten zijn niet veilig vergelijkbaar. Controleer volgorde, bronmomenten, fysieke ingrediënten, SKU’s, verpakkingen en bedragen. De oorspronkelijke bestanden blijven intact.'
  }finally{if(serial===readSerial)$('compare').disabled=false}
})
$('download').addEventListener('click',()=>{
  if (localTextExport === null) return
  const blob=new Blob([localTextExport],{type:'text/plain;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  try {
    const link=document.createElement('a')
    link.href=url
    link.download='supa-eigen-historische-prijsvergelijking.txt'
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally { window.setTimeout(()=>URL.revokeObjectURL(url),1000) }
})
$('clear').addEventListener('click',()=>{
  ++readSerial
  localTextExport=null; $('download').disabled=true
  $('old').value=''; $('new').value=''
  $('rows').replaceChildren(); $('summary').replaceChildren()
  $('context').textContent=''; $('status').textContent='Gegevens uit dit tabblad gewist.'
  $('result').hidden=true; $('compare').disabled=false
})
