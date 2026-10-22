/**
 * Supa private manual observation capture.
 * User enters observed products, timestamps and monetary prices explicitly;
 * no fixtures, retailer calls, inferred IDs, or implicit price timestamps.
 * The existing shared strict CSV admission remains the source of truth.
 */
import { convertOwnStoreCsv } from './offline-two-store-csv.mjs'

const stores = ['PLUS', 'DekaMarkt']
const mode = document.querySelector('#manual-store-mode')
const selectedStores = () => mode.value === 'both' ? stores : [mode.value]
const csvHeader = 'retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available'
const areas = Object.fromEntries(stores.map(store => [
  store, document.querySelector('[data-observations="' + store + '"]'),
]))
const notice = document.querySelector('#manual-status')
const save = document.querySelector('#manual-export')
const apply = document.querySelector('#manual-apply')
const ceiling = 256000
let acceptedCsv = null

/** A visual reference only for a user-confirmed Planner handoff. No retailer
 * SKU, price, observation time or product recommendation is inferred here. */
const manualDemandContext = document.querySelector('#manual-demand-context')
const manualDemandQuery = document.querySelector('#manual-demand-query')
const manualDemandItems = document.querySelector('#manual-demand-items')
const manualDemandCount = document.querySelector('#manual-demand-count')
let manualDemand = []
const readableDemand = amount => {
  if (amount === null) return 'hoeveelheid controleren'
  const raw = String(amount)
  const parts = /^(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(raw)
  if (!parts) return raw
  const digits = parts[1] + (parts[2] || '')
  const position = parts[1].length + Number(parts[3])
  if (position <= 0) return '0.' + '0'.repeat(-position) + digits
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length)
  return digits.slice(0, position) + '.' + digits.slice(position)
}
function showManualDemand() {
  if (!manualDemand.length) {
    manualDemandContext.hidden = true
    manualDemandItems.replaceChildren()
    manualDemandCount.textContent = ''
    return
  }
  const search = manualDemandQuery.value.trim().normalize('NFKD')
    .replace(/\p{M}/gu, '').toLocaleLowerCase('nl-NL')
  const shown = manualDemand.filter(need => need.label.normalize('NFKD')
    .replace(/\p{M}/gu, '').toLocaleLowerCase('nl-NL').includes(search))
  const entries = shown.map(need => {
    const li = document.createElement('li')
    li.textContent = need.label + ': ' + readableDemand(need.amount) + ' ' +
      (need.unit === 'piece' ? 'stuks' : need.unit)
    return li
  })
  manualDemandItems.replaceChildren(...entries)
  manualDemandCount.textContent = shown.length + ' van ' + manualDemand.length +
    ' oorspronkelijke fysieke ingrediënten. Geen winkelartikel of prijs gekoppeld.'
  manualDemandContext.hidden = false
}
document.addEventListener('supa:private-planner-demand', event => {
  const demand = event.detail
  const valid = demand && demand.schema === 'supa-private-basket-demand-v1' &&
    Array.isArray(demand.ingredients) && demand.ingredients.length > 0 &&
    demand.ingredients.length <= 200 && demand.ingredients.every(need =>
      need && typeof need.label === 'string' && need.label.length > 0 &&
      need.label.length <= 160 && /[\p{L}\p{N}]/u.test(need.label) &&
      !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(need.label) &&
      ['g', 'kg', 'ml', 'l', 'piece'].includes(need.unit) &&
      (need.amount === null || (typeof need.amount === 'number' &&
        Number.isFinite(need.amount) && need.amount > 0 && need.amount <= 100000 &&
        (need.unit !== 'piece' || Number.isSafeInteger(need.amount)))))
  manualDemand = valid ? demand.ingredients.map(need => ({
    label: need.label, amount: need.amount, unit: need.unit,
  })) : []
  manualDemandQuery.value = ''
  showManualDemand()
  // The existing basket module has already applied this event before this
  // guide listener runs. Capture only the physical identity, never SKU choices.
  manualDemandSnapshot = valid ? physicalDemandSnapshot() : null
})
manualDemandQuery.addEventListener('input', showManualDemand)

/** Keep the reference accurate after a real demand edit, but NEVER throw
 * away legitimate admitted store observations merely because the user
 * searches this guide or picks another original shop SKU. */
let manualDemandSnapshot = null
const physicalDemandSnapshot = () => JSON.stringify([
  document.querySelector('#meal-count')?.value ?? '',
  Array.from(document.querySelector('#lines')?.children ?? [], row => [
    row.dataset.id ?? '', row.querySelector('.label')?.value ?? '',
    row.querySelector('.amount')?.value ?? '', row.querySelector('.unit')?.value ?? '',
  ]),
])
function clearStaleManualDemand() {
  if (manualDemandSnapshot === null ||
      physicalDemandSnapshot() === manualDemandSnapshot) return
  manualDemandSnapshot = null
  manualDemand = []
  showManualDemand()
}
document.addEventListener('supa:private-basket-invalidated', clearStaleManualDemand)
document.querySelector('#lines').addEventListener('input', clearStaleManualDemand)
document.querySelector('#meal-count').addEventListener('input', clearStaleManualDemand)
document.querySelector('#meal-count').addEventListener('change', clearStaleManualDemand)

const make = (tag, text) => {
  const element = tag === 'div' ? document.createElement('div') :
    tag === 'label' ? document.createElement('label') :
      tag === 'input' ? document.createElement('input') :
        tag === 'select' ? document.createElement('select') :
          tag === 'button' ? document.createElement('button') :
            tag === 'strong' ? document.createElement('strong') :
              document.createElement('small')
  if (text !== undefined) element.textContent = text
  return element
}
const field = (parent, caption, kind, key, placeholder) => {
  const label = make('label', caption)
  const input = make(kind)
  input.dataset.field = key
  if (kind === 'input') {
    input.type = 'text'
    input.placeholder = placeholder || ''
    input.autocomplete = 'off'
  }
  label.append(input)
  parent.append(label)
  return input
}
const setStatus = (message, kind = '') => {
  notice.textContent = message
  notice.className = 'notice' + (kind ? ' ' + kind : '')
}
const removeReview = () => {
  acceptedCsv = null
  save.disabled = true
  setStatus('Invoer gewijzigd: neem na controle de werkelijk gekozen winkelopname(s) opnieuw over voordat je prijzen vergelijkt.', 'warning')
  document.dispatchEvent(new Event('supa:manual-source-edited'))
}
const quote = value => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value

// Supports Dutch comma or period, produces exact whole cents as a decimal
// string: float-based multiplication is never used for actual pack money.
function euroToCents(raw) {
  if (raw === '') return ''
  const match = /^(0|[1-9]\d{0,4})(?:[.,](\d{1,2}))?$/.exec(raw)
  if (!match) throw Error('Voer een gemeten eurobedrag in, bijvoorbeeld 1,49 of 0,99.')
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'))
  if (cents <= 0n || cents > 1000000n) throw Error('De gemeten winkelprijs moet positief zijn en binnen het ondersteunde bereik vallen.')
  return String(cents)
}
function addRow(store, notify = true) {
  const panel = areas[store]
  if (panel.querySelectorAll('.observed-product').length >= 100) {
    setStatus('Maximaal 100 handmatige productregels per winkel. Gebruik anders een eigen CSV-import.', 'warning')
    return
  }
  const row = make('div')
  row.className = 'observed-product'
  const title = make('strong', 'Eigen productwaarneming · ' + store)
  const grid = make('div')
  grid.className = 'observation-grid'
  const id = field(grid, 'Werkelijke product-ID', 'input', 'id', 'Artikelnummer op jouw opname')
  id.maxLength = 100
  const name = field(grid, 'Werkelijke productnaam', 'input', 'name', 'Artikelnaam zoals afgelezen')
  name.maxLength = 160
  const amount = field(grid, 'Inhoud per verpakking', 'input', 'packAmount', 'bijv. 500')
  amount.maxLength = 20
  const unit = field(grid, 'Eenheid van verpakking', 'select', 'packUnit')
  for (const value of ['g', 'kg', 'ml', 'l', 'piece']) unit.add(new Option(value, value))
  const count = field(grid, 'Aantal eenheden per multipack', 'input', 'packCount', 'bijv. 1')
  count.maxLength = 5
  const price = field(grid, 'Echt afgelezen prijs (€; leeg = onbekend)', 'input', 'priceEuro', 'bijv. 2,49')
  price.maxLength = 12
  const available = field(grid, 'Beschikbaarheid en prijs bevestigd?', 'select', 'available')
  available.add(new Option('Nee / prijs niet bevestigd', 'false'))
  available.add(new Option('Ja, zelf gecontroleerd', 'true'))
  row.append(title, grid)
  const remove = make('button', 'Verwijder productregel')
  remove.type = 'button'
  remove.className = 'secondary'
  remove.addEventListener('click', () => {
    row.remove()
    removeReview()
  })
  row.append(remove)
  panel.append(row)
  if (notify) removeReview()
}
function readRows() {
  const rows = []
  for (const store of selectedStores()) {
    const when = document.querySelector('[data-capture="' + store + '"]').value.trim()
    if (!when) throw Error('Voer voor elke gekozen winkel het werkelijke opname-moment inclusief UTC-offset in.')
    const entries = Array.from(areas[store].querySelectorAll('.observed-product'))
    if (!entries.length) throw Error('Vul minimaal één werkelijke productregel per winkel in.')
    for (const row of entries) {
      const value = field => row.querySelector('[data-field="' + field + '"]').value.trim()
      const cents = euroToCents(value('priceEuro'))
      const record = [
        store, when, value('id'), value('name'),
        value('packAmount').replace(',', '.'), value('packUnit'),
        value('packCount'), cents, value('available'),
      ]
      // The canonical reader validates every mandatory value, including the
      // actual ISO offset, product ID uniqueness, pack count, cent money,
      // availability and one capture instant per retailer.
      rows.push(record.map(quote).join(','))
    }
  }
  return csvHeader + '\n' + rows.join('\n') + '\n'
}
function submit() {
  try {
    const csv = readRows()
    if (new TextEncoder().encode(csv).length > ceiling) {
      throw Error('De handmatige brongegevens zijn te groot (maximum 256 kB).')
    }
    const canonical = JSON.parse(convertOwnStoreCsv(csv))
    // The browser mapping owner can reject an already admitted candidate,
    // or the user can cancel before overwriting earlier first-store capture.
    // Only enable download/claim admission after that synchronous decision.
    const proposal = { source: canonical, accepted: false }
    document.dispatchEvent(new CustomEvent('supa:manual-source-admitted', {
      detail: proposal,
    }))
    if (!proposal.accepted) {
      acceptedCsv = null
      save.disabled = true
      setStatus('De nieuwe handmatige bron is niet overgenomen. De eerder geaccepteerde winkelopname blijft bestaan; pas je concept aan of annuleer.', 'warning')
      return
    }
    acceptedCsv = csv
    save.disabled = false
    setStatus('De daadwerkelijk ingevoerde winkelopname(s) zijn lokaal geaccepteerd; eerdere ongewijzigde echte winkelopnames blijven behouden. Bevestig voor gewijzigde winkels opnieuw de juiste producten. Geen retailerlicentie of onafhankelijk veldbewijs aangenomen.')
  } catch (error) {
    acceptedCsv = null
    save.disabled = true
    setStatus(error instanceof Error ? error.message : 'Ongeldige handmatige bronwaarneming.', 'error')
  }
}
apply.addEventListener('click', submit)
document.querySelector('#manual-cancel').addEventListener('click', () => {
  acceptedCsv = null
  save.disabled = true
  // Discard ONLY unsaved form fields, not the separately admitted mapping data.
  // A new manual capture starts truly empty: no invented ID, price or clock.
  for (const store of stores) {
    areas[store].replaceChildren()
    document.querySelector('[data-capture="' + store + '"]').value = ''
    addRow(store, false)
  }
  mode.value = 'both'
  updateMode()
  document.dispatchEvent(new Event('supa:manual-source-cancelled'))
  setStatus('Conceptvelden zijn leeggemaakt. De eerder toegelaten originele winkelbron en bewuste productkeuzes blijven beschikbaar. Een nieuwe opname vereist opnieuw je echte productgegevens, prijs en tijd.')
})
save.addEventListener('click', () => {
  if (acceptedCsv === null) return
  const file = new Blob([acceptedCsv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = 'supa-eigen-winkelwaarnemingen.csv'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
})
document.addEventListener('supa:manual-prefill-own-source', event => {
  try {
    const incoming = event.detail?.captures
    if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 2 ||
        new Set(incoming.map(item => item?.retailer)).size !== incoming.length) {
      throw Error('Kies eerst één of twee geldige eigen winkelopnames.')
    }
    const checked = Object.create(null)
    for (const capture of incoming) {
      if (!capture || !stores.includes(capture.retailer) ||
          typeof capture.observedAt !== 'string' ||
          !Array.isArray(capture.products) || !capture.products.length ||
          capture.products.length > 100) {
        throw Error('Deze bron heeft meer dan 100 artikelen per winkel. Bewerk de bestaande CSV zelf.')
      }
      if (!capture.products.every(p => p && typeof p.id === 'string' &&
          typeof p.name === 'string' && ['g','kg','ml','l','piece'].includes(p.packUnit) &&
          (p.packAmount === null || typeof p.packAmount === 'number') &&
          (p.priceCents === null || Number.isSafeInteger(p.priceCents)) &&
          (p.packCount === undefined || p.packCount === null ||
            Number.isSafeInteger(p.packCount)) && typeof p.available === 'boolean')) {
        throw Error('De originele eigen winkelopname bevat onbekende productvelden.')
      }
      checked[capture.retailer] = capture
    }
    if (Object.keys(checked).length !== incoming.length) throw Error('Gekozen echte winkelopname ontbreekt.')
    // All records checked before the first visible field is replaced.
    for (const store of stores) {
      areas[store].replaceChildren()
      document.querySelector('[data-capture="' + store + '"]').value = checked[store]?.observedAt ?? ''
      if (!checked[store]) { addRow(store, false); continue }
      for (const product of checked[store].products) {
        addRow(store, false)
        const row = areas[store].lastElementChild
        const set = (name, value) => {
          row.querySelector('[data-field="' + name + '"]').value = String(value ?? '')
        }
        set('id', product.id)
        set('name', product.name)
        set('packAmount', product.packAmount)
        set('packUnit', product.packUnit)
        set('packCount', product.packCount)
        set('priceEuro', product.priceCents === null ? '' :
          Math.floor(product.priceCents / 100) + ',' +
          String(product.priceCents % 100).padStart(2, '0'))
        set('available', product.available ? 'true' : 'false')
      }
    }
    mode.value = incoming.length === 2 ? 'both' : incoming[0].retailer
    updateMode()
    removeReview()
    setStatus('Bestaande eigen werkelijke opname(n) geladen voor menselijke correctie. Oorspronkelijke opnametijden zijn ongewijzigd. Pas een prijs of datum alleen aan na werkelijke hercontrole van het artikel/de opname. Kies daarna Neem mijn echte winkelopname(s) over; oude artikelkoppelingen blijven ingetrokken.')
    document.querySelector('#manual-observations').scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Geen veilig bronconcept gemaakt.', 'warning')
  }
})

function updateMode() {
  for (const store of stores) {
    const panel = document.querySelector('[data-manual-store="' + store + '"]')
    panel.hidden = !selectedStores().includes(store)
  }
}
mode.addEventListener('change', () => { updateMode(); removeReview() })
updateMode()
for (const store of stores) {
  document.querySelector('[data-add-product="' + store + '"]').addEventListener('click', () => addRow(store))
  addRow(store, false)
}
// Searching the already-confirmed *physical demand* must not revoke an
// accepted original store capture. Only actual source form edits do that.
for (const eventName of ['input', 'change']) {
  document.querySelector('#manual-observations').addEventListener(eventName, event => {
    if (event.target instanceof Element &&
        event.target.closest('#manual-demand-context')) return
    removeReview()
  })
}
// Blank rows only, no sample IDs, generated prices, implied user observations,
// or timestamp defaults.
