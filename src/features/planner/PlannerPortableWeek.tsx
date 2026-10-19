import { useRef, useState } from 'react'
import type { PlannerPreferences } from '../../domain/plannerPreferences.ts'
import { exportOwnedPlannerWeek, previewOwnedPlannerWeek, PORTABLE_PLANNER_MAX_BYTES } from './plannerPortableBackup.ts'
import './plannerPortableWeek.css'

export function PlannerPortableWeek({ preferences, days, recipeIds, onRestore, storageProtected }: {
  preferences: PlannerPreferences
  days: readonly string[]
  recipeIds: readonly string[]
  onRestore: (value: PlannerPreferences) => void
  storageProtected: boolean
}) {
  const [candidate, setCandidate] = useState<{ raw: string; value: PlannerPreferences } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)
  function download() {
    try {
      const raw = exportOwnedPlannerWeek(preferences, days, recipeIds)
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url; link.download = 'supa-mijn-weekplanning.json'
        document.body.append(link); try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Weekkeuzes en eigen weekbudget gedownload. Bewaar je eigen recepten afzonderlijk.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Download mislukt.') }
  }
  async function open(file?: File) {
    if (!file) return
    const version = ++revision.current
    setCandidate(null); setBusy(true); setMessage('')
    try {
      if (!file.size || file.size > PORTABLE_PLANNER_MAX_BYTES) throw Error('Kies een JSON-bestand van maximaal 64 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const value = previewOwnedPlannerWeek(raw, days, recipeIds)
      if (version === revision.current) {
        setCandidate({ raw, value })
        setMessage('Controleer de dagen, recepten en je budget vóór je de weekplanning vervangt.')
      }
    } catch (error) {
      if (version === revision.current) setMessage(error instanceof Error ? error.message : 'Ongeldige weekplanning.')
    } finally { if (version === revision.current) setBusy(false) }
  }
  function restore() {
    if (!candidate || busy || storageProtected) return
    try {
      const chosen = previewOwnedPlannerWeek(candidate.raw, days, recipeIds)
      onRestore(chosen); setCandidate(null)
      setMessage('Weekplanning overgenomen. Controleer de nieuwe week; prijzen zijn nooit meegestuurd.')
    } catch (error) {
      setCandidate(null); setMessage(error instanceof Error ? error.message : 'Herstellen geweigerd.')
    }
  }
  return <section className="planner-portable-week" aria-label="Weekplanning privé bewaren en herstellen">
    <h3>Mijn weekplanning meenemen</h3>
    <p>Bewaar of herstel dagen, recepten en je budget lokaal. Geen winkelprijzen, bronopnames of besparingsclaims.
      Importeer eigen recepten eerst via de aparte receptenbackup.</p>
    <div className="planner-portable-week__actions">
      <button type="button" className="ghost-button" onClick={download}>Download weekplanning (JSON)</button>
      <label>Open weekplanning (JSON, max. 64 kB)
        <input type="file" accept=".json,application/json" disabled={busy || storageProtected}
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void open(file) }} />
      </label>
    </div>
    {storageProtected && <p role="alert">Planner-opslag beschermd of elders gewijzigd; herstellen blijft uitgeschakeld.</p>}
    {candidate && !storageProtected && <div className="planner-portable-week__preview">
      <strong>Voorgestelde nieuwe weekplanning</strong>
      <p>{candidate.value.activeDays.length} van {days.length} dagen actief · weekbudget
        {' '}{new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(candidate.value.budget)}</p>
      <ul>{days.map(day => <li key={day}><strong>{day}</strong> — {candidate.value.recipeByDay[day]}
        {' '}{candidate.value.activeDays.includes(day) ? '(actief)' : '(niet actief)'}</li>)}</ul>
      <div className="planner-portable-week__actions">
        <button type="button" onClick={restore}>Bevestig en herstel deze planning</button>
        <button type="button" className="ghost-button" onClick={() => {
          revision.current++; setCandidate(null); setMessage('Herstel geannuleerd. Bestaande week behouden.')
        }}>Annuleren</button>
      </div>
    </div>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
