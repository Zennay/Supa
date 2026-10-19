/* Supa private basket mapping: local, explicit user selection; not a retailer scraper.
 * Source admission delegates to the existing canonical offline CSV converter.
 * No storage, remote requests, inferred product equivalence or monetary computation.
 */
import { convertOwnStoreCsv } from './offline-two-store-csv.mjs'

const stores = ['PLUS', 'DekaMarkt']
const units = ['g', 'kg', 'ml', 'l', 'piece']
const maxBytes = 256000
const sourceInput = document.querySelector('#source')
const plusInput = document.querySelector('#plus-source')
const dekaInput = document.querySelector('#deka-source')
let sourceRevision = 0
let pendingManualEdit = false
const sourceStatus = document.querySelector('#source-status')
const editSource = document.querySelector('#edit-owned-source')
const downloadAdmittedSources = document.querySelector('#download-admitted-sources')
const status = document.querySelector('#status')
const lines = document.querySelector('#lines')
const coverage = document.querySelector('#match-coverage')
const mealCount = document.querySelector('#meal-count')
const demandImport = document.querySelector('#demand-import')
const maxLines = 200
const save = document.querySelector('#save')
const saveSession = document.querySelector('#save-session')
const restoreSession = document.querySelector('#restore-session')
const downloadUnpriced = document.querySelector('#download-unpriced')
const showUnpriced = document.querySelector('#show-unpriced')
const unpricedTrip = document.querySelector('#unpriced-trip')
const unpricedItems = document.querySelector('#unpriced-items')
const unpricedProgress = document.querySelector('#unpriced-progress')
const unpricedChecked = new Set()
let unpricedSnapshot = null
const compareNow = document.querySelector('#compare-now')
const priceResult = document.querySelector('#result')
const priceStatus = document.querySelector('#price-status')
const add = document.querySelector('#add')
let captures = null
let nextId = 1

const classify = (unit) => ['g', 'kg'].includes(unit) ? 'weight'
  : ['ml', 'l'].includes(unit) ? 'volume' : unit === 'piece' ? 'count' : null

const own = (data, key) => data !== null && typeof data === 'object' &&
  Object.hasOwn(data, key) ? data[key] : undefined

const validText = (value, max = 160) => typeof value === 'string' &&
  value.length > 0 && value.length <= max && value.trim() === value &&
  /[\p{L}\p{N}]/u.test(value) && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
  !/^[=+@-]/u.test(value)
const numeric = (text) => {
  if (!/^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/.test(text)) return null
  const number = Number(text.replace(',', '.'))
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null
}
function validSourceInstant(value) {
  if (typeof value !== 'string') return false
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?([+-])(\d\d):(\d\d)$/.exec(value)
  if (!m) return false
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] =
    [m[1], m[2], m[3], m[4], m[5], m[6], m[8], m[9]].map(Number)
  if (year < 2000 || year > 2100 || zoneMinute > 59 ||
      (m[7] === '+' ? zoneHour > 14 || (zoneHour === 14 && zoneMinute !== 0)
        : zoneHour > 12 || (zoneHour === 12 && zoneMinute !== 0))) return false
  const civil = new Date(0)
  civil.setUTCFullYear(year, month - 1, day)
  civil.setUTCHours(hour, minute, second, 0)
  return civil.getUTCFullYear() === year && civil.getUTCMonth() === month - 1 &&
    civil.getUTCDate() === day && civil.getUTCHours() === hour &&
    civil.getUTCMinutes() === minute && civil.getUTCSeconds() === second &&
    Number.isFinite(Date.parse(value))
}

const node = (tag, attrs = {}, value) => {
  const el = document.createElement(tag)
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') el.className = val
    else if (key === 'type' || key === 'min' || key === 'max' ||
             key === 'step' || key === 'id' || key === 'placeholder') el.setAttribute(key, val)
  }
  if (value !== undefined) el.textContent = value
  return el
}
const field = (parent, caption, input) => {
  const label = node('label', {}, caption)
  label.append(input)
  parent.append(label)
  return input
}
const notice = (element, message, kind = '') => {
  element.textContent = message
  element.className = 'notice' + (kind ? ' ' + kind : '')
}
const selected = (select) => select.value === '' ? null : select.value

const ownEuro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
function observedPackDescription(product) {
  if (!product || product.priceCents === null || !Number.isSafeInteger(product.priceCents) ||
      !Number.isFinite(product.packAmount) || product.packAmount <= 0 ||
      !Number.isSafeInteger(product.packCount) || product.packCount < 1) return ''
  const count = product.packCount
  const baseAmount = product.packAmount * count *
    (product.packUnit === 'kg' || product.packUnit === 'l' ? 1000 : 1)
  const family = ['g', 'kg'].includes(product.packUnit) ? 'kg'
    : ['ml', 'l'].includes(product.packUnit) ? 'liter' : 'stuk'
  const multiplier = family === 'stuk' ? 1 : 1000
  const advisory = product.priceCents / 100 * multiplier / baseAmount
  return ownEuro.format(product.priceCents / 100) + ' per verpakking' +
    (Number.isFinite(advisory) && advisory >= 0 ?
      ' · indicatief ' + ownEuro.format(advisory) + '/' + family : '')
}

// Selection records a human-confirmed product identity, not its purchasability.
function observedProducts(store, unit) {
  const capture = captures?.[store]
  if (!capture) return []
  return capture.products.filter(product => classify(product.packUnit) === classify(unit))
}

function availableProducts(store, unit) {
  const capture = captures?.[store]
  if (!capture) return []
  return capture.products.filter(product => product.available &&
    product.priceCents !== null && product.packAmount !== null &&
    classify(product.packUnit) === classify(unit))
}

function updateCoverage() {
  const rows = Array.from(lines.querySelectorAll('.ingredient'))
  if (!rows.length) {
    coverage.textContent = 'Nog geen ingrediënten in de fysieke mandvraag.'
    return
  }
  if (!captures) {
    coverage.textContent = rows.length + ' fysieke ingrediëntregels zonder toegelaten eigen winkelopnames. ' +
      'De ongeprijsde lijst blijft beschikbaar; geen supermarktbedragen bekend.'
    coverage.className = 'notice warning'
    return
  }
  const messages = stores.map(store => {
    const countBySku = new Map()
    for (const row of rows) {
      const id = row.querySelector('[data-store="' + store + '"]').value
      if (id) countBySku.set(id, (countBySku.get(id) ?? 0) + 1)
    }
    let ready = 0
    let duplicated = 0
    let knownButUnpriced = 0
    for (const row of rows) {
      const sku = row.querySelector('[data-store="' + store + '"]').value
      if (!sku) continue
      if (countBySku.get(sku) > 1) { duplicated++; continue }
      const input = row.querySelector('.amount').value.trim()
      const amount = input === '' ? null : numeric(input)
      const unit = row.querySelector('.unit').value
      if (amount !== null && validText(row.querySelector('.label').value.trim())) {
        if (availableProducts(store, unit).some(p => p.id === sku)) ready++
        else if (observedProducts(store, unit).some(p => p.id === sku)) knownButUnpriced++
      }
    }
    return store + ': ' + ready + ' van ' + rows.length +
      ' fysieke regels met uniek gekozen, prijsbaar eigen product' +
      (knownButUnpriced ? ' · ' + knownButUnpriced +
        ' gekoppeld maar niet prijsbaar/beschikbaar' : '') +
      (duplicated ? ' · ' + duplicated + ' regels met dubbel gekozen SKU' : '')
  })
  const now = Date.now()
  const observed = stores.map(store => captures[store] ? Date.parse(captures[store].observedAt) : null)
  const ages = observed.map(time => time === null ? null : now - time)
  const fresh = ages.every(age => age !== null && Number.isFinite(age) && age >= 0 && age <= 7 * 86400000)
  const paired = observed.every(time => time !== null) &&
    Math.abs(observed[0] - observed[1]) <= 86400000
  const complete = messages.every(value => value.includes(' ' + rows.length + ' van ' + rows.length))
  const expiry = Math.min(...observed.filter(time => time !== null)) + 7 * 86400000
  const timeStatus = observed.some(time => time === null) ?
    'Voor één winkel ontbreekt een echte bronopname. Die winkel blijft onbekend; geen volledige twee-winkelvergelijking. ' :
    !fresh ? 'Eén of beide bronopnames zijn toekomstig of ouder dan zeven dagen. ' :
    !paired ? 'De twee bronmomenten liggen meer dan 24 uur uit elkaar. ' :
      'Beide bronmomenten zijn binnen zeven dagen en maximaal 24 uur uiteen. '
  coverage.className = 'notice' + (!complete || !fresh || !paired ? ' warning' : '')
  coverage.textContent = messages.join(' · ') + '. ' + timeStatus +
    (fresh && paired ? 'Bronpaar geldig tot uiterlijk ' +
      new Date(expiry).toLocaleString('nl-NL') + ' volgens de oorspronkelijke waarnemingen. ' : '') +
    'Alleen een complete, opnieuw berekende privévergelijking stelt de winkelbedragen vast. Onbekende of verlopen prijzen zijn nooit €0.'
}

function suggestHumanReviewedSku(row, unit, candidates) {
  const label = row.querySelector('.label').value.trim()
  if (!validText(label)) return null
  const tokens = label.toLocaleLowerCase('nl').split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 2).slice(0, 8)
  if (!tokens.length) return null
  // Suggestions are explicitly nonbinding; cap local scoring on older phones.
  const scoped = candidates.filter(product =>
    tokens.some(word => product.name.toLocaleLowerCase('nl').includes(word))).slice(0, 150)
  if (!scoped.length) return null
  const rawAmount = row.querySelector('.amount').value.trim()
  const amount = rawAmount === '' ? null : numeric(rawAmount)
  if (rawAmount && amount === null) return null
  const hint = {
    requirement: { id: row.dataset.id, query: label, amount, unit },
    candidates: scoped,
    decision: null,
  }
  document.dispatchEvent(new CustomEvent('supa:private-match-hint', { detail: hint }))
  return hint.decision?.type === 'match' ? hint.decision : null
}

function updateSelect(select, store, unit) {
  const row = select.closest('.ingredient')
  const search = row.querySelector('[data-search-store="' + store + '"]')
  const query = search.value.trim().toLocaleLowerCase('nl')
  const chosen = select.value
  const all = observedProducts(store, unit)
  const kept = all.find(product => product.id === chosen)
  const filtered = all.filter(product => !query ||
    product.name.toLocaleLowerCase('nl').includes(query) ||
    product.id.toLocaleLowerCase('nl').includes(query))
  const advice = query ? null : suggestHumanReviewedSku(row, unit, availableProducts(store, unit))
  const shown = filtered.slice(0, 80)
  if (!query && advice) {
    const suggested = filtered.find(product => product.id === advice.productId)
    if (suggested) {
      const index = shown.findIndex(product => product.id === suggested.id)
      if (index >= 0) shown.splice(index, 1)
      shown.unshift(suggested)
    }
  }
  if (kept && !shown.some(product => product.id === kept.id)) shown.unshift(kept)
  select.replaceChildren(new Option('Niet gekoppeld · onbekend', ''))
  for (const product of shown) {
    const pack = product.packAmount === null ? 'verpakking onbekend'
      : String(product.packAmount).replace('.', ',') + ' ' + product.packUnit
    const state = !product.available ? ' · niet leverbaar'
      : product.priceCents === null || product.packAmount === null
        ? ' · prijs/verpakking onbekend' : ''
    const option = new Option(product.name + ' · ' + pack + ' · ID ' + product.id + state, product.id)
    select.add(option)
  }
  select.value = kept ? kept.id : ''
  const chosenProduct = all.find(product => product.id === select.value)
  row.querySelector('[data-matches-store="' + store + '"]').textContent =
    String(filtered.length) + ' waargenomen eigen bronartikelen met compatibele eenheidsfamilie; ' +
    (filtered.length > 80 ? 'maximaal 80 zichtbaar, verfijn jouw zoekterm. ' : '') +
    (advice ? 'Suggestie van Supa op basis van naam en verpakking: SKU ' +
      advice.productId + ' (score ' + advice.score +
      '), bewust niet automatisch gekozen. ' : '') +
    (chosenProduct
      ? 'Gekozen SKU ' + chosenProduct.id + ': ' +
        (!chosenProduct.available ? 'niet leverbaar; niet in winkelmandprijs' :
          chosenProduct.priceCents === null || chosenProduct.packAmount === null
            ? 'prijs of verpakking ontbreekt; blijft onbekend'
            : observedPackDescription(chosenProduct)) +
        '. Controleer zelf de echte productnaam, voorraad en verpakking.'
      : 'Kies expliciet de juiste winkel-SKU; geen automatische productmatch.')
}
function invalidateUnpricedDemand() {
  unpricedTrip.hidden = true
  unpricedChecked.clear()
  unpricedSnapshot = null
}
function invalidatePrice() {
  // Revoke old same-tab source/price snapshots as soon as physical demand or
  // human SKU selection changes; an old expiry timer must not revive them.
  document.dispatchEvent(new Event('supa:private-basket-invalidated'))
  if (priceResult) priceResult.hidden = true
  if (priceStatus) {
    priceStatus.textContent = 'De bron of mandvraag is veranderd. Vergelijk opnieuw voor een betrouwbaar privéresultaat.'
    priceStatus.className = 'notice'
  }
}
function clearSourceMatches() {
  // An equal SKU string from a new capture does not guarantee the same
  // product identity, contents, availability or price. Explicitly re-review.
  for (const select of lines.querySelectorAll('[data-store]')) select.value = ''
}
function refresh() {
  invalidatePrice()
  for (const row of lines.querySelectorAll('.ingredient')) {
    const unit = row.querySelector('.unit').value
    for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit)
  }
  save.disabled = !lines.children.length
  downloadUnpriced.disabled = save.disabled
  saveSession.disabled = save.disabled || !captures || pendingManualEdit
  showUnpriced.disabled = save.disabled
  compareNow.disabled = !captures || save.disabled || pendingManualEdit
  editSource.disabled = !captures
  downloadAdmittedSources.disabled = !captures || pendingManualEdit
  updateCoverage()
}
function addIngredient(restored = null) {
  if (lines.children.length >= maxLines) return
  const existing = new Set(Array.from(lines.children, row => row.dataset.id))
  let id
  if (restored !== null) {
    id = restored.id
    if (existing.has(id)) return
  } else {
    do { id = 'ingredient-' + nextId++ } while (existing.has(id))
  }
  const row = node('div', { className: 'ingredient' })
  row.dataset.id = id
  const heading = node('strong', {}, 'Ingrediënt ' + (lines.children.length + 1))
  const grid = node('div', { className: 'grid' })
  const label = node('input', { type: 'text', placeholder: 'Bijv. rijst' })
  label.maxLength = 160
  label.className = 'label'
  if (restored !== null) label.value = restored.label
  const amount = node('input', { type: 'text', placeholder: 'bijv. 500' })
  amount.maxLength = 24
  amount.className = 'amount'
  if (restored !== null && restored.amount !== null) amount.value = String(restored.amount)
  const unit = node('select')
  unit.className = 'unit'
  for (const item of units) unit.add(new Option(item === 'piece' ? 'stuk (piece)' : item, item))
  if (restored !== null) unit.value = restored.unit
  unit.addEventListener('change', () => {
    for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit.value)
  })
  field(grid, 'Ingrediëntnaam', label)
  field(grid, 'Hoeveelheid (leeg = onbekend)', amount)
  field(grid, 'Eenheid', unit)
  const storesGrid = node('div', { className: 'stores' })
  for (const store of stores) {
    const box = node('div')
    const filter = node('input', { type: 'search', placeholder: 'Zoek productnaam of artikel-ID' })
    filter.dataset.searchStore = store
    filter.maxLength = 160
    field(box, 'Zoek in eigen ' + store + '-producten', filter)
    const select = node('select')
    select.dataset.store = store
    select.setAttribute('aria-label', 'Gekozen ' + store + '-product voor ' + id)
    field(box, store + ' · expliciete productkeuze', select)
    const count = node('small')
    count.dataset.matchesStore = store
    box.append(count)
    storesGrid.append(box)
    filter.addEventListener('input', () => updateSelect(select, store, unit.value))
    select.addEventListener('change', () => {
      updateSelect(select, store, unit.value)
      updateCoverage()
    })
  }
  const actions = node('div', { className: 'row-actions' })
  const markLabel = node('label', {}, 'Selecteer om handmatig samen te voegen')
  const mark = node('input', { type: 'checkbox' })
  mark.dataset.mergeSelected = '1'
  mark.style.width = 'auto'
  mark.style.marginInlineEnd = '8px'
  markLabel.prepend(mark)
  actions.append(markLabel)
  const remove = node('button', { type: 'button', className: 'secondary' }, 'Verwijder ingrediënt')
  remove.addEventListener('click', () => { row.remove(); invalidateUnpricedDemand(); refresh() })
  actions.append(remove)
  row.append(heading, grid, storesGrid, actions)
  lines.append(row)
  for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit.value)
  save.disabled = false
  downloadUnpriced.disabled = false
  saveSession.disabled = !captures
  showUnpriced.disabled = false
  compareNow.disabled = !captures
  invalidateUnpricedDemand()
  invalidatePrice()
  updateCoverage()
}

downloadAdmittedSources.addEventListener('click', () => {
  if (!captures || pendingManualEdit) {
    notice(sourceStatus, 'Bevestig of annuleer eerst het handmatige concept; alleen toegelaten echte winkelopnames zijn exporteerbaar.', 'warning')
    return
  }
  try {
    const originalCaptures = stores.filter(store => captures[store]).map(store => captures[store])
    const admitted = {
      schema: originalCaptures.length === 2
        ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
      captures: originalCaptures,
    }
    // Run the same strict local source boundary used on import, not a
    // permissive serialization of draft rows or invented extra retailers.
    const verified = acceptJson(admitted)
    if (Object.keys(verified).length !== originalCaptures.length) {
      throw Error('Niet alle originele eigen winkelopnames zijn controleerbaar.')
    }
    const content = JSON.stringify(admitted, null, 2) + '\n'
    if (new TextEncoder().encode(content).length > maxBytes) {
      throw Error('Deze lokale bronbackup overschrijdt de 256 KB-limiet; bewaar je eigen originele CSV-bestanden.')
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
    const link = node('a')
    link.href = url
    link.download = 'supa-alle-eigen-winkelopnames.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    notice(sourceStatus, originalCaptures.map(item => item.retailer).join(' + ') +
      ': alle werkelijk geaccepteerde eigen bronopnames lokaal aangeboden als één JSON. ' +
      'Inclusief originele SKU’s, centprijzen en UTC-tijdstippen; geen publiek retailerrecht of kassagarantie.')
  } catch (error) {
    notice(sourceStatus, error instanceof Error ? error.message :
      'De lokale originele winkelbronnen konden niet veilig worden bewaard.', 'error')
  }
})

editSource.addEventListener('click', () => {
  if (!captures) return
  if (!window.confirm('Bewerk je al geopende eigen PLUS/Deka-opnames? Bestaande handmatige conceptregels worden vervangen en huidige productmatches gewist. Opnametijden blijven de originele tijdstippen: vul uitsluitend na echte hercontrole nieuwe prijs of opnametijd in.')) return
  document.dispatchEvent(new CustomEvent('supa:manual-prefill-own-source', {
    detail: { captures: stores.filter(store => captures[store]).map(store => captures[store]) },
  }))
})

function acceptJson(json) {
  if (!json || Array.isArray(json) || !Array.isArray(json.captures) ||
      !(json.schema === 'supa-offline-prices-v1' && json.captures.length === 2 ||
        json.schema === 'supa-private-single-store-prices-v1' && json.captures.length === 1)) {
    throw Error('Bestand heeft niet het bestaande Supa-prijsbronformaat.')
  }
  const result = Object.create(null)
  for (const capture of json.captures) {
    if (!capture || typeof capture !== 'object' ||
        !stores.includes(capture.retailer) || result[capture.retailer] ||
        !Array.isArray(capture.products) || !capture.products.length || capture.products.length > 1000 ||
        !validSourceInstant(capture.observedAt)) {
      throw Error('Ongeldige winkelopname; controleer winkel en tijd.')
    }
    const used = new Set()
    for (const p of capture.products) {
      if (!p || !validText(own(p,'id'), 100) || !validText(own(p,'name')) ||
          used.has(p.id) || !units.includes(p.packUnit) ||
          (p.packAmount !== null && (!Number.isFinite(p.packAmount) || p.packAmount <= 0 || p.packAmount > 100000)) ||
          (p.packCount !== undefined && (!Number.isSafeInteger(p.packCount) || p.packCount < 1 || p.packCount > 1000)) ||
          (p.priceCents !== null && (!Number.isSafeInteger(p.priceCents) || p.priceCents < 0 || p.priceCents > 1000000)) ||
          typeof p.available !== 'boolean' ||
          (p.available && (p.packAmount === null || p.priceCents === null || !Number.isSafeInteger(p.packCount)))) {
        throw Error('Ongeldige of dubbele winkelartikelgegevens.')
      }
      used.add(p.id)
    }
    result[capture.retailer] = capture
  }
  if (Object.keys(result).length !== json.captures.length) throw Error('Dubbele of ontbrekende winkelopnames.')
  return result
}

async function readLocalFile(file) {
  if (!file || !file.size || file.size > maxBytes) {
    throw Error('Ieder bronbestand moet tussen 1 en 256.000 bytes groot zijn.')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
}

async function loadSources() {
  const revision = ++sourceRevision
  // Keep the last admitted source and manual choices during a new file read;
  // old prices are immediately hidden until this explicit import is resolved.
  invalidatePrice()
  compareNow.disabled = true
  const combined = sourceInput.files?.[0]
  const plus = plusInput.files?.[0]
  const deka = dekaInput.files?.[0]
  if (!combined && !plus && !deka) {
    notice(sourceStatus, captures ? 'Geen nieuw bestand gekozen; eerdere eigen bron blijft bewaard.' : 'Nog geen bronbestand gekozen.')
    refresh()
    return
  }
  try {
    let parsed
    if (combined) {
      const content = await readLocalFile(combined)
      parsed = combined.name.toLowerCase().endsWith('.json') || content.trimStart().startsWith('{')
        ? JSON.parse(content) : JSON.parse(convertOwnStoreCsv(content))
    } else if (plus && deka) {
      const [plusText, dekaText] = await Promise.all([readLocalFile(plus), readLocalFile(deka)])
      // Each real shop file passes the existing strict spreadsheet converter.
      // Different separator conventions no longer corrupt or block the pair.
      const first = JSON.parse(convertOwnStoreCsv(plusText))
      const second = JSON.parse(convertOwnStoreCsv(dekaText))
      if (first.captures.length !== 1 || second.captures.length !== 1 ||
          first.captures[0].retailer === second.captures[0].retailer) {
        throw Error('Selecteer één echte PLUS- en één DekaMarkt-opname.')
      }
      parsed = { schema: 'supa-offline-prices-v1',
        captures: [...first.captures, ...second.captures] }
      if (new TextEncoder().encode(JSON.stringify(parsed)).length > maxBytes)
        throw Error('De twee winkelbronnen samen overschrijden 256 kB.')
    } else {
      parsed = JSON.parse(convertOwnStoreCsv(await readLocalFile(plus ?? deka)))
    }
    let verified = acceptJson(parsed)
    if (revision !== sourceRevision) return
    // A second *real* one-shop file can be explicitly joined to the first
    // previously admitted one-shop capture, without fabricating provenance.
    // This is only possible for disjoint shops; overlapping input replaces.
    const append = captures && stores.filter(store => captures[store]).length === 1 &&
      stores.filter(store => verified[store]).length === 1 &&
      stores.every(store => !captures[store] || !verified[store])
    if (append) verified = acceptJson({
      schema: 'supa-offline-prices-v1',
      captures: stores.map(store => verified[store] ?? captures[store]),
    })
    if (captures && JSON.stringify(verified) === JSON.stringify(captures)) {
      pendingManualEdit = false
      notice(sourceStatus, 'Exact dezelfde eigen bron opnieuw geopend. Productkeuzes blijven behouden; vergelijk zelf opnieuw.')
      refresh()
      return
    }
    if (captures && !window.confirm((append
      ? 'Voeg deze tweede echt ingelezen winkelopname samen met je eerdere originele bron? '
      : 'Vervang de vorige winkelbronnen door deze nieuwe gevalideerde opname(n)? ') +
        'Alleen SKU-keuzes uit letterlijk ongewijzigde bestaande winkelopnames blijven bewaard. ' +
        'Nieuwe of gewijzigde winkels moeten opnieuw handmatig gekoppeld worden.')) {
      sourceInput.value = ''
      plusInput.value = ''
      dekaInput.value = ''
      notice(sourceStatus, 'Bronvervanging geannuleerd. Vorige bron en productkeuzes zijn bewaard; bereken opnieuw indien gewenst.')
      refresh()
      return
    }
    // Preserve previously human-confirmed SKU IDs only when their entire
    // original retailer capture (products AND observedAt) is byte-for-byte
    // equivalent after strict admission. Never carry over a selection against
    // an updated name, package, time, price or different store.
    const unchanged = stores.filter(store => captures?.[store] && verified[store] &&
      JSON.stringify(captures[store]) === JSON.stringify(verified[store]))
    const kept = Array.from(lines.querySelectorAll('.ingredient')).map(row => ({
      row, selected: Object.fromEntries(unchanged.map(store => [store,
        row.querySelector('[data-store="' + store + '"]').value])),
    }))
    clearSourceMatches()
    captures = verified
    pendingManualEdit = false
    for (const item of kept) for (const store of unchanged) {
      const sku = item.selected[store]
      if (sku) item.row.querySelector('[data-store="' + store + '"]').value = sku
    }
    const now = Date.now()
    const descriptions = stores.map(store => {
      const capture = captures[store]
      if (!capture) return store + ': nog geen bronopname; alle prijzen onbekend'
      const ageMs = now - Date.parse(capture.observedAt)
      const stale = ageMs < 0 ? ' · toekomstig' :
        ageMs > 7 * 86400000 ? ' · ouder dan 7 dagen' : ''
      return store + ': ' + capture.products.length + ' producten, vastgelegd ' +
        capture.observedAt + stale
    })
    const gap = captures.PLUS && captures.DekaMarkt
      ? Math.abs(Date.parse(captures.PLUS.observedAt) - Date.parse(captures.DekaMarkt.observedAt)) : null
    if (gap === null) descriptions.push('Voor een volledig winkelprijsverschil is nog een echte tweede winkelopname nodig.')
    else if (gap > 86400000) descriptions.push('Opnames >24 uur uiteen. Opnieuw meten voor een volledige vergelijking.')
    if (append) descriptions.push('De twee afzonderlijk echt ingelezen winkelopnames zijn na jouw bevestiging lokaal gecombineerd.')
    descriptions.push(unchanged.length ? 'Eerder handmatig gekoppelde SKU’s zijn uitsluitend bij ongewijzigde originele winkelopname(n) behouden.' : 'Alle productkeuzes moeten opnieuw bevestigd worden.')
    descriptions.push('Selecteer uitsluitend door jou gecontroleerde matches. Geen automatische bronrechten of besparing.')
    const expired = stores.some(store => {
      if (!captures[store]) return false
      const age = now - Date.parse(captures[store].observedAt)
      return age < 0 || age > 7 * 86400000
    })
    notice(sourceStatus, descriptions.join('\n'), gap === null || gap > 86400000 || expired ? 'warning' : '')
  } catch {
    if (revision !== sourceRevision) return
    sourceInput.value = ''
    plusInput.value = ''
    dekaInput.value = ''
    notice(sourceStatus, 'Nieuw bestand geweigerd. Controleer de strikte CSV-koppen, winkelopnames en echte brondata. ' +
      (captures ? 'De vorige geldige bron en je SKU-keuzes blijven beschikbaar.' : 'Nog geen geldige bron aanwezig.'), 'error')
  }
  refresh()
}
// Unsaved edits are private drafts, not admitted price source changes.
 // Keep the last accepted observations and human matches in memory; immediately
 // hide prior monetary results and disable comparison until admission/cancel.
document.addEventListener('supa:manual-source-edited', () => {
  ++sourceRevision
  pendingManualEdit = true
  invalidatePrice()
  refresh()
  notice(sourceStatus, 'Handmatig bronconcept gewijzigd. Vorige echte winkelopname en SKU-keuzes blijven bewaard, maar vergelijkingen zijn uitgeschakeld totdat je het concept overneemt of annuleert.', 'warning')
})
document.addEventListener('supa:manual-source-cancelled', () => {
  ++sourceRevision
  pendingManualEdit = false
  invalidatePrice()
  refresh()
  notice(sourceStatus, captures
    ? 'Concept geannuleerd. Eerder toegelaten winkelbron en gecontroleerde SKU-keuzes zijn behouden; vergelijk opnieuw voor een actueel privéresultaat.'
    : 'Concept geannuleerd. Er is nog geen eigen winkelbron ingelezen.')
})
document.addEventListener('supa:manual-source-admitted', event => {
  ++sourceRevision
  try {
    const source = acceptJson(event.detail?.source)
    // An explicitly observed one-store manual capture may add/replace only
    // THAT retailer. The other store is preserved from the original admitted
    // real capture, never generated as a fake observation.
    const combined = stores
      .map(store => source[store] ?? captures?.[store])
      .filter(Boolean)
    const verified = acceptJson({
      schema: combined.length === 2 ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
      captures: combined,
    })
    if (captures && JSON.stringify(verified) !== JSON.stringify(captures)) {
      const changed = stores.filter(store => source[store]).join(' en ')
      const retained = stores.filter(store => !source[store] && captures[store]).join(' en ')
      const question = 'Neem werkelijk zelf geobserveerde ' + changed + '-producten over? ' +
        (retained ? 'De bestaande oorspronkelijke ' + retained + '-opname blijft letterlijk ongewijzigd. ' : '') +
        'Eerdere SKU-keuzes blijven alleen bij letterlijk ongewijzigde winkelopnames bewaard. ' +
        'Gewijzigde winkels vereisen nieuwe handmatige productmatching; alle privébedragen worden opnieuw berekend.'
      if (!window.confirm(question)) {
        event.detail.accepted = false
        pendingManualEdit = false
        refresh()
        notice(sourceStatus, 'Handmatige bronvervanging niet uitgevoerd. Vorige echte opnames en SKU-keuzes blijven behouden. Vergelijk desgewenst opnieuw.')
        return
      }
    }
    const unchanged = stores.filter(store => captures?.[store] && verified[store] &&
      JSON.stringify(captures[store]) === JSON.stringify(verified[store]))
    // Clear ONLY changed-store choices before re-rendering new product options.
    for (const store of stores) {
      if (unchanged.includes(store)) continue
      for (const select of lines.querySelectorAll('[data-store="' + store + '"]')) select.value = ''
    }
    captures = verified
    pendingManualEdit = false
    event.detail.accepted = true
    sourceInput.value = ''
    plusInput.value = ''
    dekaInput.value = ''
    refresh()
    const now = Date.now()
    const labels = stores.map(store => {
      const capture = captures[store]
      if (!capture) return store + ': geen echte opname; onbekende artikelen en prijzen'
      const age = now - Date.parse(capture.observedAt)
      return store + ': ' + capture.products.length + ' echt ingevoerde product(en), ' +
        capture.observedAt + (age < 0 ? ' · toekomstig' :
          age > 7 * 86400000 ? ' · ouder dan 7 dagen' : '')
    })
    const gap = captures.PLUS && captures.DekaMarkt
      ? Math.abs(Date.parse(captures.PLUS.observedAt) - Date.parse(captures.DekaMarkt.observedAt)) : null
    if (gap === null) labels.push('De tweede winkel is niet waargenomen; geen volledig prijsverschil.')
    else if (gap > 86400000) labels.push('Opnames meer dan 24 uur uiteen: geen volledig betrouwbaar prijsverschil.')
    labels.push(unchanged.length
      ? 'SKU-keuzes van uitsluitend ongewijzigde echte opname(n) behouden; gewijzigde winkelproducten opnieuw kiezen.'
      : 'Bevestig nu per ingrediënt de originele echte winkelproduct-ID’s.')
    const expired = stores.some(store => {
      if (!captures[store]) return false
      const age = now - Date.parse(captures[store].observedAt)
      return age < 0 || age > 7 * 86400000
    })
    notice(sourceStatus, labels.join('\n'), gap === null || gap > 86400000 || expired ? 'warning' : '')
  } catch {
    event.detail.accepted = false
    // A malformed replacement never destroys the existing valid source.
    refresh()
    notice(sourceStatus, 'Handmatige bron geweigerd. Vorige echt toegelaten opname en SKU-keuzes blijven intact. Corrigeer het concept of annuleer.', 'error')
  }
})

sourceInput.addEventListener('change', () => {
  plusInput.value = ''
  dekaInput.value = ''
  void loadSources()
})
for (const input of [plusInput, dekaInput]) {
  input.addEventListener('change', () => {
    sourceInput.value = ''
    void loadSources()
  })
}

function parsePrivateDemand(text) {
  const root = JSON.parse(text)
  if (!root || typeof root !== 'object' || Array.isArray(root) ||
      Object.keys(root).some(k => !['schema', 'selectedMealCount', 'ingredients'].includes(k)) ||
      root.schema !== 'supa-private-basket-demand-v1' ||
      !Number.isSafeInteger(root.selectedMealCount) ||
      root.selectedMealCount < 1 || root.selectedMealCount > 1000 ||
      !Array.isArray(root.ingredients) || !root.ingredients.length ||
      root.ingredients.length > maxLines) {
    throw Error('Ongeldig of te groot eerder mandvraagbestand (maximaal 200 regels in dit scherm).')
  }
  const ids = new Set()
  const items = root.ingredients.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(k => !['id', 'label', 'amount', 'unit', 'productIds'].includes(k)) ||
        !validText(item.id, 100) || ids.has(item.id) || !validText(item.label) ||
        !units.includes(item.unit) ||
        (item.amount !== null && (typeof item.amount !== 'number' ||
          !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 100000 ||
          (item.unit === 'piece' && !Number.isSafeInteger(item.amount)))) ||
        !item.productIds || typeof item.productIds !== 'object' ||
        Array.isArray(item.productIds) ||
        Object.keys(item.productIds).some(store => !stores.includes(store))) {
      throw Error('Een ingrediënt uit de vorige mandvraag is ongeldig.')
    }
    ids.add(item.id)
    for (const store of stores) {
      const id = item.productIds[store]
      if (id !== null && id !== undefined && !validText(id, 100)) {
        throw Error('Eerder geselecteerde winkelproduct-ID is ongeldig.')
      }
    }
    // No silent reuse of a product ID against newer/different observations.
    return { id: item.id, label: item.label, amount: item.amount, unit: item.unit }
  })
  return { meals: root.selectedMealCount, items }
}
document.addEventListener('supa:private-planner-demand', event => {
  try {
    // Planner conversion uses Supa's existing canonical ingredient aggregator.
    // Re-validate the cross-module envelope exactly like a restored local demand.
    const saved = parsePrivateDemand(JSON.stringify(event.detail))
    mealCount.value = String(saved.meals)
    lines.replaceChildren()
    for (const item of saved.items) addIngredient(item)
    refresh()
    notice(status, saved.items.length + ' fysieke ingrediënten uit jouw gekozen weekmenu klaar om te koppelen. Kies voor beide winkels opnieuw de daadwerkelijk geobserveerde SKU’s; er zijn nog geen prijzen of matches aangenomen.')
  } catch {
    notice(status, 'De geselecteerde plannerweek is niet geschikt voor de veilige privé-mandvraag.', 'error')
  }
})

let demandImportRevision = 0
const physicalDraftFingerprint = () => JSON.stringify([
  mealCount.value,
  Array.from(lines.children, row => [
    row.dataset.id, row.querySelector('.label')?.value,
    row.querySelector('.amount')?.value, row.querySelector('.unit')?.value,
    ...stores.map(store => row.querySelector('[data-store=\"' + store + '\"]')?.value),
  ]),
])
demandImport.addEventListener('change', async () => {
  const file = demandImport.files?.[0]
  const revision = ++demandImportRevision
  if (!file) return
  const before = physicalDraftFingerprint()
  try {
    if (!file.size || file.size > maxBytes) throw Error('Vraagbestand is te groot of leeg.')
    const saved = parsePrivateDemand(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()))
    if (revision !== demandImportRevision) return
    if (physicalDraftFingerprint() !== before) {
      throw Error('Je mandvraag veranderde tijdens het openen. Het nieuwe bestand is niet toegepast.')
    }
    if (lines.children.length && !window.confirm(
      'Vervang jouw bestaande fysieke mandvraag door ' + saved.items.length +
      ' originele ingrediënten voor ' + saved.meals + ' geselecteerde maaltijd(en)? ' +
      'Je bestaande productkoppelingen en afvinkingen voor dit mandje vervallen; ' +
      'de originele eigen winkelbronprijzen blijven los bewaard.')) {
      notice(status, 'Mandvraagimport geannuleerd. Eerdere ingrediënten en winkelproductkeuzes zijn behouden.')
      return
    }
    if (revision !== demandImportRevision || physicalDraftFingerprint() !== before) return
    // Atomic UI replacement after full schema and consent admission.
    mealCount.value = String(saved.meals)
    lines.replaceChildren()
    for (const item of saved.items) addIngredient(item)
    invalidateUnpricedDemand()
    refresh()
    notice(status, saved.items.length + ' ingrediënten bewust hersteld. Kies alle PLUS- en DekaMarkt-producten opnieuw op basis van de nu geopende eigen opnames; oude productmatches zijn niet automatisch betrouwbaar.')
  } catch (error) {
    if (revision === demandImportRevision) notice(status,
      (error instanceof Error ? error.message : 'Kan eerdere mandvraag niet veilig openen.') +
      ' De vorige mandvraag en jouw eigen bronprijzen zijn niet vervangen.', 'error')
  } finally {
    if (revision === demandImportRevision) demandImport.value = ''
  }
})

function demand() {
  // An unpriced shopping demand is valid without any retailer observation.
  // The comparison button separately requires admitted real store sources.
  const meals = Number(mealCount.value)
  if (!/^[1-9]\d*$/.test(mealCount.value) || !Number.isSafeInteger(meals) || meals > 1000) {
    throw Error('Vul een geldig aantal geselecteerde maaltijden van 1 tot 1000 in.')
  }
  const ingredients = []
  if (!lines.children.length || lines.children.length > 1000) throw Error('Voeg minimaal één ingrediënt toe.')
  for (const row of lines.children) {
    const label = row.querySelector('.label').value.trim()
    const rawAmount = row.querySelector('.amount').value.trim()
    const amount = rawAmount === '' ? null : numeric(rawAmount)
    const unit = row.querySelector('.unit').value
    if (!validText(label)) throw Error('Controleer de naam van ingrediënt ' + (ingredients.length + 1) + '.')
    if (rawAmount !== '' && (amount === null ||
        (unit === 'piece' && !Number.isSafeInteger(amount)))) {
      throw Error('Ongeldige hoeveelheid bij ' + label + '. Losse stuks moeten hele aantallen zijn; overige hoeveelheden metrisch en positief.')
    }
    const productIds = {}
    for (const store of stores) {
      const value = selected(row.querySelector('[data-store="' + store + '"]'))
      if (value !== null && !observedProducts(store, unit).some(p => p.id === value)) {
        throw Error('Productkeuze van ' + store + ' past niet bij ' + label + '.')
      }
      productIds[store] = value
    }
    ingredients.push({ id: row.dataset.id, label, amount, unit, productIds })
  }
  return { schema: 'supa-private-basket-demand-v1', selectedMealCount: meals, ingredients }
}

function updateUnpricedProgress() {
  if (!unpricedSnapshot) return
  const total = unpricedSnapshot.ingredients.length
  const done = unpricedSnapshot.ingredients.filter(item => unpricedChecked.has(item.id)).length
  unpricedProgress.textContent = done + ' van ' + total +
    ' ingrediënten afgevinkt · ' + (total - done) + ' resterend. ' +
    'Geen winkelprijs of kassagarantie.'
}

function openUnpricedList() {
  const data = demand()
  unpricedSnapshot = data
  unpricedChecked.clear()
  unpricedItems.replaceChildren()
  for (const item of data.ingredients) {
    const label = document.createElement('label')
    label.className = 'unpriced-line'
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.setAttribute('aria-label', 'Afvinken: ' + item.label)
    check.addEventListener('change', () => {
      if (check.checked) unpricedChecked.add(item.id)
      else unpricedChecked.delete(item.id)
      updateUnpricedProgress()
    })
    const text = document.createElement('span')
    text.textContent = item.label + ' · ' +
      (item.amount === null ? 'hoeveelheid nog controleren' :
        String(item.amount).replace('.', ',') + ' ' +
          (item.unit === 'piece' ? 'stuk(s)' : item.unit))
    label.append(check, text)
    unpricedItems.append(label)
  }
  updateUnpricedProgress()
  unpricedTrip.hidden = false
  unpricedTrip.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

showUnpriced.addEventListener('click', () => {
  try {
    openUnpricedList()
  } catch (error) {
    unpricedTrip.hidden = true
    notice(status, error instanceof Error ? error.message :
      'Kan eigen ongeprijsde lijst niet veilig maken.', 'error')
  }
})

document.querySelector('#unpriced-reset').addEventListener('click', () => {
  if (unpricedTrip.hidden || !unpricedSnapshot) return
  unpricedChecked.clear()
  for (const input of unpricedItems.querySelectorAll('input[type="checkbox"]')) input.checked = false
  updateUnpricedProgress()
})

// Optional local backup for the *unpriced* checklist. No retailer price or SKU
// is ever written to this portable file; it is bound to exact physical demand.
const unpricedRestore = document.querySelector('#unpriced-restore')
const physicalRows = data => data.ingredients.map(({ id, label, amount, unit }) =>
  ({ id, label, amount, unit }))
const currentUnpricedRows = () => {
  if (unpricedTrip.hidden || !unpricedSnapshot) throw Error('Open eerst de ongeprijsde afvinklijst.')
  const current = physicalRows(demand())
  if (JSON.stringify(current) !== JSON.stringify(physicalRows(unpricedSnapshot))) {
    throw Error('De ingrediënten zijn veranderd. Open een nieuwe afvinklijst.')
  }
  return current
}
document.querySelector('#unpriced-backup').addEventListener('click', () => {
  try {
    const ingredients = currentUnpricedRows()
    const content = JSON.stringify({ schema: 'supa-private-unpriced-checklist-v1',
      ingredients, checkedIds: ingredients.filter(item => unpricedChecked.has(item.id)).map(item => item.id) }, null, 2) + '\n'
    if (new TextEncoder().encode(content).length > maxBytes) throw Error('De afvinkstatus is te groot.')
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
    const link = node('a')
    link.href = url
    link.download = 'supa-ongeprijsde-afvinkstatus.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    notice(status, 'Ongeprijsde afvinkstatus lokaal aangeboden: zonder winkelbron, SKU of prijs.')
  } catch (error) { notice(status, error instanceof Error ? error.message :
    'Kan afvinkstatus niet bewaren.', 'error') }
})
let unpricedRestoreRevision = 0
unpricedRestore.addEventListener('change', async () => {
  const file = unpricedRestore.files?.[0]
  if (!file) return
  const attempt = ++unpricedRestoreRevision
  try {
    const original = currentUnpricedRows()
    const source = await readLocalFile(file)
    if (attempt !== unpricedRestoreRevision) return
    const saved = JSON.parse(source)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) ||
        Object.keys(saved).sort().join(',') !== 'checkedIds,ingredients,schema' ||
        saved.schema !== 'supa-private-unpriced-checklist-v1' ||
        !Array.isArray(saved.ingredients) || !Array.isArray(saved.checkedIds) ||
        JSON.stringify(saved.ingredients) !== JSON.stringify(original) ||
        !saved.checkedIds.every(id => typeof id === 'string' &&
          original.some(item => item.id === id)) ||
        new Set(saved.checkedIds).size !== saved.checkedIds.length ||
        JSON.stringify(currentUnpricedRows()) !== JSON.stringify(original)) {
      throw Error('Afvinkbestand hoort niet bij precies deze fysieke ingrediëntenlijst.')
    }
    if (!window.confirm('Herstel uitsluitend de vinkjes van exact deze ongeprijsde ingrediënten? ' +
        'De huidige vinkjes worden vervangen; winkelprijzen blijven volledig buiten beeld.')) return
    if (attempt !== unpricedRestoreRevision ||
        JSON.stringify(currentUnpricedRows()) !== JSON.stringify(original)) return
    unpricedChecked.clear()
    for (const id of saved.checkedIds) unpricedChecked.add(id)
    const checkboxes = unpricedItems.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach((box, index) => { box.checked = unpricedChecked.has(original[index].id) })
    updateUnpricedProgress()
    notice(status, saved.checkedIds.length + ' ongeprijsde afvinkingen uitsluitend voor deze fysieke mand hersteld.')
  } catch (error) { if (attempt === unpricedRestoreRevision)
    notice(status, error instanceof Error ? error.message : 'Kan afvinkstatus niet veilig herstellen.', 'error')
  } finally { if (attempt === unpricedRestoreRevision) unpricedRestore.value = '' }
})

downloadUnpriced.addEventListener('click', () => {
  try {
    const data = demand()
    const lines = [
      'SUPA · eigen ongeprijsde ingrediëntenlijst',
      'Aangemaakt op: ' + new Date().toISOString(),
      'Geselecteerde maaltijden: ' + data.selectedMealCount,
      'Geen winkelprijzen, automatische productmatching of besparingsclaim.',
      '',
      ...data.ingredients.map(item =>
        (unpricedChecked.has(item.id) && !unpricedTrip.hidden ? '[x] ' : '[ ] ') + item.label + ' · ' +
        (item.amount === null ? 'hoeveelheid nog controleren (' + item.unit + ')' :
          String(item.amount).replace('.', ',') + ' ' +
            (item.unit === 'piece' ? 'stuk(s)' : item.unit))),
      '',
      'Gebruik jouw eigen feitelijke verpakkingsinformatie bij het winkelen.',
      '',
    ]
    const content = lines.join('\n')
    if (new TextEncoder().encode(content).length > maxBytes) {
      throw Error('De ongeprijsde ingrediëntenlijst is te groot.')
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'supa-eigen-ingredienten-ongeprijsd.txt'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    notice(status, 'Jouw eigen ongeprijsde ingrediëntenlijst is lokaal aangeboden. ' +
      data.ingredients.length + ' ingrediënten, zonder fictieve winkelprijzen. Je kunt later alsnog echte bronproducten koppelen.')
  } catch (error) {
    notice(status, error instanceof Error ? error.message :
      'Kan ongeprijsde ingrediëntenlijst niet veilig bewaren.', 'error')
  }
})

save.addEventListener('click', () => {
  try {
    const data = demand()
    const content = JSON.stringify(data, null, 2) + '\n'
    if (new TextEncoder().encode(content).length > maxBytes) {
      throw Error('Het gegenereerde vraagbestand is groter dan 256 kB.')
    }
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = node('a')
    a.href = url
    a.download = 'supa-private-mand-vraag.json'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    const unresolved = data.ingredients.reduce((count, i) => count +
      stores.filter(store => i.productIds[store] === null).length, 0)
    notice(status, 'Privé mandvraag als JSON aangeboden. ' + data.ingredients.length +
      ' ingrediënten; ' + unresolved + ' ontbrekende winkelkoppelingen blijven bewust onbekend. ' +
      'Gebruik de bestaande lokale HTML-vergelijker om exacte verpakkingbedragen en ouderdom te controleren.')
  } catch (error) {
    notice(status, error instanceof Error ? error.message : 'Kan mandvraag niet maken.', 'error')
  }
})
function ownSourceEnvelope() {
  if (!captures) throw Error('Open eerst een eigen echte winkelopname.')
  const present = stores.filter(store => captures[store]).map(store => captures[store])
  if (!present.length) throw Error('Geen toegelaten winkelopname.')
  return {
    schema: present.length === 2 ? 'supa-offline-prices-v1' : 'supa-private-single-store-prices-v1',
    captures: present,
  }
}

// Explicit portable private session: the whole source and original observations travel
// only in an opt-in local file. Neither browser storage nor any network is involved.
function savePrivateSession() {
  if (!captures) throw Error('Open eerst je eigen echte winkelopname.')
  const snapshot = {
    schema: 'supa-private-basket-session-v1',
    source: ownSourceEnvelope(),
    demand: demand(),
  }
  const content = JSON.stringify(snapshot, null, 2) + '\n'
  if (new TextEncoder().encode(content).length > maxBytes) {
    throw Error('De sessie is groter dan 256 kB. Bewaar bronbestanden en vraag afzonderlijk.')
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = node('a')
  link.href = url
  link.download = 'supa-prive-mand-sessie.json'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  notice(status, 'Jouw privésessie met echte eigen bronopnames en gekozen product-ID’s is lokaal aangeboden. ' +
    'Bescherm dit bestand: het bevat privé product- en prijsgegevens. Geen besparingsclaim of automatische herberekening.')
}
saveSession.addEventListener('click', () => {
  try { savePrivateSession() }
  catch (error) { notice(status, error instanceof Error ? error.message : 'Kan privésessie niet bewaren.', 'error') }
})

let sessionImportRevision = 0
restoreSession.addEventListener('change', async () => {
  const file = restoreSession.files?.[0]
  if (!file) return
  const attempt = ++sessionImportRevision
  const originalSourceRevision = sourceRevision
  try {
    const text = await readLocalFile(file)
    if (attempt !== sessionImportRevision || originalSourceRevision !== sourceRevision) return
    const root = JSON.parse(text)
    if (!root || typeof root !== 'object' || Array.isArray(root) ||
        Object.keys(root).sort().join(',') !== 'demand,schema,source' ||
        root.schema !== 'supa-private-basket-session-v1') {
      throw Error('Dit is geen ondersteunde Supa privésessie.')
    }
    // Same strict local source admission as a regular JSON import.
    const verified = acceptJson(root.source)
    const saved = parsePrivateDemand(JSON.stringify(root.demand))
    for (let index = 0; index < saved.items.length; index++) {
      const raw = root.demand.ingredients[index]
      const unit = saved.items[index].unit
      for (const store of stores) {
        const sku = raw.productIds[store]
        if (sku !== null && sku !== undefined &&
            !verified[store]?.products.some(p => p.id === sku &&
              classify(p.packUnit) === classify(unit))) {
          throw Error('Een opgeslagen SKU past niet bij de echte winkelbron en fysieke eenheid.')
        }
      }
    }
    if (!window.confirm('Deze privésessie bevat eigen bronprijzen en handmatig gekozen producten. ' +
        'Vervang de huidige winkelopnames en ingrediënten? Oude opnameprijzen blijven oud. ' +
        'Supa vergelijkt niet automatisch.')) return
    if (attempt !== sessionImportRevision || originalSourceRevision !== sourceRevision) return
    ++sourceRevision
    captures = verified
    // An explicitly confirmed portable session replaces any unsaved manual
    // draft; otherwise a stale draft lock would hide its real source and
    // permanently disable the restored comparison and source backup.
    pendingManualEdit = false
    sourceInput.value = ''
    plusInput.value = ''
    dekaInput.value = ''
    mealCount.value = String(saved.meals)
    lines.replaceChildren()
    for (const item of saved.items) addIngredient(item)
    for (let index = 0; index < saved.items.length; index++) {
      const row = lines.children[index]
      for (const store of stores) {
        const sku = root.demand.ingredients[index].productIds[store]
        if (sku === null || sku === undefined) continue
        const select = row.querySelector('[data-store="' + store + '"]')
        // The picker shows at most 80 products. Restore an exact admitted SKU
        // even when it lies outside that initial visible result window.
        if (!Array.from(select.options).some(option => option.value === sku)) {
          const product = verified[store].products.find(p => p.id === sku)
          select.add(new Option(product.name + ' · eigen bron-ID ' + sku, sku))
        }
        select.value = sku
        updateSelect(select, store, saved.items[index].unit)
      }
    }
    invalidateUnpricedDemand()
    refresh()
    const ages = stores.map(store => captures[store]
      ? Date.now() - Date.parse(captures[store].observedAt) : null)
    const gap = captures.PLUS && captures.DekaMarkt
      ? Math.abs(Date.parse(captures.PLUS.observedAt) - Date.parse(captures.DekaMarkt.observedAt)) : null
    const stale = ages.some(age => age !== null && (age < 0 || age > 7 * 86400000)) ||
      gap === null || gap > 86400000
    notice(sourceStatus, stores.map(store => captures[store]
      ? store + ': ' + captures[store].products.length +
        ' eigen bronartikelen, oorspronkelijke opname ' + captures[store].observedAt
      : store + ': geen echte bronopname, onbekende prijzen').join('\n') +
      (stale ? '\nGeen geldig volledig bronpaar; per complete recente winkel blijft een boodschappenlijst mogelijk.' :
        '\nControleer de oorspronkelijke SKU-keuzes opnieuw.'), stale ? 'warning' : '')
    notice(status, saved.items.length + ' ingrediënten en SKU-keuzes lokaal hersteld. ' +
      'Controleer zelf de oorspronkelijke producten, hoeveelheden en bronmomenten vóór vergelijking. ' +
      'Dit bewijst geen bronrechten of kassaprijzen.', stale ? 'warning' : '')
  } catch (error) {
    if (attempt === sessionImportRevision) notice(status, error instanceof Error ? error.message :
      'Kan privésessie niet veilig openen.', 'error')
  } finally { if (attempt === sessionImportRevision) restoreSession.value = '' }
})

document.addEventListener('supa:private-ingredient-merged', () => {
  invalidateUnpricedDemand()
  refresh()
})
add.addEventListener('click', () => addIngredient())
addIngredient()

compareNow.addEventListener('click', () => {
  try {
    const source = ownSourceEnvelope()
    document.dispatchEvent(new CustomEvent('supa:compare-private-basket', { detail: { source, demand: demand() } }))
    if (priceResult && !priceResult.hidden) priceResult.scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch (error) {
    notice(status, error instanceof Error ? error.message : 'Mandvraag is ongeldig', 'error')
  }
})

for (const kind of ['input', 'change']) {
  document.addEventListener(kind, event => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.matches('.label, .amount, .unit') && target.closest('#lines') ||
        target.closest('#meal-count')) invalidateUnpricedDemand()
    if (target.closest('#lines') || target.closest('#meal-count')) updateCoverage()
    if (target.closest('#lines') || target.closest('#meal-count') ||
        target.closest('#source') || target.closest('#plus-source') ||
        target.closest('#deka-source')) invalidatePrice()
  })
}
