'use strict'
// Entirely offline. No imports, requests, browser storage or retailer endpoints.
// Compare exported private receipts; NEVER convert these derived reports to price sources.
const $ = id => document.getElementById(id)
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores = ['PLUS', 'DekaMarkt']
const safeMismatchMessages = new Set([
  'De tweede opname moet voor beide winkels later zijn dan de eerste.',
  'De fysieke weekvraag verschilt: aantal ingrediënten ongelijk.',
  'Een fysiek ingrediënt of benodigde hoeveelheid is veranderd. Geen zuivere prijsontwikkeling.',
  'Een SKU, productnaam, pakinhoud of pakaantal is veranderd. Dit is geen zuivere prijsontwikkeling.',
  'Prijswijzigingen sluiten niet op de oorspronkelijke mandtotalen aan.'
])
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
  const rows=[], excluded=[]
  for (const [id, a] of old.rows) {
    const b=fresh.rows.get(id)
    const base={id, name:a.name}
    if (!b || a.name!==b.name || a.amount!==b.amount || a.unit!==b.unit) {
      excluded.push({...base, reason:'Ingrediënt of fysieke hoeveelheid gewijzigd/ontbreekt'})
      continue
    }
    if (!stores.every(store=>sameProduct(a[store],b[store]))) {
      excluded.push({...base, reason:'SKU, productnaam, verpakking of pakaantal gewijzigd'})
      continue
    }
    rows.push({id,name:a.name,old:a,fresh:b,
      plusChange:b.PLUS.total-a.PLUS.total,
      dekaChange:b.DekaMarkt.total-a.DekaMarkt.total})
  }
  for (const [id,b] of fresh.rows) if (!old.rows.has(id))
    excluded.push({id,name:b.name,reason:'Extra ingrediënt in latere opname'})
  const complete=excluded.length===0 && rows.length===old.rows.size && rows.length===fresh.rows.size
  const subsetOld={PLUS:0,DekaMarkt:0},subsetNew={PLUS:0,DekaMarkt:0}
  for (const row of rows) for(const store of stores) {
    subsetOld[store]+=row.old[store].total
    subsetNew[store]+=row.fresh[store].total
    if (!cents(subsetOld[store]) || !cents(subsetNew[store]))
      throw Error('Som van productregels is ongeldig')
  }
  const changes={PLUS:subsetNew.PLUS-subsetOld.PLUS,
    DekaMarkt:subsetNew.DekaMarkt-subsetOld.DekaMarkt}
  if (complete && stores.some(store=>
      subsetOld[store]!==old.totals[store] || subsetNew[store]!==fresh.totals[store]))
    throw Error('Prijswijzigingen sluiten niet op de oorspronkelijke mandtotalen aan.')
  rows.sort((a,b)=>Math.max(Math.abs(b.plusChange),Math.abs(b.dekaChange))-
    Math.max(Math.abs(a.plusChange),Math.abs(a.dekaChange)) || a.name.localeCompare(b.name,'nl'))
  return {complete,rows,excluded,subsetOld,subsetNew,changes}
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
  const scope=result.complete
    ? 'Alle '+result.rows.length+' identieke fysieke producten: volledige mandjes vergelijkbaar.'
    : 'Alleen '+result.rows.length+' ongewijzigde van '+(result.rows.length+result.excluded.length)+
      ' productregels vergelijkbaar. '+result.excluded.length+
      ' gewijzigd of ontbrekend; volledig mandverschil ONBEKEND.'
  wrap.append(el('p',scope,result.complete?'hint':'notice'))
  for (const store of stores) {
    const card=el('article','','notice')
    card.append(el('strong',store),el('p',
      euro.format(result.subsetOld[store]/100)+' → '+
      euro.format(result.subsetNew[store]/100)),
      el('small',result.complete ? 'Gehele identieke winkelmand' :
        'Uitsluitend onveranderde SKU’s met exact gelijke fysieke hoeveelheden','small'),
      el('p',result.complete?'Verandering volledige eigen mand: '+
        movement(result.changes[store]) :
        'Verschil alleen voor vergelijkbare regels: '+movement(result.changes[store]),
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
  if (result.excluded.length) {
    const title=el('tr')
    const label=el('th','Niet onderling vergelijkbare artikelen')
    label.colSpan=4; title.append(label); body.append(title)
    for (const item of result.excluded) {
      const tr=el('tr')
      const name=el('th',item.name); name.scope='row'
      const why=el('td',item.reason); why.colSpan=3
      tr.append(name,why); body.append(tr)
    }
  }
  localTextExport = [
    'Supa · eigen offline historische PLUS/Deka-prijsvergelijking',
    'Alleen twee eigen afgeleide rapporten; geen actuele prijs of onafhankelijk besparingsbewijs.',
    'PLUS eerste bronmoment: '+old.textDates.PLUS,
    'PLUS tweede bronmoment: '+fresh.textDates.PLUS,
    'DekaMarkt eerste bronmoment: '+old.textDates.DekaMarkt,
    'DekaMarkt tweede bronmoment: '+fresh.textDates.DekaMarkt,
    result.complete ? 'Volledige fysieke mandvergelijking: JA' :
      'Volledige fysieke mandvergelijking: NEE — totaalverschil ONBEKEND.',
    'Gelijke fysieke producten: '+result.rows.length,
    'Gewijzigd/ontbrekend/extra: '+result.excluded.length,
    'PLUS '+(result.complete?'hele mand':'uitsluitend gelijke SKU-regels')+': '+
      euro.format(result.subsetOld.PLUS/100)+' → '+
      euro.format(result.subsetNew.PLUS/100)+' ('+movement(result.changes.PLUS)+')',
    'DekaMarkt '+(result.complete?'hele mand':'uitsluitend gelijke SKU-regels')+': '+
      euro.format(result.subsetOld.DekaMarkt/100)+' → '+
      euro.format(result.subsetNew.DekaMarkt/100)+' ('+movement(result.changes.DekaMarkt)+')',
    '',
    'Vergelijkbare identieke fysieke vraag en bronproducten per ingredient:',
    ...result.rows.map(line => line.name+' | PLUS SKU '+line.old.PLUS.id+
      ' | Deka SKU '+line.old.DekaMarkt.id+
      ' | PLUS '+movement(line.plusChange)+
      ' | DekaMarkt '+movement(line.dekaChange)),
    '',
    'Niet vergelijkbare regels — uitgesloten van alle getoonde wijzigingen:',
    ...result.excluded.map(line=>line.name+' | '+line.reason),
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
  $('summary').replaceChildren(); $('rows').replaceChildren()
  $('context').textContent=''
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
    $('status').textContent=result.complete
      ? 'Volledige historisch identieke privémandjes vergeleken. Geen actuele prijsclaim.'
      : result.rows.length+' onveranderde productregels vergeleken; '+
        result.excluded.length+' gewijzigd/ontbrekend uitgesloten. Volledig mandverschil onbekend.'
  }catch(error){
    if(serial===readSerial){
      const detail = error instanceof Error && safeMismatchMessages.has(error.message)
        ? error.message + ' Je kunt alleen een nieuw rapport vergelijken met exact dezelfde producten.'
        : 'Minstens één lokaal JSON-rapport heeft ongeldige of onvolledige brongegevens. Controleer originele SKU’s, bronmomenten, hele centen en de twee mandtotalen.'
      $('status').textContent=detail+' De oorspronkelijke bestanden blijven intact en niets geldt als actuele prijsbron.'
    }
  }finally{if(serial===readSerial)$('compare').disabled=false}
})
// Choosing a different local file invalidates all previously displayed
// figures AND any in-flight read. A late File.text() completion cannot restore
// an old price document after the picker now shows another file.
for (const id of ['old','new']) $(id).addEventListener('change',()=>{
  ++readSerial
  localTextExport=null; $('download').disabled=true
  $('compare').disabled=false
  $('result').hidden=true
  $('summary').replaceChildren(); $('rows').replaceChildren()
  $('context').textContent=''
  $('status').textContent='Bestand gewijzigd. Kies opnieuw Vergelijk om de nieuwe bronrapporten te lezen.'
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
