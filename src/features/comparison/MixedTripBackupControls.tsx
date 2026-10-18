import { useRef, useState } from 'react'
import type { MixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import {
  saveMixedTripProgress, restoreMixedTripProgress,
  type MixedTripContext, type MixedTripSettings, type MixedTripRestore,
} from './mixedStoreTripProgress.ts'

/** A portable shopping-progress note, not a supermarket source, approval or
 * evidence claim. It never restores prices or bypasses the existing reviews.
 */
export function MixedTripBackupControls({
  context, settings, plan, checked, eligibleNow, onRestore,
}: {
  context: MixedTripContext
  settings: MixedTripSettings
  plan: MixedStoreShoppingPlan
  checked: ReadonlySet<string>
  eligibleNow: () => boolean
  onRestore: (value: MixedTripRestore) => void
}) {
  const [message, setMessage] = useState('')
  const importRevision = useRef(0)

  function saveFile() {
    if (!eligibleNow()) {
      setMessage('De bronopname is verlopen of opnieuw te controleren. Bewaar geen oude prijzen als actueel.')
      return
    }
    try {
      const data = saveMixedTripProgress(context, settings, checked)
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-mijn-winkelroute-afvinkingen.json'
        document.body.append(a)
        try { a.click() } finally { a.remove() }
        setMessage('Routekeuzes en afvinkingen lokaal opgeslagen. Dit is geen originele supermarktprijsbron.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kon de route niet bewaren.')
    }
  }

  async function loadFile(file?: File) {
    if (!file) return
    const version = ++importRevision.current
    setMessage('')
    try {
      if (file.size === 0 || file.size > 256_000)
        throw Error('Kies een niet-leeg routebestand van maximaal 256 kB.')
      if (!eligibleNow()) throw Error('Controleer eerst de actuele originele winkelopnames.')
      const data = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (version !== importRevision.current) return
      const next = restoreMixedTripProgress(data, context)
      if (!window.confirm(
        'Zet winkelroute, voorkeuren en afvinkingen voor exact dezelfde originele bronnen terug? Je huidige keuzes worden vervangen. Prijscontroles worden niet uit dit bestand hersteld.')) return
      if (version !== importRevision.current || !eligibleNow())
        throw Error('De winkelopnames zijn intussen gewijzigd of verlopen.')
      onRestore(next)
      setMessage('Dezelfde fysieke winkelroute en afvinkingen zijn teruggezet; oorspronkelijke winkelprijzen en persoonlijke bevestigingen blijven ongewijzigd.')
    } catch (error) {
      if (version === importRevision.current)
        setMessage(error instanceof Error ? error.message : 'Onbekend bestand. Bestaande keuzes zijn behouden.')
    }
  }

  return <section aria-label="Mijn eigen winkelroute en afvinkingen bewaren"
    className="mixed-store-route__backup">
    <h4>Neem je afvinkingen mee</h4>
    <p>Download de gekozen winkelroute en afvinkingen als privé-JSON. Herstel alleen
      tegen exact dezelfde originele winkelmomenten, productcodes, prijzen en Planner-vraag.
      Dit bestand bevat geen nieuwe prijzen of retailerrechten.</p>
    <div className="offline-price-workbench__actions">
      <button type="button" className="ghost-button" onClick={saveFile}>
        Bewaar winkelroute + afvinkingen (JSON)
      </button>
      <label>Herstel mijn winkelroute (JSON)
        <input type="file" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void loadFile(file)
        }} />
      </label>
    </div>
    <p aria-live="polite" role="status">{message}</p>
    <small>Opmerking: {checked.size} van {plan.lines.length} afvinkingen uit de huidige
      route worden opgeslagen. Dit bestand geeft nooit toestemming om een bron te
      gebruiken of prijzen als onafhankelijk geverifieerd te publiceren.</small>
  </section>
}
