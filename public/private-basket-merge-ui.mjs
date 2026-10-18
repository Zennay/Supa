/* Explicit manual consolidation of equal-name physical ingredients.
 * Never equates differently named items, retailer IDs or prices.
 * Uses the canonical TypeScript decimal quantity reducer via a same-tab event.
 */
const button = document.querySelector('#merge-ingredients')
const container = document.querySelector('#lines')
const notice = document.querySelector('#status')
const family = unit => ['g', 'kg'].includes(unit) ? 'mass'
  : ['ml', 'l'].includes(unit) ? 'volume' : unit === 'piece' ? 'piece' : null
const validAmount = text => {
  if (!/^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/.test(text)) return null
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null
}
function message(text, warning = false) {
  notice.textContent = text
  notice.className = 'notice' + (warning ? ' warning' : '')
}
button.addEventListener('click', () => {
  try {
    const groups = new Map()
    for (const row of container.querySelectorAll('.ingredient')) {
      const label = row.querySelector('.label').value.trim()
      const unit = row.querySelector('.unit').value
      if (!label || !family(unit)) continue
      const key = JSON.stringify([label.toLocaleLowerCase('nl'), family(unit)])
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    const operations = []
    let unknown = 0
    for (const rows of groups.values()) {
      if (rows.length < 2) continue
      const quantities = rows.map(row => ({
        unit: row.querySelector('.unit').value,
        amount: validAmount(row.querySelector('.amount').value.trim()),
      }))
      if (quantities.some(q => q.amount === null)) {
        unknown += rows.length
        continue
      }
      const detail = { quantities, resultUnit: quantities[0].unit, result: null }
      document.dispatchEvent(new CustomEvent('supa:sum-private-demand', { detail }))
      if (typeof detail.result !== 'number' || !Number.isFinite(detail.result) ||
          detail.result <= 0 || detail.result > 100000) {
        throw Error('Deze hoeveelheden kunnen niet exact worden samengevoegd. Controleer de hoeveelheden en eenheden.')
      }
      operations.push({ main: rows[0], rest: rows.slice(1), amount: detail.result })
    }
    if (!operations.length) {
      message(unknown ? 'Vul eerst alle hoeveelheden van de herhaalde ingrediënten in.'
        : 'Geen herhaalde ingrediëntnamen met dezelfde fysieke eenheid gevonden.', true)
      return
    }
    const removed = operations.reduce((sum, op) => sum + op.rest.length, 0)
    if (!window.confirm('Voeg ' + removed + ' herhaalde ingrediëntregels met dezelfde naam samen? ' +
        'Supa telt de metrische hoeveelheden exact op, wist voor deze regels de gekozen winkelartikelen ' +
        'en vraagt om de juiste PLUS- en DekaMarkt-SKU opnieuw te bevestigen.')) return
    for (const op of operations) {
      op.main.querySelector('.amount').value = String(op.amount)
      for (const select of op.main.querySelectorAll('[data-store]')) select.value = ''
      for (const row of op.rest) row.remove()
    }
    document.dispatchEvent(new Event('supa:private-ingredient-merged'))
    message(removed + ' herhaalde regels samengevoegd. Controleer de fysieke hoeveelheid en ' +
      'kies de echte winkelproducten opnieuw.' +
      (unknown ? ' Regels met onbekende hoeveelheden zijn bewaard.' : ''))
  } catch (error) {
    message(error instanceof Error ? error.message : 'Samenvoegen is geweigerd zonder wijzigingen.', true)
  }
})
