import { useEffect, useMemo, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { groupShoppingByRecipe } from '../shopping-list/shoppingRecipeGroups.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { exportUnpricedProgress, importUnpricedProgress, unpricedProgressStorageKey } from './unpricedPlannerProgress.ts'
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
  const [progress, setProgress] = useState<{ identity: string; checked: Record<string, boolean> }>({ identity: '', checked: {} })
  const [backupMessage, setBackupMessage] = useState('')
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
  const keys = items.map(itemKey)
  const storageKey = unpricedProgressStorageKey(demandIdentity)
  const checked = progress.identity === demandIdentity ? progress.checked : {}

  useEffect(() => {
    let restored: Record<string, boolean> = {}
    try {
      const saved = window.sessionStorage.getItem(storageKey)
      if (saved) restored = importUnpricedProgress(saved, demandIdentity, keys)
    } catch {
      // A corrupt or unrelated tab snapshot must never check a different list.
      setBackupMessage('Oud herstelpunt niet bruikbaar; je huidige weeklijst blijft ongehinderd beschikbaar.')
    }
    setProgress({ identity: demandIdentity, checked: restored })
  }, [demandIdentity, storageKey])

  useEffect(() => {
    if (progress.identity !== demandIdentity) return
    try {
      window.sessionStorage.setItem(
        storageKey, exportUnpricedProgress(demandIdentity, keys, progress.checked))
    } catch {
      setBackupMessage('Automatisch bewaren is niet beschikbaar in deze browser. Download een privéback-up om je vinkjes te bewaren.')
    }
  }, [progress, demandIdentity, storageKey])

  // A deliberate complete-week JSON restore writes the exact validated
  // existing Planner progress file, then signals the mounted checklist to
  // reload. A storage event does not fire in the tab performing the write.
  useEffect(() => {
    const reload = () => {
      try {
        const raw = window.sessionStorage.getItem(storageKey)
        const recovered = raw ? importUnpricedProgress(raw, demandIdentity, keys) : {}
        setProgress({ identity: demandIdentity, checked: recovered })
        setBackupMessage('Je Planner-afvinkingen zijn uit de complete privéweekback-up hersteld.')
      } catch {
        setBackupMessage('De aangeleverde Planner-vinkjes kunnen niet worden gelezen; het zichtbare overzicht is behouden.')
      }
    }
    window.addEventListener('supa:private-planner-ticks-restored', reload)
    return () => window.removeEventListener('supa:private-planner-ticks-restored', reload)
  }, [demandIdentity, storageKey])

  const completed = items.filter(item => checked[itemKey(item)]).length
  const recipeGroups = groupShoppingByRecipe(items, plan, recipes, activeDays)

  return (
    <section className="unpriced-planner-checklist" aria-label="Mijn ongeprijsde Planner-boodschappenlijst">
      <div className="unpriced-planner-checklist__intro" data-figma-node="3342:4815">
        <h3>Boodschappenlijst</h3>
      </div>
      {error ? <p role="status" className="unpriced-planner-checklist__note">{error}</p> : (
        <>
          <p className="unpriced-planner-checklist__count" role="status">{completed} van {items.length} afgevinkt</p>
          {backupMessage && <p role="status" className="unpriced-planner-checklist__note">{backupMessage}</p>}
          <div className="unpriced-planner-checklist__rows" aria-label="Boodschappen per gepland recept">
            {items.length ? recipeGroups.map(group => (
              <section key={group.key} className="unpriced-planner-checklist__recipe-group"
                aria-label={group.title}>
                <header className="unpriced-planner-checklist__group-title">
                  <h4>{group.title}</h4>
                  <span>{group.lines.length} {group.lines.length === 1 ? 'ingrediënt' : 'ingrediënten'}</span>
                </header>
                {group.lines.map(item => (
                  <label key={itemKey(item)} className="unpriced-planner-checklist__item">
                    <input type="checkbox" checked={Boolean(checked[itemKey(item)])}
                      onChange={event => {
                        const selected = event.currentTarget.checked
                        const key = itemKey(item)
                        setProgress({ identity: demandIdentity, checked: { ...checked, [key]: selected } })
                      }} />
                    <span className="unpriced-planner-checklist__thumb" aria-hidden="true">
                      {item.label.trim().slice(0, 1).toLocaleUpperCase('nl') || '•'}
                    </span>
                    <span className="unpriced-planner-checklist__item-copy">
                      <strong>{item.label}</strong><small>{quantity(item)}</small>
                    </span>
                  </label>
                ))}
              </section>
            )) : <p role="status">Alle boodschappen afgevinkt voor deze week.</p>}
          </div>
        </>
      )}
    </section>
  )
}
