import { useEffect, useRef, useState } from 'react'
import type { CaptureStore } from './plannerPriceCaptureSheet.ts'
import type { PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import { exportLocalCaptureDraft, restoreLocalCaptureDraft } from './localCaptureEditorBackup.ts'
import { incompleteCaptureFields, offlineCaptureFieldChecklist,
  captureTimeReadiness, enteredCapturePairWarning } from './localCaptureFieldProgress.ts'
import { saveLocalCaptureTab, readLocalCaptureTab, clearLocalCaptureTab } from './localCaptureSessionDraft.ts'
import { shopLabelEuroCents } from './shopLabelEuroCents.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from './privateUnitPrice.ts'

type Row = {
  state: 'unseen' | 'available' | 'unavailable'
  sku: string; name: string; amount: string; unit: string
  count: string; cents: string
}
type Snapshot = {
  fingerprint: string
  needs: readonly PlannerCaptureGuideNeed[]
  stores: readonly CaptureStore[]
}
type Field = keyof Row
const header = ['retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available']
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const empty = (): Row => ({
  state: 'unseen', sku: '', name: '', amount: '', unit: '',
  count: '', cents: '',
})
const fingerprintOf = (stores: readonly CaptureStore[],
  needs: readonly PlannerCaptureGuideNeed[], context: string) =>
  JSON.stringify([context, stores, needs.map(item =>
    [item.id, item.label, item.amount, item.unit])])
type Props = {
  stores: readonly CaptureStore[]
  needs: readonly PlannerCaptureGuideNeed[]
  needsAtClick?: () => readonly PlannerCaptureGuideNeed[]
  delimiter: ',' | ';' | '\t'
  context: string
  onReview?: (files: File[]) => void | boolean | Promise<void | boolean>
  onDraftChange?: () => void
}
/**
 * Private phone-native entry for actually observed original store products.
 * Values are NEVER inferred from Planner ingredients. This generates only the
 * existing canonical nine-column source CSV; it cannot accept prices or grant
 * retailer permissions. The existing preflight still runs on explicit review.
 */
export function LocalObservationCaptureEditor({
  stores, needs, needsAtClick, delimiter, context, onReview, onDraftChange,
}: Props) {
  const currentFingerprint = fingerprintOf(stores, needs, context)
  const currentScope = useRef(currentFingerprint)
  currentScope.current = currentFingerprint
  const changes = useRef(0)
  const latestRestore = useRef(0)
  const draftInvalidated = useRef(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    fingerprint: currentFingerprint, needs: [...needs], stores: [...stores],
  }))
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [moments, setMoments] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [tabAutosave, setTabAutosave] = useState(false)
  const [tabError, setTabError] = useState('')
  const [search, setSearch] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [euroDrafts, setEuroDrafts] = useState<Record<string, string>>({})
  const [euroErrors, setEuroErrors] = useState<Record<string, string>>({})
  const [draftPaste, setDraftPaste] = useState('')
  const [draftCopy, setDraftCopy] = useState('')
  const [portable, setPortable] = useState<{ store: CaptureStore; text: string } | null>(null)
  const changed = snapshot.fingerprint !== currentFingerprint
  const missingByStore = new Map(snapshot.stores.map(store =>
    [store, incompleteCaptureFields(store, snapshot.needs, rows,
      moments[store] ?? '')] as const))
  const rowKey = (store: CaptureStore, index: number) => store + ':' + index
  const row = (store: CaptureStore, index: number) => rows[rowKey(store, index)] ?? empty()
  // Saving in this tab is never enabled silently. A deliberate opt-in allows
  // survival of page refresh while leaving the normal JSON export available.
  useEffect(() => {
    if (!tabAutosave || changed) return
    function persist(reportError: boolean) {
      try {
        saveLocalCaptureTab(snapshot.fingerprint, { rows, moments })
        if (reportError) setTabError('')
      } catch (cause) {
        if (reportError) {
          setTabAutosave(false)
          setTabError(cause instanceof Error ? cause.message :
            'Tijdelijk bewaren in dit tabblad lukt niet; download het JSON-concept.')
        }
      }
    }
    const timer = window.setTimeout(() => persist(true), 400)
    // A refresh can happen within the normal 400 ms debounce. Make a
    // best-effort synchronous final save before the page is hidden/unloaded.
    // Mobile browsers may still terminate without either event; a downloaded
    // private JSON backup remains the only portable durable copy.
    const onPageHide = () => persist(false)
    const onHidden = () => {
      if (document.visibilityState === 'hidden') persist(false)
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [tabAutosave, changed, snapshot.fingerprint, rows, moments])
  function enableTabAutosave() {
    if (tabAutosave) {
      try {
        if (!changed) saveLocalCaptureTab(snapshot.fingerprint, { rows, moments })
        setTabAutosave(false)
        setStatus('Automatisch tabblad-bewaren uitgeschakeld. Laatste concept blijft tijdelijk herstelbaar.')
      } catch (cause) {
        setTabError(cause instanceof Error ? cause.message : 'Bewaren mislukt. Download het privéconcept als JSON.')
      }
      return
    }
    try {
      if (changed) throw Error('Planner-selectie gewijzigd. Start eerst bewust een nieuw leeg formulier.')
      const stored = readLocalCaptureTab(snapshot.fingerprint,
        snapshot.stores, snapshot.needs.length)
      if (stored && !window.confirm(
        'Er bestaat al tijdelijke winkelinvoer in dit tabblad. Zet je automatische opslag aan, dan overschrijf je deze met het huidige formulier. Kies Annuleren om die invoer eerst te hervatten.'
      )) return
      setTabAutosave(true)
      setTabError('')
      setStatus('Tijdelijke automatische opslag ingeschakeld voor dit tabblad. Geen upload of geaccepteerde bron.')
    } catch (cause) {
      setTabError(cause instanceof Error ? cause.message : 'Tijdelijke tabopslag niet beschikbaar.')
    }
  }
  function resumeTabDraft() {
    try {
      if (changed) throw Error('Planner-selectie gewijzigd. Tijdelijk hervatten is alleen toegestaan voor de oorspronkelijke week.')
      const stored = readLocalCaptureTab(snapshot.fingerprint,
        snapshot.stores, snapshot.needs.length)
      if (!stored) throw Error('Geen passend tijdelijk privéconcept in dit tabblad.')
      if ((Object.values(rows).some(value => value.state !== 'unseen') ||
           Object.values(moments).some(Boolean)) &&
          !window.confirm('Bestaande formulierinvoer vervangen door je tijdelijke privéconcept?')) return
      ++changes.current
      ++latestRestore.current
      setRows(stored.rows)
      setMoments(stored.moments)
      setPortable(null); setDraftCopy(''); setDraftPaste(''); setEuroDrafts({}); setEuroErrors({})
      invalidatePreviewOnce()
      setStatus('Eerdere invoer uit dit tabblad hervat. Alle winkelproducten en prijzen moeten nog door broncontrole.')
      setTabError('')
    } catch (cause) {
      setTabError(cause instanceof Error ? cause.message : 'Tijdelijk concept niet hervat.')
    }
  }
  function deleteTabDraft() {
    if (!window.confirm('Tijdelijke tabopslag wissen? Je huidige formulier en zelf gedownloade bestanden blijven staan.')) return
    try {
      clearLocalCaptureTab()
      setTabAutosave(false)
      setTabError('')
      setStatus('Tijdelijke tabopslag gewist. De huidige formulierinvoer blijft open.')
    } catch (cause) {
      setTabError(cause instanceof Error ? cause.message : 'Kan tijdelijke tabopslag niet verwijderen.')
    }
  }
  function invalidatePreviewOnce() {
    // Typing on a phone should not repeatedly rebuild the entire Planner and
    // invalidate the same accepted preview hundreds of times per product.
    if (!draftInvalidated.current) {
      draftInvalidated.current = true
      onDraftChange?.()
    }
  }
  function edit(store: CaptureStore, index: number, field: Field, value: string) {
    const oldEntry = row(store, index)
    const discardingObservation = field === 'state' && value === 'unseen' &&
      oldEntry.state !== 'unseen'
    const droppingPrice = field === 'state' && value === 'unavailable' &&
      !!(oldEntry.amount || oldEntry.count || oldEntry.cents)
    if (discardingObservation && !window.confirm(
      'Niet waargenomen kiezen wist de oude SKU, productnaam, verpakking en prijs uit deze conceptregel. Eerst lokaal bewaren?'
    )) return
    if (droppingPrice && !window.confirm(
      'Niet-beschikbaar kiezen wist de eerdere pakinhoud en prijs uit deze lokale conceptregel. Toch wijzigen?'
    )) return
    ++changes.current
    if (field === 'cents' || field === 'state') {
      const key = rowKey(store, index)
      setEuroDrafts(old => ({ ...old, [key]: '' }))
      setEuroErrors(old => ({ ...old, [key]: '' }))
    }
    setRows(old => {
      const key = rowKey(store, index)
      const next = { ...(old[key] ?? empty()), [field]: value }
      return { ...old, [key]: discardingObservation ? empty() : droppingPrice
        ? { ...next, amount: '', count: '', cents: '' } : next }
    })
    setStatus('')
    setPortable(null)
    setDraftCopy('')
    invalidatePreviewOnce()
  }
  function editEuro(store: CaptureStore, index: number, text: string) {
    const key = rowKey(store, index)
    if (row(store, index).cents !== '') edit(store, index, 'cents', '')
    setEuroDrafts(old => ({ ...old, [key]: text }))
    setEuroErrors(old => ({ ...old, [key]: '' }))
  }
  function applyEuro(store: CaptureStore, index: number) {
    const key = rowKey(store, index)
    try {
      const cents = shopLabelEuroCents(euroDrafts[key] ?? '')
      edit(store, index, 'cents', cents)
      setStatus(store + ' regel ' + (index + 2) +
        ': de zelf ingevoerde europrijs is exact ' + cents +
        ' cent. Geen winkelprijs of productmatch automatisch bevestigd.')
    } catch (cause) {
      setEuroErrors(old => ({ ...old, [key]: cause instanceof Error
        ? cause.message : 'Controleer het werkelijk afgelezen eurobedrag.' }))
    }
  }
  function moment(store: CaptureStore, value: string) {
    ++changes.current
    setMoments(old => ({ ...old, [store]: value }))
    setPortable(null)
    setDraftCopy('')
    setStatus('')
    invalidatePreviewOnce()
  }
  function reset() {
    if (Object.values(rows).some(r => r.state !== 'unseen') &&
      !window.confirm('Vervang je nog niet bewaarde originele winkelinvoer? Bewaar eerst de ingevulde CSV.')) return
    ++changes.current
    ++latestRestore.current
    setSnapshot({ fingerprint: currentFingerprint, needs: [...needs], stores: [...stores] })
    setRows({}); setMoments({}); setStatus(''); setSearch(''); setOnlyOpen(false); setPortable(null); setDraftPaste(''); setDraftCopy(''); setEuroDrafts({}); setEuroErrors({})
    // A new physical week must not quietly overwrite the previous tab copy.
    setTabAutosave(false)
    invalidatePreviewOnce()
  }
  async function backupDraft(method: 'download' | 'share' | 'copy') {
    try {
      setStatus('')
      const text = exportLocalCaptureDraft(snapshot.fingerprint, { rows, moments })
      if (method === 'copy') {
        setDraftCopy(text)
        if (!navigator.clipboard?.writeText) {
          setStatus('Klembord niet beschikbaar. Selecteer de privé-JSON hieronder.')
          return
        }
        try {
          await navigator.clipboard.writeText(text)
          setStatus('Alleen je eigen privéconcept gekopieerd. Plak uitsluitend op een vertrouwd apparaat.')
        } catch {
          setStatus('Klembordtoegang ontbreekt. Selecteer je privé-JSON hieronder.')
        }
        return
      }
      const file = new File([text],
        'supa-mijn-onvolledige-winkelinvoer-niet-gecontroleerd.json',
        { type: 'application/json;charset=utf-8' })
      if (method === 'share' && navigator.share &&
          navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file],
            title: 'Supa · mijn eigen privéwinkelinvoer (geen prijsbewijs)' })
          setStatus('Je eigen JSON-concept bewust via het toestel gedeeld. Dit is geen winkelprijsbewijs.')
        } catch (cause) {
          setStatus(cause instanceof Error && cause.name === 'AbortError'
            ? 'Delen geannuleerd. Je invoer blijft in dit formulier staan.'
            : 'Delen niet gelukt. Download desgewenst je eigen JSON-concept.')
        }
        return
      }
      const url = URL.createObjectURL(file)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setStatus(method === 'share'
        ? 'Mobiel bestandsdelen niet beschikbaar. Privé-JSON lokaal gedownload.'
        : 'Je privéconcept lokaal opgeslagen als JSON; geen geaccepteerde winkelbron.')
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Kan het privéconcept niet bewaren.')
    }
  }
  async function restoreDraft(file: File) {
    const request = ++latestRestore.current
    const revision = changes.current
    try {
      if (changed) throw Error('Planner-week of winkelkeuze veranderd. Begin bewust een nieuw leeg formulier voordat je een passende back-up herstelt.')
      if (!/\.json$/iu.test(file.name) || !file.size || file.size > 256000)
        throw Error('Kies een JSON-conceptbestand tot 256 kB dat je eerder zelf hebt opgeslagen.')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (currentScope.current !== snapshot.fingerprint ||
          latestRestore.current !== request || changes.current !== revision) {
        throw Error('De actuele Planner-selectie of broninvoer is tijdens het openen gewijzigd. Bestaande invoer blijft behouden.')
      }
      const restored = restoreLocalCaptureDraft(raw, currentScope.current,
        snapshot.stores, snapshot.needs.length)
      if (Object.keys(rows).length > 0 || Object.values(moments).some(Boolean)) {
        if (!window.confirm('Je huidige onopgeslagen winkelinvoer vervangen door deze lokale conceptback-up?')) {
          setStatus('Huidige invoer behouden. Er is niets teruggezet.')
          return
        }
      }
      if (currentScope.current !== snapshot.fingerprint ||
          latestRestore.current !== request || changes.current !== revision) {
        throw Error('De Planner-selectie of invoer is tijdens je bevestiging gewijzigd. Oude invoer behouden.')
      }
      ++changes.current
      setRows(restored.rows); setMoments(restored.moments)
      setPortable(null); setDraftCopy(''); setDraftPaste(''); setEuroDrafts({}); setEuroErrors({})
      setStatus('Privéconcept op dit toestel hersteld. Alle SKU’s, bronmomenten en prijzen moeten nog via de gewone broncontrole.')
      invalidatePreviewOnce()
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Kon het lokale concept niet herstellen.')
    }
  }
  async function carryOpen(store: CaptureStore, method: 'copy' | 'download' | 'share') {
    try {
      setStatus('')
      const text = offlineCaptureFieldChecklist(store, snapshot.needs, rows,
        moments[store] ?? '')
      setPortable({ store, text })
      if (method === 'copy') {
        if (!navigator.clipboard?.writeText) {
          setStatus('Klembord niet beschikbaar. Selecteer de privécontrolelijst hieronder om handmatig te kopiëren.')
          return
        }
        await navigator.clipboard.writeText(text)
        setStatus(store + ': openstaande winkelopnamepunten gekopieerd; geen prijs geaccepteerd.')
        return
      }
      if (method === 'share') {
        if (!navigator.share) {
          setStatus('Deelblad niet beschikbaar. Selecteer de openstaande regels hieronder om ze zelf te versturen.')
          return
        }
        try {
          await navigator.share({
            title: 'Supa · ' + store + ' nog te observeren (privé, zonder winkelprijzen)',
            text,
          })
          setStatus(store + ': openstaande controlepunten bewust vanaf je toestel gedeeld.')
        } catch (cause) {
          setStatus(cause instanceof Error && cause.name === 'AbortError'
            ? 'Delen geannuleerd; de privécontrolelijst blijft hieronder beschikbaar.'
            : 'Delen niet gelukt. Selecteer de privécontrolelijst hieronder om die te kopiëren.')
        }
        return
      }
      const uri = URL.createObjectURL(new Blob([text], {
        type: 'text/plain;charset=utf-8',
      }))
      try {
        const a = document.createElement('a')
        a.href = uri
        a.download = 'supa-' + store.toLowerCase() + '-nog-opnemen-prive.txt'
        document.body.append(a)
        try { a.click() } finally { a.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
      setStatus(store + ': controlelijst lokaal gedownload; niets als winkelbron geaccepteerd.')
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message :
        'Kan de privécontrolelijst niet kopiëren of bewaren.')
    }
  }
  function filledFiles(): File[] {
    const actual: File[] = []
    for (const store of snapshot.stores) {
      const selected = snapshot.needs.map((need, index) =>
        ({ need, row: row(store, index), index: index + 2 }))
        .filter(entry => entry.row.state !== 'unseen')
      if (!selected.length) continue
      const observedAt = moments[store]?.trim() ?? ''
      // Refuse a malformed selected observation before producing a nominally
      // importable source file. Unseen Planner lines are legitimately omitted.
      const incompleteSelected = incompleteCaptureFields(store, snapshot.needs,
        rows, observedAt).find(({ index }) => row(store, index).state !== 'unseen')
      if (incompleteSelected) throw Error(store + ' regel ' +
        (incompleteSelected.index + 2) + ': controleer eerst ' +
        incompleteSelected.missing.join(', ') +
        '. De huidige broninvoer blijft in het formulier staan.')
      const seen = new Set<string>()
      const lines: string[][] = [header]
      for (const { row: source, index } of selected) {
        if (!source.sku.trim() || !source.name.trim() || !source.unit) {
          throw Error(store + ' regel ' + index +
            ': een zelf geobserveerde artikelcode, productnaam en pakeenheid ontbreken.')
        }
        if (seen.has(source.sku.trim())) {
          throw Error(store + ': artikelcode ' + source.sku +
            ' is dubbel ingevuld. Een origineel winkelproduct hoort één keer in de bron; andere Planner-vragen delen diezelfde SKU.')
        }
        seen.add(source.sku.trim())
        if (source.state === 'available' &&
          (!source.amount.trim() || !source.count.trim() || source.cents.trim() === '')) {
          throw Error(store + ' regel ' + index +
            ': beschikbaar product vereist een echte pakinhoud, multipack en prijs in hele centen (ook nul alleen als werkelijk geobserveerd).')
        }
        if (source.state === 'unavailable' &&
          (source.amount.trim() || source.count.trim() || source.cents.trim())) {
          throw Error(store + ' regel ' + index +
            ': voor niet-beschikbaar product laat je hoeveelheid, multipack en prijs leeg. Controleer de oorspronkelijke bron opnieuw.')
        }
        lines.push([store, observedAt, source.sku.trim(), source.name.trim(),
          source.amount.trim(), source.unit, source.count.trim(),
          source.cents.trim(), source.state === 'available' ? 'true' : 'false'])
      }
      const value = lines.map(fields => fields.map(quote).join(delimiter))
        .join('\r\n') + '\r\n'
      if (new TextEncoder().encode(value).byteLength > 256000) {
        throw Error(store + ': bronconcept is groter dan 256 kB.')
      }
      actual.push(new File([value], 'supa-' + store.toLowerCase() +
        '-eigen-originele-opname.' + (delimiter === '\t' ? 'tsv' : 'csv'),
      { type: delimiter === '\t' ? 'text/tab-separated-values;charset=utf-8' :
        'text/csv;charset=utf-8' }))
    }
    if (!actual.length) throw Error('Markeer minstens één werkelijk waargenomen winkelproduct.')
    return actual
  }
  async function act(method: 'download' | 'review' | 'share') {
    try {
      setStatus('')
      const files = filledFiles()
      if (method === 'review') {
        const latest = needsAtClick?.() ?? needs
        if (changed || fingerprintOf(stores, latest, context) !== snapshot.fingerprint) {
          throw Error('Het Planner-weekmenu of de opnamebehoefte is veranderd. Bewaar eerst je concept en start een nieuwe opname voor het actuele mandje.')
        }
        if (!onReview) throw Error('Deze sectie kan de bron nog niet lokaal controleren.')
        // Capture the exact physical draft revision. A user can change
        // observations while the canonical converter is loading; never
        // announce the old result as the current one after such an edit.
        const submittedRevision = changes.current
        const submittedScope = snapshot.fingerprint
        draftInvalidated.current = false
        const previewReady = await onReview(files)
        if (changes.current !== submittedRevision ||
            currentScope.current !== submittedScope) {
          // A late parser must not leave an accepted-looking stale preview.
          // Parent clears its candidate and invalidates in-flight imports.
          onDraftChange?.()
          draftInvalidated.current = true
          setStatus('De winkelinvoer is veranderd terwijl de bron werd geopend. Gebruik alleen een nieuwe controle van de huidige originele invoer.')
          return
        }
        if (previewReady === false) {
          setStatus('Dit bronbestand is niet toegelaten tot de lokale voorinzage. Lees de concrete reden in het bronpaneel; huidige formulierinvoer en eerdere geaccepteerde gegevens blijven behouden.')
          return
        }
        setStatus('Broncontrole op dit toestel gestart. Controleer hierboven de oorspronkelijke SKU’s en bronmomenten, en bevestig eventueel overnemen altijd afzonderlijk.')
        document.getElementById('supa-price-sheet-review')?.scrollIntoView({
          behavior: 'smooth', block: 'start',
        })
        return
      }
      if (method === 'share' && navigator.share &&
          navigator.canShare?.({ files })) {
        await navigator.share({ files,
          title: 'Supa · eigen originele winkelopnames (nog niet geaccepteerd)' })
        setStatus('Originele eigen winkelopnames bewust via je toestel gedeeld. Er is geen prijs, match of winkelrecht door Supa bevestigd.')
        return
      }
      for (const file of files) {
        const url = URL.createObjectURL(file)
        try {
          const link = document.createElement('a')
          link.href = url; link.download = file.name
          document.body.append(link)
          try { link.click() } finally { link.remove() }
        } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      }
      setStatus(method === 'share'
        ? 'Bestandsdelen is op dit toestel niet beschikbaar. Eigen winkelopnames zijn daarom lokaal gedownload; geen prijs geaccepteerd.'
        : 'Originele ingevulde winkelbladen alleen op je toestel gedownload. Geen product, bedrag of bronrecht is geaccepteerd.')
    } catch (cause) {
      setStatus(cause instanceof Error && cause.name === 'AbortError'
        ? 'Delen geannuleerd; de eigen broninvoer blijft in dit formulier staan.'
        : cause instanceof Error ? cause.message : 'Kan het originele winkelblad niet maken.')
    }
  }

  return <details className="offline-price-workbench__local-editor">
    <summary>Vul zelf originele winkelproducten op je telefoon in (geen spreadsheet nodig)</summary>
    <p>Dit formulier maakt de normale negenkoloms Supa-opname. De genoemde
      Planner-ingrediënten dienen alleen als <strong>rijnummergids</strong>:
      kies zelf de originele winkel-SKU, de echte verpakking en het bronmoment.
      Er zijn geen automatisch ingevulde prijzen, verpakkingen, productcodes,
      datums of bronrechten. Alleen ingevulde waarnemingen worden geëxporteerd.</p>
    {changed && <p role="alert">Het geselecteerde mandje of de opnamescope is inmiddels gewijzigd.
      Je originele concept blijft hieronder staan, maar kan niet meer voor het nieuwe
      mandje worden overgenomen. Bewaar het eerst lokaal en begin opnieuw.</p>}
    <label>Zoek Planner-ingrediënt om zelf te observeren
      <input type="search" value={search} maxLength={120}
        placeholder="Filter ingrediënten in beide winkels"
        onChange={event => setSearch(event.currentTarget.value)} />
    </label>
    <label><input type="checkbox" checked={onlyOpen}
      onChange={event => setOnlyOpen(event.currentTarget.checked)} />
      {' '}Alleen nog niet waargenomen of onvolledige invoerregels tonen
    </label>
    {enteredCapturePairWarning(moments.PLUS ?? '', moments.DekaMarkt ?? '') &&
      <p role="alert">{enteredCapturePairWarning(
        moments.PLUS ?? '', moments.DekaMarkt ?? '')}</p>}
    {snapshot.stores.length === 2 &&
      snapshot.stores.every(store => missingByStore.get(store)?.length === 0) &&
      <p role="status">Alle originele invoervelden voor PLUS en DekaMarkt zijn
        ingevuld. Start nu de bestaande persoonlijke bron- en productcontrole;
        een compleet geprijsd mandje of besparing is hiermee nog niet vastgesteld.</p>}
    {snapshot.stores.map(store => <fieldset key={store}>
      <legend>{store} · originele persoonlijke bronopname</legend>
      {(() => {
        const open = missingByStore.get(store) ?? []
        return <div>
          <p role="status">{open.length} van {snapshot.needs.length} Planner-regels
            hebben nog ontbrekende originele waarnemingsvelden.
            {open.length === 0 ? ' Alle velden zijn ingevuld; broncontrole blijft verplicht.' : ''}
          </p>
          {open.length > 0 && <div className="offline-price-workbench__actions">
            <button type="button" className="ghost-button"
              onClick={() => { void carryOpen(store, 'copy') }}>
              Kopieer {open.length} openstaande {store}-regels voor onderweg
            </button>
            <button type="button" className="ghost-button"
              onClick={() => { void carryOpen(store, 'download') }}>
              Download {store}-controlelijst zonder prijzen (TXT)
            </button>
            <button type="button" className="ghost-button"
              onClick={() => { void carryOpen(store, 'share') }}>
              Deel {store}-controlelijst via mijn telefoon
            </button>
          </div>}
          {portable?.store === store && <label>
            Mijn selecteerbare {store}-herinnering (ook zonder klembordrechten)
            <textarea readOnly rows={7} spellCheck={false} value={portable.text}
              onFocus={event => event.currentTarget.select()}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} />
          </label>}
        </div>
      })()}
      <p role="status">{snapshot.needs.filter((_, index) =>
        row(store, index).state !== 'unseen').length} van {snapshot.needs.length}
        {' '}fysieke Planner-regels hebben een door jou opgegeven bronproduct;
        de overige blijven onbekend. Dit is nog geen geaccepteerde productmatch.</p>
      <label>Werkelijk bronmoment, inclusief tijdzone (geen automatische datum)
        <input type="text" value={moments[store] ?? ''} maxLength={40}
          placeholder="2026-10-21T16:30:00+02:00"
          onChange={event => moment(store, event.currentTarget.value)} />
      </label>
      <small>Dezelfde echte waarnemingstijd geldt voor alle producten in dit
        winkelblad. Als je later een product opnieuw vastlegt, maak dan een nieuwe
        opname met het nieuwe werkelijke tijdstip; hergebruik geen oude prijs.</small>
      <p role="status">Tijdcontrole voor {store}:{' '}
        {captureTimeReadiness(moments[store] ?? '').reason}.
        {' '}Dit bewijst geen echte winkelwaarneming of bronrecht.</p>
      {snapshot.needs.map((need, index) => ({ need, index }))
        .filter(({ index }) => !onlyOpen ||
          (missingByStore.get(store)?.some(item => item.index === index) ?? false))
        .filter(({ need }) =>
        !search.trim() || [need.label, need.id].join(' ').normalize('NFKD')
          .toLocaleLowerCase('nl-NL').includes(search.trim().normalize('NFKD')
            .toLocaleLowerCase('nl-NL'))).map(({ need, index }) => {
        const value = row(store, index)
        const physical = readablePlannerDemandAmount(need.amount)
        // Reuse the production BigInt pack-rate calculator, never a float
        // or an inferred ingredient->retailer match. Only a complete,
        // current, locally typed source candidate has an advisory rate.
        const complete = !(missingByStore.get(store)?.some(item => item.index === index))
        const rate = value.state === 'available' && complete
          ? privatePackUnitRate({
            amount: Number(value.amount), unit: value.unit,
            count: Number(value.count), priceCents: Number(value.cents),
          }) : null
        return <details key={store + ':' + index + ':' + need.id}>
          <summary>Regel {index + 2}: {need.label} · Planner-vraag{' '}
            {physical === 'hoeveelheid nog controleren'
              ? physical : physical + ' ' + need.unit}
            {' '}· {value.state === 'unseen' ? 'niet waargenomen' :
              value.state === 'available' ? 'bronproduct beschikbaar' : 'bronproduct niet beschikbaar'}
          </summary>
          {missingByStore.get(store)?.find(item => item.index === index)?.missing &&
            <p role="status"><small>Voor deze originele regel nog nodig:{' '}
              {missingByStore.get(store)?.find(item => item.index === index)?.missing.join('; ')}.
              {' '}Dit is geen geaccepteerde winkelprijs.</small></p>}
          <label>Waarnemingsstatus
            <select value={value.state}
              onChange={event => edit(store, index, 'state', event.currentTarget.value)}>
              <option value="unseen">Niet waargenomen (geen bronprijs)</option>
              <option value="available">Eigen bronproduct gezien, beschikbaar</option>
              <option value="unavailable">Eigen bronproduct gezien, niet beschikbaar</option>
            </select>
          </label>
          {value.state !== 'unseen' && <div className="offline-price-workbench__input">
            <label>Originele winkelartikelcode (SKU)
              <input type="text" value={value.sku} maxLength={100}
                onChange={event => edit(store, index, 'sku', event.currentTarget.value)} />
            </label>
            <label>Originele winkelproductnaam
              <input type="text" value={value.name} maxLength={160}
                onChange={event => edit(store, index, 'name', event.currentTarget.value)} />
            </label>
            <label>Geobserveerde verpakkingseenheid
              <select value={value.unit}
                onChange={event => edit(store, index, 'unit', event.currentTarget.value)}>
                <option value="">Zelf waargenomen eenheid kiezen</option>
                <option value="g">gram (g)</option><option value="kg">kilogram (kg)</option>
                <option value="ml">milliliter (ml)</option><option value="l">liter (l)</option>
                <option value="piece">hele stuks (piece)</option>
              </select>
            </label>
            {value.state === 'available' && <>
              <label>Echte pakinhoud (zonder eenheid)
                <input type="text" inputMode="decimal" value={value.amount} placeholder="500"
                  onChange={event => edit(store, index, 'amount', event.currentTarget.value)} />
              </label>
              <label>Aantal stuks/pakken in multipack
                <input type="text" inputMode="numeric" value={value.count} placeholder="1"
                  onChange={event => edit(store, index, 'count', event.currentTarget.value)} />
              </label>
              <label>Originele hele-verpakkingprijs in eurocenten
                <input type="text" inputMode="numeric" value={value.cents} placeholder="bijv. 199"
                  onChange={event => edit(store, index, 'cents', event.currentTarget.value)} />
              </label>
              <label>Of: lees het echte prijskaartje af in euro (€)
                <input type="text" inputMode="decimal" maxLength={32}
                  value={euroDrafts[rowKey(store, index)] ?? ''}
                  placeholder="bijv. € 1,99 (niet 199)"
                  onChange={event => editEuro(store, index, event.currentTarget.value)} />
              </label>
              <button type="button" className="ghost-button"
                disabled={!(euroDrafts[rowKey(store, index)] ?? '').trim()}
                onClick={() => applyEuro(store, index)}>
                Zet mijn afgelezen europrijs exact om naar centen
              </button>
              {euroErrors[rowKey(store, index)] &&
                <small role="alert">{euroErrors[rowKey(store, index)]}</small>}
              <small>Je zelf getypte europrijs wordt pas een bronconcept na
                expliciete omzetting. Bij € 1,99 komt er 199 in het centenveld.
                De echte winkelopname en persoonlijke matchcontrole blijven vereist.</small>
              {rate && <p role="status">Indicatieve eenheidsprijs uit alleen jouw
                originele invoer: <strong>{formatPrivateUnitRate(rate)}</strong>.
                {' '}Deze winkelprijs of productmatch is nog niet persoonlijk bevestigd.
                Hele-pakregels en hetzelfde weekmandje worden apart beoordeeld.</p>}
            </>}
            <small>Dit is een handmatig bronconcept, geen bevestigde productmatch.
              Dezelfde SKU meerdere keren invoeren binnen één winkel is ongeldig.</small>
          </div>}
        </details>
      })}
    </fieldset>)}
    <section aria-label="Vrijwillige tijdelijke opslag van eigen winkelinvoer">
      <p><strong>Pagina vernieuwen zonder je winkelinvoer kwijt te raken?</strong>{' '}
        Alleen wanneer je dit zelf inschakelt bewaart Supa je bronconcept tijdelijk
        in de sessieopslag van dit tabblad. Herstel is maximaal 12 uur na je
        laatste invoer toegestaan; daarna wordt het concept bij openen gewist.
        Dit is geen synchronisatie, retailerbron of prijsacceptatie; op een ander
        toestel blijft een eigen gedownload JSON-bestand nodig.</p>
      <div className="offline-price-workbench__actions">
        <button type="button" className="ghost-button" disabled={changed}
          aria-pressed={tabAutosave} onClick={enableTabAutosave}>
          {tabAutosave ? 'Schakel tijdelijk bewaren uit' : 'Schakel tijdelijk bewaren in dit tabblad in'}
        </button>
        <button type="button" className="ghost-button" disabled={changed}
          onClick={resumeTabDraft}>Hervat tijdelijk concept in dit tabblad</button>
        <button type="button" className="ghost-button"
          onClick={deleteTabDraft}>Wis tijdelijke tabopslag</button>
      </div>
      {tabError && <p role="alert">{tabError}</p>}
      {tabAutosave && <p role="status">Tijdelijke opslag staat aan voor dit tabblad;
        download ook een eigen JSON-bestand voor bewaren buiten deze sessie.</p>}
    </section>
    <div className="offline-price-workbench__actions">
      <button type="button" className="ghost-button" onClick={() => { void backupDraft('download') }}>
        Bewaar ook onvolledige invoer als privéconcept (JSON)
      </button>
      <button type="button" className="ghost-button"
        onClick={() => { void backupDraft('share') }}>
        Deel mijn eigen privéconcept als JSON via telefoon
      </button>
      <button type="button" className="ghost-button"
        onClick={() => { void backupDraft('copy') }}>
        Kopieer mijn eigen privéconcept als JSON
      </button>
      <label>Herstel eerder bewaard privéconcept voor precies dit weekmenu
        <input type="file" accept=".json,application/json"
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void restoreDraft(file)
          }} />
      </label>
      <details>
        <summary>Plak een eerder gekopieerd privéconcept (JSON) voor precies dit weekmenu</summary>
        <p>Plak uitsluitend je eigen <code>supa-private-capture-editor-draft-v1</code>
          JSON. Dit is een bewerkbaar concept, geen originele winkelbron of geaccepteerde
          prijs. Bestaande invoer wordt alleen na controle en jouw bevestiging vervangen.</p>
        <textarea rows={5} spellCheck={false} maxLength={256000}
          value={draftPaste} onChange={event => setDraftPaste(event.currentTarget.value)}
          placeholder="Plak je eigen privéconcept-JSON (geen winkel-CSV)"
          style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} />
        <button type="button" disabled={!draftPaste.trim() || changed}
          onClick={() => { void restoreDraft(new File([draftPaste],
            'supa-eigen-priveconcept.json', { type: 'application/json' })) }}>
          Controleer en herstel mijn geplakte privéconcept
        </button>
        <button type="button" className="ghost-button"
          onClick={() => setDraftPaste('')}>Wis geplakte concepttekst</button>
      </details>
      <button type="button" className="ghost-button"
        onClick={() => { void act('download') }}>Bewaar ingevulde originele winkelopname op dit toestel</button>
      <button type="button" className="ghost-button"
        onClick={() => { void act('share') }}>Deel originele winkelopname-CSV via mijn telefoon</button>
      <button type="button" disabled={!onReview || changed}
        onClick={() => { void act('review') }}>Controleer mijn echte winkelopname in Supa</button>
      <button type="button" className="ghost-button"
        onClick={reset}>Start nieuw leeg opnameformulier</button>
    </div>
    {!changed && draftCopy && <label>Eigen privé-JSON om handmatig te kopiëren (geen winkelprijsbewijs)
      <textarea readOnly rows={5} spellCheck={false} value={draftCopy}
        onFocus={event => event.currentTarget.select()}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} />
      <button type="button" className="ghost-button"
        onClick={() => setDraftCopy('')}>Verberg mijn gekopieerde privé-JSON</button>
    </label>}
    {status && <p role="status" aria-live="polite">{status}</p>}
    <small>Dit JSON-concept is alleen je eigen lokale back-up voor dit exacte
      weekmenu; geen retailerbron, bronrecht of winkelbewijs. Je brongegevens
      blijven uitsluitend in deze open browsersessie tot je zelf een bestand bewaart. De bestaande import controleert daarna elke
      SKU, prijs, tijd, pakinhoud en gebruikerstoestemming afzonderlijk.</small>
  </details>
}
