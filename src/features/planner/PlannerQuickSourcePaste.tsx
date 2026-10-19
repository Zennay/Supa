import { useEffect, useMemo, useRef, useState } from 'react'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import { recentOwnCaptureInstant } from '../comparison/privateReviewedBasketBridge.ts'
import { privatePackUnitRate, formatPrivateUnitRate } from '../comparison/privateUnitPrice.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import { PlannerSourceMatchPreview } from './PlannerSourceMatchPreview.tsx'
import { replaceOwnStoreCapture } from './combineOwnSourceCapture.ts'
import './plannerQuickSourcePaste.css'

type Preview = { raw: string; normalized: string; data: OfflinePriceSnapshots }
const limit = 256000
const dateText = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

async function normalizedOwnSource(raw: string): Promise<string> {
  // Spreadsheet/desktop copy can include a single UTF-8 BOM even when the
  // rest of the supplied input is JSON. JSON.parse refuses that marker,
  // while the existing CSV converter already handles the CSV BOM itself.
  const jsonInput = raw.startsWith('﻿') ? raw.slice(1) : raw
  if (/^\s*\{/u.test(jsonInput)) return jsonInput
  const moduleUrl = import.meta.env.BASE_URL + 'offline-two-store-csv.mjs'
  const converter: unknown = await import(/* @vite-ignore */ moduleUrl)
  if (!converter || typeof converter !== 'object' ||
      !('convertOwnStoreCsv' in converter) ||
      typeof converter.convertOwnStoreCsv !== 'function')
    throw new Error('De bestaande lokale CSV-converter ontbreekt.')
  return (converter.convertOwnStoreCsv as (input: string) => string)(raw)
}

/** Local preview using the same converter and source contract as Vergelijk. */
export function PlannerQuickSourcePaste({ onImport, onRecapture, onReviewIngredient, hasDemand, needs }: {
  onImport: (files: File[]) => void
  onRecapture: (store: 'PLUS' | 'DekaMarkt') => void
  onReviewIngredient?: (store: 'PLUS' | 'DekaMarkt', ingredientId: string) => void
  hasDemand: boolean
  needs: readonly PlannerCaptureGuideNeed[]
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [separateDrafts, setSeparateDrafts] = useState({ PLUS: '', DekaMarkt: '' })
  const [updateDraft, setUpdateDraft] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!preview) return
    const refresh = () => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [preview])
  // This is not the originally cached freshness flag: a tab can stay open
  // past seven days while the original retailer capture does not change.
  const liveAdmission = useMemo(() => {
    if (!preview) return null
    try { return parseOfflinePriceSnapshots(preview.normalized, now) }
    catch { return null } // e.g. device clock moved back beyond source time
  }, [preview, now])
  const revision = useRef(0)
  function changeDraft(raw: string) {
    ++revision.current
    setDraft(raw); setPreview(null); setUndoSnapshot(null); setBusy(false)
    setMessage(raw ? 'Concept gewijzigd. Controleer opnieuw voor import.' : '')
  }
  async function inspectSource(raw: string) {
    const ticket = ++revision.current
    setPreview(null); setUndoSnapshot(null); setMessage('')
    if (!raw.trim()) { setMessage('Plak eerst echte eigen CSV-, TSV- of JSON-bronregels.'); return }
    if (new TextEncoder().encode(raw).length > limit) {
      setMessage('Bron groter dan 256 kB. Splits de originele opnames op.'); return
    }
    setBusy(true)
    try {
      const normalized = await normalizedOwnSource(raw)
      if (ticket !== revision.current) return
      const data = parseOfflinePriceSnapshots(normalized, Date.now())
      setPreview({ raw, normalized, data })
      setMessage('Structuur lokaal herkend. Controleer de bronmomenten en prijsdekking.')
    } catch (cause) {
      if (ticket === revision.current)
        setMessage(cause instanceof Error ? cause.message : 'Bronindeling niet herkend.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }
  async function inspect() { await inspectSource(draft) }

  async function previewOneFile(file: File | undefined) {
    if (!file) return
    const ticket = ++revision.current
    setPreview(null); setUndoSnapshot(null); setMessage('')
    if (file.size === 0 || file.size > limit) {
      setMessage('Kies één gevuld bronbestand van maximaal 256 kB.')
      return
    }
    setBusy(true)
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (ticket !== revision.current) return
      setDraft(raw)
      await inspectSource(raw)
    } catch {
      if (ticket === revision.current) setMessage('Bronbestand moet geldige UTF-8 CSV, TSV of JSON bevatten.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }

  async function previewFiles(files: File[]) {
    if (files.length === 1) { await previewOneFile(files[0]); return }
    if (files.length !== 2) {
      setMessage('Selecteer één of twee echte winkelbestanden.')
      return
    }
    const ticket = ++revision.current
    setPreview(null); setUndoSnapshot(null); setMessage(''); setBusy(true)
    try {
      const captures: unknown[] = []
      const seen = new Set<string>()
      for (const file of files) {
        if (file.size === 0 || file.size > limit)
          throw new Error('Elk bestand moet gevuld en maximaal 256 kB zijn.')
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
        if (ticket !== revision.current) return
        const normalized = await normalizedOwnSource(raw)
        if (ticket !== revision.current) return
        const source = parseOfflinePriceSnapshots(normalized, Date.now())
        const names = Object.keys(source.captures)
        if (names.length !== 1)
          throw new Error('Twee bestanden moeten elk precies één winkel bevatten.')
        if (seen.has(names[0]))
          throw new Error('Beide bestanden zijn dezelfde winkel. Kies PLUS én DekaMarkt.')
        seen.add(names[0])
        const input = JSON.parse(normalized) as { captures: unknown[] }
        if (!Array.isArray(input.captures) || input.captures.length !== 1)
          throw new Error('Originele winkelopname niet herkenbaar.')
        captures.push(input.captures[0])
      }
      const combined = JSON.stringify({ schema: 'supa-offline-prices-v1', captures })
      if (new TextEncoder().encode(combined).length > limit)
        throw new Error('Gecombineerde winkelbestanden zijn groter dan 256 kB.')
      const data = parseOfflinePriceSnapshots(combined, Date.now())
      if (ticket !== revision.current) return
      setDraft(combined)
      setPreview({ raw: combined, normalized: combined, data })
      setMessage('Twee originele winkelbestanden lokaal gecombineerd voor preview. Alle SKU’s en bronmomenten blijven ongewijzigd.')
    } catch (cause) {
      if (ticket === revision.current)
        setMessage(cause instanceof Error ? cause.message : 'Twee winkelbronnen niet herkend.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }

  // Refresh one retailer inside an already imported, local pair. This is a
  // deliberate, whole-capture replacement, never a merger of historical SKU
  // prices under an invented common observation timestamp.
  async function useNewStoreCapture(file: File | undefined) {
    if (!file || !preview || preview.raw !== draft) return
    const original = preview.normalized
    const ticket = ++revision.current
    setMessage('')
    if (file.size === 0 || file.size > limit) {
      setMessage('Kies één gevuld nieuw winkelbestand van maximaal 256 kB.')
      return
    }
    setBusy(true)
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (ticket !== revision.current) return
      const normalized = await normalizedOwnSource(raw)
      if (ticket !== revision.current) return
      const result = replaceOwnStoreCapture(original, normalized, Date.now())
      const data = parseOfflinePriceSnapshots(result.normalized, Date.now())
      if (ticket !== revision.current) return
      // One-step undo lives only in React memory. No browser persistence,
      // retailer cache, remote upload or implicit Workbench approval.
      setUndoSnapshot(preview)
      setDraft(result.normalized)
      // Do not retain a second raw copy of the just-ingested private source.
      setUpdateDraft('')
      setPreview({ raw: result.normalized, normalized: result.normalized, data })
      setMessage(result.retailer + ': originele nieuwere winkelopname ' +
        (result.action === 'replaced' ? 'vervangt de oudere opname' : 'is toegevoegd') +
        '. ' + (Object.keys(data.captures).length === 2
          ? result.pairedWithin24h
            ? 'De bronmomenten liggen binnen 24 uur; controleer nu alle SKU’s en pakken in Vergelijk.'
            : 'De bronmomenten liggen meer dan 24 uur uiteen: nog geen twee-winkelprijsverschil.'
          : 'De andere winkel heeft nog geen bron; diens prijzen blijven onbekend.'))
    } catch (cause) {
      if (ticket === revision.current) setMessage(
        cause instanceof Error ? cause.message : 'De nieuwere winkelopname kon niet worden ingelezen.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }

  function undoStoreReplacement() {
    if (!undoSnapshot || busy) return
    ++revision.current
    try {
      // Restoring a preview is NOT approval of an old retailer price.
      // Recheck the captured original time with the current device clock.
      const data = parseOfflinePriceSnapshots(undoSnapshot.normalized, Date.now())
      setDraft(undoSnapshot.raw)
      setPreview({ ...undoSnapshot, data })
      setUndoSnapshot(null)
      setUpdateDraft('')
      setMessage('Vorige eigen winkelopname(s) in de lokale preview hersteld. Open Vergelijk opnieuw om deze bron te beoordelen; oude of verlopen prijzen blijven onbekend.')
    } catch {
      setMessage('Vorige lokale opname kan niet opnieuw worden toegelaten. Controleer de originele bron en actuele apparaatklok.')
    }
  }

  function changeSeparateDraft(store: 'PLUS' | 'DekaMarkt', raw: string) {
    ++revision.current
    setSeparateDrafts(previous => ({ ...previous, [store]: raw }))
    setPreview(null); setUndoSnapshot(null)
    setMessage('Winkelbron gewijzigd. Controleer beide originele bronnen opnieuw.')
  }

  // Each paste is checked as an original single-retailer capture first.
  async function inspectSeparateDrafts() {
    const ticket = ++revision.current
    setPreview(null); setUndoSnapshot(null); setMessage(''); setBusy(true)
    try {
      const provided = (['PLUS', 'DekaMarkt'] as const)
        .filter(store => separateDrafts[store].trim().length > 0)
      if (!provided.length) throw new Error('Plak eerst PLUS en/of DekaMarkt-bronregels.')
      const captures: unknown[] = []
      let singleNormalized = ''
      for (const store of provided) {
        const raw = separateDrafts[store]
        if (new TextEncoder().encode(raw).length > limit)
          throw new Error(store + ': maximaal 256 kB aan originele bronregels.')
        const normalized = await normalizedOwnSource(raw)
        if (ticket !== revision.current) return
        const checked = parseOfflinePriceSnapshots(normalized, Date.now())
        if (Object.keys(checked.captures).length !== 1 || !checked.captures[store])
          throw new Error(store + ': bron bevat niet precies deze winkel. Controleer de originele retailer-ID.')
        const original = JSON.parse(normalized) as { captures?: unknown[] }
        if (!Array.isArray(original.captures) || original.captures.length !== 1)
          throw new Error(store + ': originele opname niet herkenbaar.')
        captures.push(original.captures[0])
        singleNormalized = normalized
      }
      const normalized = provided.length === 1 ? singleNormalized
        : JSON.stringify({ schema: 'supa-offline-prices-v1', captures })
      if (new TextEncoder().encode(normalized).length > limit)
        throw new Error('Gecombineerde winkelbronnen zijn groter dan 256 kB.')
      const data = parseOfflinePriceSnapshots(normalized, Date.now())
      if (ticket !== revision.current) return
      setDraft(normalized)
      setPreview({ raw: normalized, normalized, data })
      setMessage(provided.length === 2
        ? 'Twee originele bronnen lokaal gecombineerd. Controleer de SKU’s en bronmomenten in Vergelijk.'
        : provided[0] + ' lokaal herkend; de andere winkel blijft ongeprijsd.')
    } catch (cause) {
      if (ticket === revision.current)
        setMessage(cause instanceof Error ? cause.message : 'Winkelbronnen niet herkend.')
    } finally {
      if (ticket === revision.current) setBusy(false)
    }
  }

  async function pasteClipboard() {
    const ticket = ++revision.current
    setPreview(null); setUndoSnapshot(null); setMessage('')
    try {
      if (!navigator.clipboard?.readText) throw new Error('Klembord niet beschikbaar')
      const raw = await navigator.clipboard.readText()
      if (ticket !== revision.current) return
      if (new TextEncoder().encode(raw).length > limit)
        throw new Error('Klembord groter dan 256 kB.')
      setDraft(raw)
      setMessage('Gekopieerde bron lokaal geplakt. Controleer hem voor import.')
    } catch {
      if (ticket === revision.current)
        setMessage('Klembord niet beschikbaar. Plak handmatig in het tekstvak.')
    }
  }
  const nextSourceToCapture = (() => {
    if (!preview) return null
    const shops = preview.data.captures
    const stale = (['PLUS', 'DekaMarkt'] as const).find(store =>
      shops[store] && !recentOwnCaptureInstant(shops[store]!.observedAt, now))
    if (stale) return stale
    const missing = (['PLUS', 'DekaMarkt'] as const).find(store => !shops[store])
    if (missing) return missing
    if (shops.PLUS && shops.DekaMarkt && !preview.data.pairedWithin24h)
      return shops.PLUS.observedNs <= shops.DekaMarkt.observedNs ? 'PLUS' : 'DekaMarkt'
    return null
  })()

  function downloadCanonicalPreview() {
    if (!preview || preview.raw !== draft) return
    try {
      // Re-admit the actual local source at export time, never transform
      // unavailable, stale or unreviewed prices into confirmed basket totals.
      const current = parseOfflinePriceSnapshots(preview.normalized, Date.now())
      const count = Object.keys(current.captures).length
      const bytes = new TextEncoder().encode(preview.normalized)
      if (bytes.length > limit) throw new Error('Genormaliseerde bron te groot.')
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = count === 2
          ? 'supa-mijn-eigen-plus-deka-bronnen.json'
          : 'supa-mijn-eigen-winkelbron.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setMessage('Gecontroleerde structuur lokaal opgeslagen. Dit is geen bewijs van actuele prijzen of bronrechten.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Lokale export mislukt.')
    }
  }

  function handoff(focus?: { store: 'PLUS' | 'DekaMarkt'; ingredientId: string }) {
    if (!preview || preview.raw !== draft) return
    try {
      const current = parseOfflinePriceSnapshots(preview.normalized, Date.now())
      // Old sources may still be inspected or renewed. Only the canonical
      // Workbench can admit an amount into a current complete basket.
      if (!current.currentEnough) {
        setMessage('Oude opname: in Vergelijk alleen voor broncontrole of vernieuwing; geen actueel prijsverschil.')
      }
      const file = new File([preview.normalized], 'supa-eigen-winkelbron.json',
        { type: 'application/json' })
      if (file.size > limit) throw new Error('Genormaliseerde bron te groot.')
      if (focus && (!current.captures[focus.store] ||
          !recentOwnCaptureInstant(current.captures[focus.store]!.observedAt, Date.now()))) {
        throw new Error('De gekozen winkelopname is niet actueel. Vernieuw eerst je echte bron.')
      }
      onImport([file])
      // Existing App review intent merely focuses an ingredient after the
      // canonical Workbench import. It does not approve a price or source.
      if (focus) onReviewIngredient?.(focus.store, focus.ingredientId)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Importeren niet mogelijk.')
    }
  }
  return <details className="supa-planner-source-paste" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Plak winkelprijzen vanuit spreadsheet of JSON</summary>
    {open && <>
      <p>Gebruik alleen zelf rechtmatig verkregen PLUS/Deka-productdata. Plak de negen
        Supa-kolommen als CSV, puntkomma-CSV of tabgescheiden spreadsheet, of
        eigen JSON met één of beide winkels. Alles wordt lokaal gecontroleerd:
        een geldige import bewijst geen bronrechten of actuele winkelprijzen.</p>
      <div className={'supa-planner-source-paste__drop' + (dropActive ? ' is-dragging' : '')}
        onDragOver={event => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropActive(true)
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropActive(false)
        }}
        onDrop={event => {
          if (!Array.from(event.dataTransfer.types).includes('Files')) return
          event.preventDefault()
          setDropActive(false)
          void previewFiles(Array.from(event.dataTransfer.files))
        }}>
        <strong>{dropActive
          ? 'Laat de eigen winkelbestanden los om eerst de bron te controleren'
          : 'Sleep hier je eigen PLUS-/Deka-bestand(en) voor een lokale preview'}</strong>
      <label>Of bekijk eerst één of twee eigen CSV-, TSV- of JSON-bestanden
        <input type="file" multiple accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json"
          onChange={event => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length) void previewFiles(files)
          }} />
        <small>Eén bestand mag beide winkels bevatten; twee aparte bestanden moeten ieder precies één verschillende winkel bevatten.</small>
      </label>
      </div>
      <div className="supa-planner-source-paste__separate">
        <strong>Heb je twee losse spreadsheetselecties? Plak ze per winkel.</strong>
        <p>De winkelidentiteit moet in de originele negen kolommen staan. Supa voegt
          alleen gecontroleerde winkelopnames samen; prijzen blijven ongeverifieerd
          tot je de producten en verpakkingen in Vergelijk beoordeelt.</p>
        {(['PLUS', 'DekaMarkt'] as const).map(store => <label key={store}>
          {store} — eigen CSV-, TSV- of JSON-bron
          <textarea rows={4} spellCheck={false} value={separateDrafts[store]}
            placeholder="retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available"
            onChange={event => changeSeparateDraft(store, event.target.value)} />
        </label>)}
        <button type="button" disabled={busy ||
          (!separateDrafts.PLUS.trim() && !separateDrafts.DekaMarkt.trim())}
          onClick={() => void inspectSeparateDrafts()}>
          Controleer losse winkelbronnen en maak één import
        </button>
      </div>
      <button type="button" className="ghost-button" onClick={() => void pasteClipboard()}>
        Plak uit mijn klembord
      </button>
      <label>Originele winkelregels
        <textarea rows={7} value={draft} spellCheck={false} maxLength={256000}
          placeholder="retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available"
          onChange={event => changeDraft(event.currentTarget.value)} />
      </label>
      <button type="button" disabled={busy || !draft.trim()} onClick={() => void inspect()}>
        {busy ? 'Bron wordt lokaal gelezen…' : 'Controleer mijn winkelbron'}
      </button>
      {message && <p role="status" aria-live="polite">{message}</p>}
      {preview && <div className="supa-planner-source-paste__preview">
        <strong>{Object.keys(preview.data.captures).length} eigen winkelopname(s) gevonden</strong>
        {(['PLUS', 'DekaMarkt'] as const).map(store => {
          const capture = preview.data.captures[store]
          if (!capture) return <p key={store}>{store}: geen bron; geen prijs beschikbaar.</p>
          const priced = capture.products.filter(p => p.sourceAvailable === true &&
            p.sourcePriceCents !== null && p.packAmount !== null).length
          return <section key={store}>
            <h4>{store}</h4>
            <p>{capture.products.length} originele SKU's;
              {' '}{priced} met vastgelegde (niet per se actuele) pakprijs en
              {' '}{capture.products.length - priced} zonder bruikbare prijs.</p>
            <small>Oorspronkelijk bronmoment: {dateText.format(new Date(capture.observedMs))}</small>
            <details className="supa-planner-source-paste__products">
              <summary>Bekijk originele SKU’s, verpakkingen en ontbrekende prijzen</summary>
              <p>Bronpreview, geen geaccepteerde matching of actueel winkelmandtotaal.
                De maximaal twaalf weergegeven producten komen uit je eigen opname.</p>
              <ul>
                {[...capture.products].sort((a, b) => {
                  const missing = (item: typeof a) =>
                    item.sourcePriceCents === null || !item.sourceAvailable ||
                    item.packAmount === null ? 0 : 1
                  return missing(a) - missing(b)
                }).slice(0, 12).map(product => {
                  const priced = product.sourcePriceCents !== null &&
                    product.sourceAvailable === true && product.packAmount !== null
                  const rate = priced ? privatePackUnitRate({
                    amount: product.packAmount, unit: product.packUnit,
                    count: product.packCount ?? 1, priceCents: product.sourcePriceCents ?? null,
                  }) : null
                  return <li key={product.id}>
                    <strong>{product.name}</strong> — SKU {product.id}
                    <span>{product.packAmount ?? 'onbekend'} {product.packUnit}
                      {product.packCount && product.packCount > 1
                        ? ' × ' + product.packCount + ' per verpakking' : ' per verpakking'}</span>
                    <span>{!product.sourceAvailable
                      ? 'Niet beschikbaar volgens eigen bron; geen pakprijs'
                      : !priced
                        ? 'Pakprijs of verpakking ontbreekt'
                        : money.format(product.sourcePriceCents! / 100) +
                          ' per pak · ' + (rate ? formatPrivateUnitRate(rate) : 'eenheidsprijs onbekend')}</span>
                  </li>
                })}
              </ul>
              {capture.products.length > 12 &&
                <small>Overige {capture.products.length - 12} originele SKU’s bekijk je in Vergelijk.</small>}
            </details>
          </section>
        })}
        <p>{!liveAdmission?.currentEnough
          ? 'Oude of toekomstige bron. Vernieuw je werkelijke waarnemingen.'
          : preview.data.pairedWithin24h
            ? 'Beide opnames binnen 24 uur; SKU, pakken en volledige mand nog te controleren.'
            : Object.keys(preview.data.captures).length === 2
              ? 'Bronmomenten meer dan 24 uur uiteen: geen volledig prijsverschil mogelijk.'
              : 'Nog maar één winkelbron. De andere winkel blijft ongeprijsd.'}</p>
        {!liveAdmission && <p role="alert">
          De bronopname is niet geldig voor de actuele apparaatklok of invoer.
          Controleer het bronmoment opnieuw voordat er een kandidaat kan worden voorgesteld.
        </p>}
        {hasDemand && needs.length > 0 && liveAdmission &&
          <PlannerSourceMatchPreview needs={needs} source={liveAdmission}
            onRecapture={onRecapture}
            onReviewIngredient={onReviewIngredient
              ? (store, ingredientId) => handoff({ store, ingredientId })
              : undefined} />}
        <button type="button" disabled={!hasDemand}
          onClick={() => handoff()}>Open mijn bron in Vergelijk voor productmatching</button>
        <button type="button" className="ghost-button"
          onClick={downloadCanonicalPreview}>
          Download mijn gecombineerde winkelbron als lokaal JSON-bestand
        </button>
        <label className="supa-planner-source-paste__refresh">
          Werk één winkel bij, behoud de originele andere opname
          <input type="file" disabled={busy}
            accept=".csv,.tsv,.json,.txt,text/csv,text/plain,text/tab-separated-values,application/json"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void useNewStoreCapture(file)
            }} />
          <small>Gebruik één nieuwe PLUS- of DekaMarkt-bron met een later werkelijk
            opnamemoment. Supa vervangt die winkel als geheel, bewaart de andere
            originele SKU’s en hercontroleert de 24-uursgrens. Geen prijs of
            verpakking wordt automatisch goedgekeurd.</small>
        </label>
        <label className="supa-planner-source-paste__refresh">
          Of plak de nieuwere bron van één winkel
          <textarea rows={4} spellCheck={false} value={updateDraft}
            maxLength={256000} placeholder="retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available"
            onChange={event => {
              ++revision.current
              setUpdateDraft(event.currentTarget.value)
              setBusy(false)
            }} />
        </label>
        <button type="button" className="ghost-button"
          disabled={busy || !updateDraft.trim()}
          onClick={() => void useNewStoreCapture(new File(
            [updateDraft], 'supa-geplakte-nieuwe-winkelbron.csv',
            { type: 'text/plain;charset=utf-8' }))}>
          Vernieuw alleen deze winkel met geplakte bronregels
        </button>
        {undoSnapshot && <button type="button" className="ghost-button"
          disabled={busy} onClick={undoStoreReplacement}>
          Herstel vorige eigen winkelopname in deze preview
        </button>}
        {nextSourceToCapture && <button type="button" className="ghost-button"
          onClick={() => onRecapture(nextSourceToCapture)}>
          Open leeg opnameblad voor {nextSourceToCapture} en leg echte prijzen vast
        </button>}
        {!hasDemand && <small>Kies eerst recepten in je Planner-weekmenu.</small>}
      </div>}
    </>}
  </details>
}
