import { useMemo, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import './unpricedPlannerChecklist.css'

type ChecklistProps = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}
type DemandRow = ReturnType<typeof aggregatePlanIngredients>[number]
const unitLabels: Record<string, string> = {
  g: 'gram', kg: 'kg', ml: 'ml', l: 'liter', piece: 'stuks',
}
const itemKey = (item: DemandRow) => JSON.stringify([
  item.id, item.label, item.amount, item.unit,
])
const quantity = (item: DemandRow) =>
  (item.amount === null ? 'hoeveelheid onbekend' :
    item.amount.toLocaleString('nl-NL') + ' ' + (unitLabels[item.unit] ?? item.unit))

/**
 * The exact physical week demand, independent of either supermarket.
 * No sample product, inferred SKU, price, license or retailer observation.
 */
export function UnpricedPlannerChecklist({ plan, recipes, activeDays }: ChecklistProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [openOnly, setOpenOnly] = useState(false)
  const [prepared, setPrepared] = useState<{ key: string; text: string } | null>(null)
  const result = useMemo(() => {
    if (!activeDays.length) return { items: [] as DemandRow[], error: 'Selecteer eerst dagen in Planner.' }
    try {
      const items = aggregatePlanIngredients(plan, recipes, activeDays)
      return items.length
        ? { items, error: '' }
        : { items, error: 'Geen fysieke ingrediënten in dit weekmenu.' }
    } catch {
      return { items: [] as DemandRow[], error: 'Controleer je gekozen recepten en hoeveelheden in Planner.' }
    }
  }, [plan, recipes, activeDays])

  const { items, error } = result
  const demandIdentity = JSON.stringify([activeDays, items.map(itemKey)])
  const completed = items.filter(item => checked[itemKey(item)]).length
  const visible = items.filter(item => !openOnly || !checked[itemKey(item)])
  const copy = prepared?.key === JSON.stringify([demandIdentity, checked]) ? prepared.text : null

  function prepareCopy() {
    setPrepared({
      key: JSON.stringify([demandIdentity, checked]),
      text: [
        'Supa · mijn weekboodschappen · zonder winkelprijzen',
        ...items.map(item =>
          (checked[itemKey(item)] ? '☑ ' : '☐ ') + item.label + ' · ' + quantity(item)),
        'Geen supermarktproduct of actuele prijs gekoppeld.',
      ].join('\n'),
    })
  }

  return (
    <section className="unpriced-planner-checklist" aria-label="Mijn ongeprijsde Planner-boodschappenlijst">
      <div className="unpriced-planner-checklist__intro">
        <span className="eyebrow">Direct uit jouw Planner · geen supermarkt nodig</span>
        <h3>Mijn weekboodschappen zonder winkelprijzen</h3>
        <p>Dezelfde samengestelde hoeveelheden als in de mandvergelijking,
          zonder een winkel of prijs te verzinnen. Ook bruikbaar zolang echte winkeldata ontbreken.
          Vinkjes blijven lokaal beschikbaar zolang dit browsertabblad open is,
          ook als je tussen Planner en Lijst wisselt. Er wordt niets verstuurd of opgeslagen.</p>
      </div>
      {error ? <p role="status" className="unpriced-planner-checklist__note">{error}</p> : (
        <>
          <div className="unpriced-planner-checklist__actions">
            <strong role="status">{completed} van {items.length} boodschappen afgevinkt</strong>
            <label><input type="checkbox" checked={openOnly}
              onChange={event => setOpenOnly(event.currentTarget.checked)} />
              Alleen nog te kopen</label>
            <button type="button" className="ghost-button" onClick={() => {
              setChecked({})
              setPrepared(null)
            }}>Wis vinkjes</button>
            <button type="button" className="ghost-button" onClick={prepareCopy}>
              Toon kopieerbare weeklijst
            </button>
          </div>
          <div className="unpriced-planner-checklist__rows">
            {visible.length ? visible.map(item => (
              <label key={itemKey(item)} className="unpriced-planner-checklist__item">
                <input type="checkbox" checked={Boolean(checked[itemKey(item)])}
                  onChange={event => {
                    const selected = event.currentTarget.checked
                    const key = itemKey(item)
                    setChecked(current => ({ ...current, [key]: selected }))
                  }} />
                <span><strong>{item.label}</strong><small>{quantity(item)}</small></span>
              </label>
            )) : <p role="status">Alle boodschappen afgevinkt voor deze week.</p>}
          </div>
          {copy !== null && <div className="unpriced-planner-checklist__copy">
            <p>Deze kopie is alleen voor de huidige gekozen lijst. Selecteer en kopieer de tekst.</p>
            <textarea readOnly rows={Math.min(items.length + 3, 15)}
              aria-label="Kopieer mijn ongeprijsde weekboodschappen"
              value={copy} onFocus={event => event.currentTarget.select()} />
          </div>}
        </>
      )}
    </section>
  )
}
