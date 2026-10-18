/* Supa private basket mapping: local, explicit user selection; not a retailer scraper.
 * Source admission delegates to the existing canonical offline CSV converter.
 * No storage, remote requests, inferred product equivalence or monetary computation.
 */
import { convertTwoStoreCsv } from './offline-two-store-csv.mjs'

const stores = ['PLUS', 'DekaMarkt']
const units = ['g', 'kg', 'ml', 'l', 'piece']
const maxBytes = 256000
const sourceInput = document.querySelector('#source')
const sourceStatus = document.querySelector('#source-status')
const status = document.querySelector('#status')
const lines = document.querySelector('#lines')
const mealCount = document.querySelector('#meal-count')
const save = document.querySelector('#save')
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

function availableProducts(store, unit) {
  const capture = captures?.[store]
  if (!capture) return []
  return capture.products.filter(product => product.available &&
    product.priceCents !== null && product.packAmount !== null &&
    classify(product.packUnit) === classify(unit))
}

function updateSelect(select, store, unit) {
  const chosen = select.value
  select.replaceChildren(new Option('Niet gekoppeld · onbekend', ''))
  for (const product of availableProducts(store, unit)) {
    const pack = String(product.packAmount).replace('.', ',') + ' ' + product.packUnit
    const option = new Option(product.name + ' · ' + pack + ' · ID ' + product.id, product.id)
    select.add(option)
  }
  if (Array.from(select.options).some(opt => opt.value === chosen)) select.value = chosen
}
function refresh() {
  for (const row of lines.querySelectorAll('.ingredient')) {
    const unit = row.querySelector('.unit').value
    for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit)
  }
  save.disabled = !captures || !lines.children.length
}
function addIngredient() {
  if (lines.children.length >= 1000) return
  const id = 'ingredient-' + nextId++
  const row = node('div', { className: 'ingredient' })
  row.dataset.id = id
  const heading = node('strong', {}, 'Ingrediënt ' + (lines.children.length + 1))
  const grid = node('div', { className: 'grid' })
  const label = node('input', { type: 'text', placeholder: 'Bijv. rijst' })
  label.maxLength = 160
  label.className = 'label'
  const amount = node('input', { type: 'text', placeholder: 'bijv. 500' })
  amount.maxLength = 24
  amount.className = 'amount'
  const unit = node('select')
  unit.className = 'unit'
  for (const item of units) unit.add(new Option(item === 'piece' ? 'stuk (piece)' : item, item))
  unit.addEventListener('change', () => {
    for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit.value)
  })
  field(grid, 'Ingrediëntnaam', label)
  field(grid, 'Hoeveelheid (leeg = onbekend)', amount)
  field(grid, 'Eenheid', unit)
  const storesGrid = node('div', { className: 'stores' })
  for (const store of stores) {
    const select = node('select')
    select.dataset.store = store
    select.setAttribute('aria-label', 'Gekozen ' + store + '-product voor ' + id)
    field(storesGrid, store + ' · expliciete productkeuze', select)
  }
  const actions = node('div', { className: 'row-actions' })
  const remove = node('button', { type: 'button', className: 'secondary' }, 'Verwijder ingrediënt')
  remove.addEventListener('click', () => { row.remove(); refresh() })
  actions.append(remove)
  row.append(heading, grid, storesGrid, actions)
  lines.append(row)
  for (const store of stores) updateSelect(row.querySelector('[data-store="' + store + '"]'), store, unit.value)
  save.disabled = !captures
}

function acceptJson(json) {
  if (!json || Array.isArray(json) || json.schema !== 'supa-offline-prices-v1' ||
      !Array.isArray(json.captures) || json.captures.length !== 2) {
    throw Error('Bestand heeft niet het bestaande Supa-prijsbronformaat.')
  }
  const result = Object.create(null)
  for (const capture of json.captures) {
    if (!capture || typeof capture !== 'object' ||
        !stores.includes(capture.retailer) || result[capture.retailer] ||
        !Array.isArray(capture.products) || capture.products.length > 1000 ||
        !Number.isFinite(Date.parse(capture.observedAt))) {
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
  if (stores.some(store => !result[store])) throw Error('Beide winkelopnames zijn vereist.')
  return result
}

sourceInput.addEventListener('change', async () => {
  captures = null
  refresh()
  const file = sourceInput.files?.[0]
  if (!file) { notice(sourceStatus, 'Geen bronbestand gekozen.'); return }
  if (!file.size || file.size > maxBytes) {
    notice(sourceStatus, 'Bronbestand moet tussen 1 en 256.000 bytes groot zijn.', 'error'); return
  }
  try {
    const text = await file.text()
    // Using one shared source of truth: CSV is parsed/validated by the same
    // converter used by the CLI and the existing Supa comparison importer.
    const parsed = file.name.toLowerCase().endsWith('.json')
      ? JSON.parse(text) : JSON.parse(convertTwoStoreCsv(text))
    captures = acceptJson(parsed)
    const now = Date.now()
    const descriptions = stores.map(store => {
      const capture = captures[store]
      const ageMs = now - Date.parse(capture.observedAt)
      const stale = ageMs < 0 ? ' · toekomstig' :
        ageMs > 7 * 86400000 ? ' · ouder dan 7 dagen' : ''
      return store + ': ' + capture.products.length + ' producten, vastgelegd ' +
        capture.observedAt + stale
    })
    const gap = Math.abs(Date.parse(captures.PLUS.observedAt) -
      Date.parse(captures.DekaMarkt.observedAt))
    if (gap > 86400000) descriptions.push('Opnames >24 uur uiteen. Opnieuw meten voor een volledige vergelijking.')
    descriptions.push('Selecteer uitsluitend door jou gecontroleerde matches. Geen automatische bronrechten of besparing.')
    notice(sourceStatus, descriptions.join('\n'), gap > 86400000 ? 'warning' : '')
  } catch {
    captures = null
    notice(sourceStatus, 'Kan eigen bron niet veilig verwerken. Gebruik het strikte negenkoloms-CSV of de officiële CLI-JSON.', 'error')
  }
  refresh()
})

function demand() {
  if (!captures) throw Error('Open eerst een geldige eigen winkelbron.')
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
    if (rawAmount !== '' && amount === null) {
      throw Error('Ongeldige hoeveelheid bij ' + label + '. Gebruik metrische positieve getallen.')
    }
    const productIds = {}
    for (const store of stores) {
      const value = selected(row.querySelector('[data-store="' + store + '"]'))
      if (value !== null && !availableProducts(store, unit).some(p => p.id === value)) {
        throw Error('Productkeuze van ' + store + ' past niet bij ' + label + '.')
      }
      productIds[store] = value
    }
    ingredients.push({ id: row.dataset.id, label, amount, unit, productIds })
  }
  return { schema: 'supa-private-basket-demand-v1', selectedMealCount: meals, ingredients }
}

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
add.addEventListener('click', addIngredient)
addIngredient()
