import { useRef, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { createCompleteWeekBackup, readCompleteWeekBackup } from './completeWeekBackup.ts'
import { storageKey, type Item } from './ownExtraGroceriesStorage.ts'
import { importUnpricedProgress, unpricedProgressStorageKey } from './unpricedPlannerProgress.ts'

/** A single portable personal week-checklist, NEVER a product/price source. */
export function CompleteWeekBackupControls({ identity, plan, recipes, activeDays,
  extras, currentRaw, locked, onRestore }: {
  identity: string
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  extras: readonly Item[]
  currentRaw: string | null
  locked: boolean
  onRestore: (items: Item[], savedRaw: string) => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useRef(identity)
  current.current = identity
  function physicalWeek() {
    const demand = activeDays.length ? aggregatePlanIngredients(plan, recipes, activeDays) : []
    const keys = demand.map(item => JSON.stringify([item.id, item.label, item.amount, item.unit]))
    return { keys, demandIdentity: JSON.stringify([activeDays, keys]) }
  }
  function download() {
    const selected = identity
    try {
      const { keys, demandIdentity } = physicalWeek()
      const raw = window.sessionStorage.getItem(unpricedProgressStorageKey(demandIdentity))
      const checked = raw ? importUnpricedProgress(raw, demandIdentity, keys) : {}
      if (selected !== current.current) throw Error('Weekmenu gewijzigd.')
      const json = createCompleteWeekBackup(identity, demandIdentity, keys, extras, checked)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-complete-weekboodschappen-prive-backup.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Eén privéback-up gemaakt: Planner-vinkjes en eigen extras. Geen winkelprijzen of bronrechten.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'De complete back-up kon niet worden gemaakt.')
    }
  }
  async function restore(file?: File) {
    if (!file || locked || busy) return
    const selected = identity
    setBusy(true)
    try {
      if (file.size === 0 || file.size > 256000)
        throw Error('Gebruik een complete week-back-up van maximaal 256 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (selected !== current.current) throw Error('Weekmenu gewijzigd tijdens het inlezen.')
      const { keys, demandIdentity } = physicalWeek()
      const recovered = readCompleteWeekBackup(raw, selected, demandIdentity, keys)
      if (!window.confirm('Herstel alle eigen extra artikelen en Planner-vinkjes voor exact deze week? De bestaande waarden worden na jouw toestemming vervangen; er komen GEEN winkelprijzen of productgoedkeuringen bij.')) return
      if (selected !== current.current) throw Error('Weekmenu gewijzigd; niets hersteld.')
      const extrasKey = storageKey(selected)
      const oldExtras = window.sessionStorage.getItem(extrasKey)
      if (oldExtras !== currentRaw) throw Error('Deze tablijst werd gewijzigd; niets hersteld.')
      const plannerKey = unpricedProgressStorageKey(demandIdentity)
      const savedExtras = JSON.stringify({ schema: 'supa-extra-v1', identity: selected, items: recovered.items })
      // No partial restore: write extras first, rollback if Planner write fails.
      window.sessionStorage.setItem(extrasKey, savedExtras)
      try { window.sessionStorage.setItem(plannerKey, recovered.progressFile) }
      catch (cause) {
        if (oldExtras === null) window.sessionStorage.removeItem(extrasKey)
        else window.sessionStorage.setItem(extrasKey, oldExtras)
        throw cause
      }
      onRestore(recovered.items, savedExtras)
      window.dispatchEvent(new Event('supa:private-planner-ticks-restored'))
      setMessage('Complete week in dit tabblad hersteld: ' + recovered.items.length +
        ' eigen extras en ' + Object.keys(recovered.checked).length +
        ' Planner-vinkjes; oorspronkelijke winkelprijzen onveranderd.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Onbekende of ongeldige weekback-up geweigerd.')
    } finally { setBusy(false) }
  }
  return <section className="unpriced-planner-checklist__extras" aria-label="Complete privéweekback-up">
    <h4>Complete boodschappenlijst meenemen naar een andere browser</h4>
    <p>Gebruik eerst hetzelfde weekmenu op het andere apparaat. Dit bestand bevat
      uitsluitend afvinkingen en persoonlijke extra boodschappen, geen supermarktdata,
      winkelprijzen, recepten of toestemmingen.</p>
    <div className="unpriced-planner-checklist__actions">
      <button type="button" onClick={download}>Download complete weekstatus (JSON)</button>
      <label className="unpriced-planner-checklist__upload">Herstel complete weekstatus (JSON)
        <input type="file" accept=".json,application/json" disabled={busy || locked}
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void restore(file)
          }} />
      </label>
    </div>
    {message && <p role="status">{message}</p>}
  </section>
}
