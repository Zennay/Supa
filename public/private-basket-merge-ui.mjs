/* Explicit user-reviewed consolidation: same name OR individually chosen rows.
 * Uses Supa's canonical exact decimal unit reducer, no SKU equivalence guesses.
 */
const lines = document.querySelector('#lines')
const status = document.querySelector('#status')
const byName = document.querySelector('#merge-ingredients')
const bySelection = document.querySelector('#merge-selected')
const family = unit => ['g', 'kg'].includes(unit) ? 'mass'
  : ['ml', 'l'].includes(unit) ? 'volume'
    : unit === 'piece' ? 'piece' : null
const quantity = raw => {
  if (!/^(?:0|[1-9]\d*)(?:[.,]\d{1,6})?$/.test(raw)) return null
  const amount = Number(raw.replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 && amount <= 100000 ? amount : null
}
function message(value, isError = false) {
  status.textContent = value
  status.className = 'notice' + (isError ? ' warning' : '')
}
function merge(groups, selected = false) {
  try {
    const operations = []
    let unknown = 0
    for (const group of groups) {
      if (group.length < 2) continue
      const units = group.map(row => row.querySelector('.unit').value)
      if (!units.every(unit => family(unit) && family(unit) === family(units[0]))) {
        throw Error('Geselecteerde ingrediënten hebben verschillende fysieke eenheidsfamilies; behoud ze afzonderlijk.')
      }
      const quantities = group.map((row, index) => ({
        unit: units[index],
        amount: quantity(row.querySelector('.amount').value.trim()),
      }))
      if (quantities.some(item => item.amount === null)) {
        if (selected) throw Error('Vul voor alle geselecteerde ingrediënten een geldige metrische hoeveelheid in.')
        unknown += group.length
        continue
      }
      const detail = { quantities, resultUnit: units[0], result: null }
      document.dispatchEvent(new CustomEvent('supa:sum-private-demand', { detail }))
      if (typeof detail.result !== 'number' || !Number.isFinite(detail.result) ||
          detail.result <= 0 || detail.result > 100000) {
        throw Error('Deze fysieke hoeveelheden kunnen niet exact worden samengevoegd. Geen ingrediëntregels gewijzigd.')
      }
      operations.push({ keep: group[0], remove: group.slice(1), amount: detail.result })
    }
    if (operations.length === 0) {
      message(unknown ? 'Vul de ontbrekende hoeveelheden in voordat je deze ingrediënten samenvoegt.'
        : 'Er zijn geen geschikte ingrediëntgroepen om samen te voegen.', true)
      return
    }
    const removed = operations.reduce((sum, op) => sum + op.remove.length, 0)
    const main = operations[0].keep.querySelector('.label').value.trim()
    const warning = selected
      ? 'Deze actie houdt de naam "' + main +
        '" van het eerste geselecteerde ingrediënt aan. Controleer of alle geselecteerde items werkelijk één fysieke ingrediëntbehoefte vormen. '
      : 'Alleen identiek genoemde ingrediënten met dezelfde fysieke eenheid worden samengevoegd. '
    if (!window.confirm('Voeg ' + removed + ' ingrediëntregel(s) samen? ' + warning +
        'Alle bijbehorende winkelartikelkeuzes worden gewist. Kies en controleer daarna de PLUS- en DekaMarkt-SKU opnieuw.')) return
    // Atomic mutation only after every group has been calculated and reviewed.
    for (const op of operations) {
      op.keep.querySelector('.amount').value = String(op.amount)
      for (const select of op.keep.querySelectorAll('[data-store]')) select.value = ''
      const mark = op.keep.querySelector('[data-merge-selected]')
      if (mark) mark.checked = false
      for (const row of op.remove) row.remove()
    }
    document.dispatchEvent(new Event('supa:private-ingredient-merged'))
    message(removed + ' ingrediëntregel(s) exact fysiek samengevoegd. ' +
      'Controleer de behouden naam en bevestig beide werkelijke winkel-SKU’s opnieuw.' +
      (unknown ? ' Regels met onbekende hoeveelheid bleven apart.' : ''))
  } catch (error) {
    message(error instanceof Error ? error.message : 'Samenvoegen geweigerd zonder wijzigingen.', true)
  }
}
byName.addEventListener('click', () => {
  const groups = new Map()
  for (const row of lines.querySelectorAll('.ingredient')) {
    const label = row.querySelector('.label').value.trim()
    const unit = row.querySelector('.unit').value
    if (!label || !family(unit)) continue
    const key = JSON.stringify([label.toLocaleLowerCase('nl'), family(unit)])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  merge([...groups.values()])
})
bySelection.addEventListener('click', () => {
  const chosen = Array.from(lines.querySelectorAll('.ingredient')).filter(row =>
    row.querySelector('[data-merge-selected]')?.checked)
  if (chosen.length < 2) {
    message('Selecteer minimaal twee fysieke ingrediëntregels om bewust samen te voegen.', true)
    return
  }
  merge([chosen], true)
})
