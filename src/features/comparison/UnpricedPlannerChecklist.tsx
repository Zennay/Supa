import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { exportUnpricedProgress, importUnpricedProgress, unpricedProgressMaxBytes, unpricedProgressStorageKey } from './unpricedPlannerProgress.ts'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'
import './unpricedPlannerChecklist.css'

type ChecklistProps = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  onOpenPriceImport?: () => void
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
// Portable TXT must never use grouping (1.250 is ambiguous with 1.25), nor
// silently round decimal quantities. The existing strict importer decides
// whether every original amount is physically admissible.
const portableQuantity = (item: DemandRow) =>
  item.amount === null ? 'hoeveelheid nog controleren (' + item.unit + ')' :
    String(item.amount).replace('.', ',') + ' ' + (unitLabels[item.unit] ?? item.unit)

/**
 * The exact physical week demand, independent of either supermarket.
 * No sample product, inferred SKU, price, license or retailer observation.
 */
export function UnpricedPlannerChecklist({ plan, recipes, activeDays, onOpenPriceImport }: ChecklistProps) {
  const [progress, setProgress] = useState<{ identity: string; checked: Record<string, boolean> }>({ identity: '', checked: {} })
  const [backupMessage, setBackupMessage] = useState('')
  const currentDemand = useRef('')
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
  currentDemand.current = demandIdentity
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

  const completed = items.filter(item => checked[itemKey(item)]).length
  const visible = items.filter(item => !openOnly || !checked[itemKey(item)])
  const copyKey = JSON.stringify([demandIdentity, checked, openOnly])
  const copy = prepared?.key === copyKey ? prepared.text : null

  const shoppingText = () => [
    'Supa · mijn weekboodschappen · zonder winkelprijzen',
    openOnly ? 'Alleen nog te kopen ingrediënten; dit is niet het hele weekmandje.' :
      'Volledig geselecteerd weekmandje inclusief afgevinkte ingrediënten.',
    ...(visible.length ? visible.map(item =>
      (checked[itemKey(item)] ? '☑ ' : '☐ ') + item.label + ' · ' + portableQuantity(item)) :
      ['Alle boodschappen zijn afgevinkt.']),
    'Geen supermarktproduct of actuele prijs gekoppeld.',
  ].join('\n')

  function prepareCopy() {
    setPrepared({ key: copyKey, text: shoppingText() })
  }
  function openWithCurrentDemand() {
    if (error || !items.length) return
    try {
      // Preserve canonical ingredient IDs, selected recipe identity, exact
      // amounts and actual meal count. The TXT export remains available for
      // manual editing, but it deliberately cannot preserve those identities.
      const content = exportPrivatePlannerWeek(plan, recipes, activeDays)
      if (!window.confirm(
        'Open jouw geselecteerde Planner-week in de privé-mappingwizard? Daar controleer en bevestig je eerst ' +
        'de oorspronkelijke fysieke ingrediënten; winkelproducten en prijzen worden niet overgenomen.')) return
      window.sessionStorage.setItem('supa:private-planner-week-handoff:v1', content)
      window.location.assign('/private-basket-mapping.html')
    } catch {
      setBackupMessage('Het exacte Planner-weekmenu kan niet direct worden overgedragen. ' +
        'Controleer je recepten en hoeveelheden of download een eigen JSON/TXT-bestand.')
    }
  }

  function downloadProgress() {
    if (error || !items.length) return
    try {
      const content = exportUnpricedProgress(demandIdentity, keys, checked)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-weeklijst-afvinkingen-prive.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setBackupMessage('Privéback-up gedownload. Alleen jouw afvinkingen en de exacte weekboodschappen, geen winkelprijzen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setBackupMessage('Back-up niet gemaakt. Controleer je weekmenu en de grootte van je lijst.')
    }
  }

  async function restoreProgress(file?: File) {
    if (!file || error || !items.length) return
    const targetIdentity = demandIdentity
    try {
      if (!file.size || file.size > unpricedProgressMaxBytes)
        throw new Error('Het bestand is leeg of groter dan 128 kB.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (currentDemand.current !== targetIdentity)
        throw new Error('Het weekmenu is tijdens import veranderd. Geen afvinkingen hersteld.')
      const restored = importUnpricedProgress(raw, targetIdentity, keys)
      if (!window.confirm('Herstel de afvinkingen voor exact deze weekboodschappen? De huidige vinkjes worden vervangen; er komen geen prijzen of winkelproducten bij.')) return
      if (currentDemand.current !== targetIdentity) return
      setProgress({ identity: targetIdentity, checked: restored })
      setPrepared(null)
      setBackupMessage('Afvinkingen hersteld voor exact hetzelfde weekmenu en dezelfde hoeveelheden.')
    } catch (err) {
      setBackupMessage(err instanceof Error ? err.message : 'De privéback-up is ongeldig; je vinkjes zijn niet veranderd.')
    }
  }

  async function downloadUnpricedCsv() {
    if (error || !items.length) return
    try {
      // Keep the spreadsheet exporter out of the ordinary offline-list bundle.
      const { exportUnpricedPlannerCsv } = await import('./unpricedPlannerCsv.ts')
      const csv = exportUnpricedPlannerCsv(items, checked, openOnly)
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = openOnly ? 'supa-planner-nog-te-kopen-ongeprijsd.csv' :
          'supa-planner-weekmandje-ongeprijsd.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setBackupMessage('CSV lokaal gedownload: fysieke Planner-vraag zonder verzonnen winkelproducten of prijzen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'De ongeprijsde CSV kon niet veilig worden gemaakt.')
    }
  }

  function downloadUnpricedList() {
    if (error || !items.length) return
    const url = URL.createObjectURL(new Blob([shoppingText()], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = openOnly ? 'supa-planner-nog-te-kopen-zonder-prijzen.txt' :
        'supa-planner-weekboodschappen-zonder-prijzen.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  return (
    <section className="unpriced-planner-checklist" aria-label="Mijn ongeprijsde Planner-boodschappenlijst">
      <div className="unpriced-planner-checklist__intro">
        <span className="eyebrow">Direct uit jouw Planner · geen supermarkt nodig</span>
        <h3>Mijn weekboodschappen zonder winkelprijzen</h3>
        <p>Dezelfde samengestelde hoeveelheden als in de mandvergelijking,
          zonder een winkel of prijs te verzinnen. Ook bruikbaar zolang echte winkeldata ontbreken.
          Vinkjes blijven lokaal beschikbaar zolang dit browsertabblad open is,
          ook bij herladen van dit browsertabblad. Afvinkingen worden alleen in je eigen tabopslag bewaard;
          je kunt ze privé downloaden en op een ander apparaat voor exact hetzelfde weekmenu herstellen.
          Download ook de TXT-lijst om een eigen leesbaar overzicht handmatig in de privévergelijker te importeren.</p>
      </div>
      {error ? <p role="status" className="unpriced-planner-checklist__note">{error}</p> : (
        <>
          <div className="unpriced-planner-checklist__actions">
            <strong role="status">{completed} van {items.length} boodschappen afgevinkt</strong>
            <progress className="unpriced-planner-checklist__progress" value={completed}
              max={items.length} aria-label="Voortgang ongeprijsde weekboodschappen" />
            <label><input type="checkbox" checked={openOnly}
              onChange={event => setOpenOnly(event.currentTarget.checked)} />
              Alleen nog te kopen</label>
            <button type="button" className="ghost-button" onClick={() => {
              if (completed === items.length) return
              if (!window.confirm('Alle ongeprijsde ingrediënten in je huidige weeklijst afvinken?')) return
              setProgress({ identity: demandIdentity, checked:
                Object.fromEntries(keys.map(key => [key, true])) })
              setPrepared(null)
              setBackupMessage('Alle fysieke weekboodschappen afgevinkt, niet als betaald geregistreerd.')
            }}>Alles afvinken</button>
            <button type="button" className="ghost-button" onClick={() => {
              setProgress({ identity: demandIdentity, checked: {} })
              setPrepared(null)
              setBackupMessage('Alle vinkjes voor dit weekmenu gewist.')
            }}>Wis vinkjes</button>
            <button type="button" className="ghost-button" onClick={prepareCopy}>
              Toon kopieerbare weeklijst
            </button>
            <button type="button" className="ghost-button" onClick={downloadProgress}>
              Download afvinkingen (JSON)
            </button>
            <label className="unpriced-planner-checklist__upload">
              Herstel afvinkingen (JSON)
              <input type="file" accept=".json,application/json"
                aria-label="Kies een privéback-up van deze exacte weeklijst"
                onChange={event => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  void restoreProgress(file)
                }} />
            </label>
            <button type="button" className="ghost-button" onClick={downloadUnpricedList}>
              Download weekboodschappen (TXT)
            </button>
            <button type="button" className="ghost-button" onClick={() => void downloadUnpricedCsv()}>
              Download weekboodschappen (CSV)
            </button>
            {onOpenPriceImport && <button type="button" className="ghost-button" onClick={onOpenPriceImport}>
              Vergelijk mijn weekmandje met eigen PLUS/Deka-prijzen
            </button>}
            <button type="button" className="ghost-button" onClick={openWithCurrentDemand}>
              Neem exact weekmenu mee naar privévergelijker
            </button>
            <a className="ghost-button" href="/private-basket-mapping.html" target="_blank" rel="noopener noreferrer">
              Open privévergelijker voor mijn TXT-lijst
            </a>
          </div>
          {backupMessage && <p role="status" className="unpriced-planner-checklist__note">{backupMessage}</p>}
          <div className="unpriced-planner-checklist__rows">
            {visible.length ? visible.map(item => (
              <label key={itemKey(item)} className="unpriced-planner-checklist__item">
                <input type="checkbox" checked={Boolean(checked[itemKey(item)])}
                  onChange={event => {
                    const selected = event.currentTarget.checked
                    const key = itemKey(item)
                    setProgress({ identity: demandIdentity, checked: { ...checked, [key]: selected } })
                  setPrepared(null)
                  }} />
                <span><strong>{item.label}</strong><small>{quantity(item)}</small></span>
              </label>
            )) : <p role="status">Alle boodschappen afgevinkt voor deze week.</p>}
          </div>
          {copy !== null && <div className="unpriced-planner-checklist__copy">
            <p>Deze kopie is alleen voor de huidige gekozen lijst. Selecteer en kopieer de tekst.</p>
            <textarea readOnly rows={Math.min(visible.length + 4, 15)}
              aria-label="Kopieer mijn ongeprijsde weekboodschappen"
              value={copy} onFocus={event => event.currentTarget.select()} />
          </div>}
        </>
      )}
    </section>
  )
}
