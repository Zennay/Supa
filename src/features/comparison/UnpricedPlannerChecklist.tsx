import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import { groupShoppingByRecipe } from '../shopping-list/shoppingRecipeGroups.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import type { PersonalNoteDraft } from './plannerPersonalNotes.ts'
import { PlannerPersonalNoteTransfer } from './PlannerPersonalNoteTransfer.tsx'
import { exportUnpricedProgress, importUnpricedProgress, unpricedProgressMaxBytes, unpricedProgressStorageKey } from './unpricedPlannerProgress.ts'
import { exportPrivatePlannerWeek } from './exportPrivatePlannerWeek.ts'
import { exportUnpricedPlannerCsv } from './unpricedPlannerCsv.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import './unpricedPlannerChecklist.css'

type ChecklistProps = {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
  manualNotes?: readonly UnpricedShoppingNote[]
  onToggleManualNote?: (id: string) => void
  onOpenPriceImport?: () => void
  onOpenRecipes?: () => void
  onAddPersonalNotes?: (items: readonly PersonalNoteDraft[], expected: string) => string
}
type DemandRow = ReturnType<typeof aggregatePlanIngredients>[number]
const unitLabels: Record<string, string> = {
  g: 'gram', kg: 'kg', ml: 'ml', l: 'liter', piece: 'stuks',
}
const itemKey = (item: DemandRow) => JSON.stringify([
  item.id, item.label, item.amount, item.unit,
])
const quantity = (item: DemandRow) => {
  const amount = readablePlannerDemandAmount(item.amount)
  return amount === 'hoeveelheid nog controleren'
    ? 'hoeveelheid onbekend'
    : amount.replace('.', ',') + ' ' + (unitLabels[item.unit] ?? item.unit)
}
// Portable TXT must never use grouping (1.250 is ambiguous with 1.25), nor
// silently round decimal quantities. The existing strict importer decides
// whether every original amount is physically admissible.
const portableQuantity = (item: DemandRow) => {
  const amount = readablePlannerDemandAmount(item.amount)
  return amount === 'hoeveelheid nog controleren'
    ? 'hoeveelheid nog controleren (' + item.unit + ')'
    : amount.replace('.', ',') + ' ' + (unitLabels[item.unit] ?? item.unit)
}

/**
 * The exact physical week demand, independent of either supermarket.
 * No sample product, inferred SKU, price, license or retailer observation.
 */
export function UnpricedPlannerChecklist({ plan, recipes, activeDays, manualNotes = [], onToggleManualNote, onOpenPriceImport, onOpenRecipes, onAddPersonalNotes }: ChecklistProps) {
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
  const unresolvedPieces = items.filter(item => item.unit === 'piece' && item.amount === null)
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

  // A deliberate complete-week JSON restore writes the exact validated
  // existing Planner progress file, then signals the mounted checklist to
  // reload. A storage event does not fire in the tab performing the write.
  useEffect(() => {
    const reload = () => {
      try {
        const raw = window.sessionStorage.getItem(storageKey)
        const recovered = raw ? importUnpricedProgress(raw, demandIdentity, keys) : {}
        setProgress({ identity: demandIdentity, checked: recovered })
        setPrepared(null)
        setBackupMessage('Je Planner-afvinkingen zijn uit de complete privéweekback-up hersteld.')
      } catch {
        setBackupMessage('De aangeleverde Planner-vinkjes kunnen niet worden gelezen; het zichtbare overzicht is behouden.')
      }
    }
    window.addEventListener('supa:private-planner-ticks-restored', reload)
    return () => window.removeEventListener('supa:private-planner-ticks-restored', reload)
  }, [demandIdentity, storageKey])

  const completed = items.filter(item => checked[itemKey(item)]).length
  const visible = items.filter(item => !openOnly || !checked[itemKey(item)])
  const recipeGroups = groupShoppingByRecipe(visible, plan, recipes, activeDays)
  const handwritten = manualNotes.filter(note =>
    note && typeof note.id === 'string' && typeof note.label === 'string' &&
    note.label.length > 0 && note.label.length <= 140 &&
    ['Algemeen', 'PLUS', 'DekaMarkt'].includes(note.store) &&
    typeof note.done === 'boolean')
  const visibleHandwritten = handwritten.filter(note => !openOnly || !note.done)
  const safeHandwritten = (label: string) => label
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const copyKey = JSON.stringify([demandIdentity, checked, openOnly,
    handwritten.map(note => [note.id, note.label, note.store, note.done])])
  const activeCopyKey = useRef(copyKey)
  activeCopyKey.current = copyKey
  const copy = prepared?.key === copyKey ? prepared.text : null

  const shoppingText = () => [
    'Supa · mijn weekboodschappen · zonder winkelprijzen',
    openOnly ? 'Alleen nog te kopen ingrediënten; dit is niet het hele weekmandje.' :
      'Volledig geselecteerd weekmandje inclusief afgevinkte ingrediënten.',
    ...(visible.length ? visible.map(item =>
      (checked[itemKey(item)] ? '☑ ' : '☐ ') + item.label + ' · ' + portableQuantity(item)) :
      ['Alle boodschappen zijn afgevinkt.']),
    ...(visibleHandwritten.length ? ['', 'ZELF TOEGEVOEGDE BOODSCHAPPEN — niet in het Planner-mandje',
      ...visibleHandwritten.map(note => (note.done ? '☑ ' : '☐ ') +
        safeHandwritten(note.label) + ' [' + note.store + '] · prijs onbekend'),
    ] : []),
    'Geen supermarktproduct of actuele prijs gekoppeld. Handmatige artikelen blijven buiten het Planner- en winkelmandtotaal.',
  ].join('\n')

  function prepareCopy() {
    setPrepared({ key: copyKey, text: shoppingText() })
  }

  /** Text-only, explicit user action. Neither prices nor source files leave Supa
   * automatically; the native share sheet lets the user choose the destination. */
  async function shareCurrentWeek() {
    if (error || !items.length) return
    const expectedDemand = demandIdentity
    const expectedCopyKey = copyKey
    const content = shoppingText()
    if (new TextEncoder().encode(content).length > 120_000) {
      setBackupMessage('Weeklijst is te groot om mobiel te delen. Download het TXT-bestand.'); return
    }
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Mijn Supa-weekboodschappen (zonder prijzen)', text: content })
        if (currentDemand.current === expectedDemand)
          setBackupMessage('Weekboodschappen gedeeld via de door jou gekozen app. Er zijn geen winkelprijzen meegestuurd.')
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
        if (currentDemand.current === expectedDemand && activeCopyKey.current === expectedCopyKey)
          setBackupMessage('Weekboodschappen naar je klembord gekopieerd, zonder winkelprijzen.')
        return
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      // Denied permissions are normal on private browsing and insecure pages.
    }
    // Never silently fail when the OS/browser denies a native share or clipboard.
    if (currentDemand.current === expectedDemand && activeCopyKey.current === expectedCopyKey) {
      setPrepared({ key: expectedCopyKey, text: content })
      setBackupMessage('Delen of kopiëren is niet beschikbaar. Selecteer de tekst hieronder om zelf te kopiëren.')
    }
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
      window.location.assign(`${import.meta.env.BASE_URL}private-basket-mapping.html`)
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
    const expectedCopyKey = copyKey
    try {
      // Native mobile CSV share needs transient click activation: this tiny
      // existing exporter is already loaded rather than awaited after click.
      if (currentDemand.current !== demandIdentity || activeCopyKey.current !== expectedCopyKey)
        throw new Error('Het weekmenu of de afvinkingen zijn gewijzigd. Maak een nieuwe CSV.')
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

  /** Share the original exact, unpriced CSV as a local file on supported
   * phones. Missing SKU/prices remain blank; there is no remote Supa upload. */
  async function shareUnpricedCsv() {
    if (error || !items.length) return
    const expectedDemand = demandIdentity
    const expectedCopyKey = copyKey
    try {
      if (currentDemand.current !== expectedDemand || activeCopyKey.current !== expectedCopyKey) {
        setBackupMessage('Je weekmenu of vinkjes zijn veranderd. Gebruik de bijgewerkte CSV.')
        return
      }
      const csv = '\\uFEFF' + exportUnpricedPlannerCsv(items, checked, openOnly)
      const filename = openOnly ? 'supa-planner-nog-te-kopen-ongeprijsd.csv' :
        'supa-planner-weekmandje-ongeprijsd.csv'
      const file = new File([csv], filename, { type: 'text/csv;charset=utf-8' })
      if (typeof navigator.share === 'function' &&
          typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Supa · eigen ongeprijsde weekboodschappen' })
        if (currentDemand.current === expectedDemand)
          setBackupMessage('Je oorspronkelijke ongeprijsde CSV is gedeeld via de gekozen app.')
        return
      }
      if (currentDemand.current === expectedDemand && activeCopyKey.current === expectedCopyKey)
        await downloadUnpricedCsv()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (currentDemand.current === expectedDemand) {
        setBackupMessage('CSV delen is niet beschikbaar op dit apparaat. Gebruik Download weekboodschappen (CSV).')
      }
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
      <div className="unpriced-planner-checklist__intro" data-figma-node="3342:4815">
        <span className="eyebrow">Jouw geplande recepten · zonder winkelprijzen</span>
        <h3>Boodschappenlijst</h3>
        <p>Alle ingrediënten van jouw week, fysiek samengevoegd en per recept geordend.
          Gedeelde ingrediënten verschijnen slechts één keer. Onbekende prijzen blijven onbekend.</p>
        <details className="unpriced-planner-checklist__privacy">
          <summary>Opslag en privacy van mijn lijst</summary>
          <p>Vinkjes blijven in dit browsertabblad, ook na herladen. Met een privé-back-up
            kun je ze alleen voor exact dezelfde week op een ander apparaat herstellen.
            Er worden geen winkelproducten of prijzen verzonnen.</p>
        </details>
      </div>
      {unresolvedPieces.length > 0 && <div className="attention-card" role="status">
        <strong>{unresolvedPieces.length} stukhoeveelheid(en) vragen controle</strong>
        <p>{unresolvedPieces.slice(0, 4).map(item => item.label).join(', ')}
          {unresolvedPieces.length > 4 ? ' en andere ingrediënten' : ''}:
          een gedeeltelijk of onbekend aantal stuks is niet automatisch als
          gekocht winkelproduct bevestigd. De rest van je ongeprijsde lijst blijft bruikbaar.</p>
        {onOpenRecipes && <button type="button" className="ghost-button" onClick={onOpenRecipes}>
          Controleer in Recepten hoeveel hele stuks je nodig hebt
        </button>}
      </div>}
      {error ? <p role="status" className="unpriced-planner-checklist__note">{error}</p> : (
        <>
          <div className="unpriced-planner-checklist__actions">
            <strong role="status">{completed} van {items.length} boodschappen afgevinkt</strong>
            <progress className="unpriced-planner-checklist__progress" value={completed}
              max={items.length} aria-label="Voortgang ongeprijsde weekboodschappen" />
            <label><input type="checkbox" checked={openOnly}
              onChange={event => setOpenOnly(event.currentTarget.checked)} />
              Alleen nog te kopen</label>
            {onOpenPriceImport && <button type="button" className="ghost-button"
              onClick={onOpenPriceImport}>Vergelijk met eigen PLUS/Deka-prijzen</button>}
          </div>
          {onAddPersonalNotes && <PlannerPersonalNoteTransfer
            items={items} checked={checked} openOnly={openOnly} planKey={demandIdentity}
            notes={manualNotes} onImport={onAddPersonalNotes} />}
          <details className="unpriced-planner-checklist__advanced">
            <summary>Deel, exporteer of herstel mijn lijst</summary>
            <div className="unpriced-planner-checklist__actions">
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
            <button type="button" className="ghost-button" onClick={() => void shareCurrentWeek()}>
              Deel of kopieer mijn weekboodschappen
            </button>
            <button type="button" className="ghost-button" onClick={downloadUnpricedList}>
              Download weekboodschappen (TXT)
            </button>
            <button type="button" className="ghost-button" onClick={() => void downloadUnpricedCsv()}>
              Download weekboodschappen (CSV)
            </button>
            <button type="button" className="ghost-button" onClick={() => void shareUnpricedCsv()}>
              Deel ongeprijsde CSV met een andere app
            </button>
            <button type="button" className="ghost-button" onClick={openWithCurrentDemand}>
              Neem exact weekmenu mee naar privévergelijker
            </button>
            <a className="ghost-button" href={`${import.meta.env.BASE_URL}private-basket-mapping.html`} target="_blank" rel="noopener noreferrer">
              Open privévergelijker voor mijn TXT-lijst
            </a>
            </div>
          </details>
          {backupMessage && <p role="status" className="unpriced-planner-checklist__note">{backupMessage}</p>}
          <div className="unpriced-planner-checklist__rows" aria-label="Boodschappen per gepland recept">
            {visible.length ? recipeGroups.map(group => (
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
                        setPrepared(null)
                      }} />
                    <span className="unpriced-planner-checklist__thumb" aria-hidden="true">
                      {item.label.trim().slice(0, 1).toLocaleUpperCase('nl') || '•'}
                    </span>
                    <span className="unpriced-planner-checklist__item-copy">
                      <strong>{item.label}</strong><small>{quantity(item)}</small>
                    </span>
                    <span className="unpriced-planner-checklist__price" aria-label="Geen winkelprijs bekend">
                      —
                    </span>
                  </label>
                ))}
              </section>
            )) : <p role="status">Alle boodschappen afgevinkt voor deze week.</p>}
          </div>
          {handwritten.length > 0 && <section className="unpriced-planner-checklist__recipe-group"
            aria-label="Zelf toegevoegde ongeprijsde boodschappen">
            <header className="unpriced-planner-checklist__group-title">
              <h4>Ook meenemen · handmatig toegevoegd</h4>
              <span>{visibleHandwritten.length} zichtbaar</span>
            </header>
            <p>Dit zijn aparte eigen notities zonder winkelprijs of verpakkingsmatch.
              Ze tellen niet mee bij Planner-ingrediënten of de supermarktvergelijking.
              Vink ze hier af, of bewerk ze onder Zelf toevoegen verderop in de Lijst.</p>
            <div>{visibleHandwritten.map(note => <label key={note.id}
              className="unpriced-planner-checklist__item">
              <input type="checkbox" checked={note.done} disabled={!onToggleManualNote}
                onChange={() => onToggleManualNote?.(note.id)} />
              <span className="unpriced-planner-checklist__item-copy">
                <strong>{safeHandwritten(note.label)}</strong>
                <small>{note.store} · zelf toegevoegd, geen originele winkel-SKU</small>
              </span>
              <span className="unpriced-planner-checklist__price" aria-label="Prijs onbekend">—</span>
            </label>)}</div>
          </section>}
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
