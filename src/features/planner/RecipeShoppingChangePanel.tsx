import { useState } from 'react'
import { recipeShoppingChangeText, type RecipeShoppingChange } from './recipeShoppingChange.ts'
import { makeBlankPlannerCaptureCsv } from '../comparison/plannerPriceCaptureSheet.ts'
import { makePlannerCaptureGuide } from '../comparison/plannerPriceCaptureGuide.ts'
import { nextWeekPhysicalItems, nextWeekPhysicalListText, nextWeekPhysicalListCsv } from './recipeNextWeekList.ts'
import { proposedWeekCaptureKit } from './proposedWeekCaptureKit.ts'
import type { CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'

/** Source-free physical shopping preview; no SKU or stored retailer price. */
export function RecipeShoppingChangePanel({ preview, day }: {
  preview: RecipeShoppingChange
  day: string
}) {
  const [notice, setNotice] = useState('')
  const [showCopy, setShowCopy] = useState(false)
  const [showFullCopy, setShowFullCopy] = useState(false)
  const [captureGuideCopy, setCaptureGuideCopy] = useState<{ stores: string; text: string; identity: string } | null>(null)
  const [captureTableCopy, setCaptureTableCopy] = useState<{ stores: string; text: string; identity: string } | null>(null)
  if (preview.status !== 'ready') return <section className="recipe-reuse-preview-shopping"
    aria-label="Boodschappenwijziging niet beschikbaar">
    <h4>Nieuwe boodschappen nog niet betrouwbaar</h4>
    <p role="alert">{preview.reason}</p>
    <p>Controleer de hoeveelheden in Recepten. Er wordt geen product of prijs aangenomen.</p>
  </section>
  // Capture the narrowed immutable week demand before nested download callbacks.
  const nextNeeds = preview.nextNeeds
  const completeWeek = nextWeekPhysicalItems(preview)
  // A copied field guide belongs to exactly this proposed physical demand.
  const previewIdentity = JSON.stringify([day, ...completeWeek.map(item =>
    [item.id, item.label, item.amount, item.unit])])
  function getFullText() { return nextWeekPhysicalListText(preview, day) }
  const added = preview.changes.filter(line => line.kind === 'added').length
  const removed = preview.changes.filter(line => line.kind === 'removed').length
  const updated = preview.changes.filter(line => line.kind === 'changed').length
  function getText() { return recipeShoppingChangeText(preview, day) }
  function download() {
    try {
      const url = URL.createObjectURL(new Blob([getText()], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-ongeprijsde-receptwijziging.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('De fysieke boodschappenwijziging is lokaal opgeslagen, zonder winkelprijzen.')
    } catch { setNotice('Kan het voorstel niet downloaden. Selecteer de kopieertekst hieronder.') ; setShowCopy(true) }
  }
  function downloadCapture(kind: 'csv' | 'guide') {
    try {
      // The two existing import formats share the SAME next-week physical
      // requirements and row order. No retailer product or price is invented.
      const stores = ['PLUS', 'DekaMarkt'] as const
      const output = kind === 'csv'
        ? makeBlankPlannerCaptureCsv(nextNeeds, stores, ';')
        : makePlannerCaptureGuide(nextNeeds, stores)
      const url = URL.createObjectURL(new Blob([output], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = kind === 'csv'
          ? 'supa-nieuw-weekmandje-leeg-plus-deka.csv'
          : 'supa-nieuw-weekmandje-opnamegids.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice(kind === 'csv' ? 'Leeg broninvulblad voor het voorgestelde nieuwe weekmandje opgeslagen.' :
        'Bijpassende opnamegids opgeslagen. Volg dezelfde rijvolgorde als de lege CSV.')
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Kan het broninvulblad niet maken.')
    }
  }

  function saveCaptureKitFile(filename: string, contents: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      try { link.click() } finally { link.remove() }
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }
  function downloadStoreCapture(stores: readonly CaptureStore[], part: 'csv' | 'guide') {
    try {
      const kit = proposedWeekCaptureKit(preview, stores)
      saveCaptureKitFile(part === 'csv' ? kit.csvFilename : kit.guideFilename,
        part === 'csv' ? kit.csv : kit.guide,
        part === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8')
      setNotice('Alleen een leeg ' + stores.join(' + ') + '-invulbestand opgeslagen: nog geen bronprijzen.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kan het winkelopnameblad niet downloaden.')
    }
  }

  async function copyStoreCaptureTable(stores: readonly CaptureStore[]) {
    try {
      // TSV can be pasted directly as individual spreadsheet columns and can
      // be ingested later by the existing source converter after actual facts
      // have been filled in. No product identity or price is inserted by Supa.
      const kit = proposedWeekCaptureKit(preview, stores)
      const table = makeBlankPlannerCaptureCsv(nextNeeds, kit.stores, '\t')
      if (typeof navigator.clipboard?.writeText !== 'function')
        throw new Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(table)
      setCaptureTableCopy(null)
      setNotice('Lege ' + stores.join(' + ') + '-tabel gekopieerd: plak in Excel of Sheets en vul je eigen originele brongegevens in.')
    } catch {
      try {
        const kit = proposedWeekCaptureKit(preview, stores)
        setCaptureTableCopy({
          stores: stores.join(' + '),
          text: makeBlankPlannerCaptureCsv(nextNeeds, kit.stores, '\t'),
          identity: previewIdentity,
        })
        setNotice('Klembord niet beschikbaar. Selecteer de tabgescheiden tabel hieronder.')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Leeg winkelinvulblad is niet beschikbaar.')
      }
    }
  }
  async function copyStoreCaptureGuide(stores: readonly CaptureStore[]) {
    try {
      const kit = proposedWeekCaptureKit(preview, stores)
      if (typeof navigator.clipboard?.writeText !== 'function')
        throw new Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(kit.guide)
      setCaptureGuideCopy(null)
      setNotice('Ongeprijsde ' + stores.join(' + ') + '-opnamegids gekopieerd. Je plan blijft ongewijzigd.')
    } catch {
      try {
        const kit = proposedWeekCaptureKit(preview, stores)
        setCaptureGuideCopy({ stores: stores.join(' + '), text: kit.guide, identity: previewIdentity })
        setNotice('Klembord niet beschikbaar. Selecteer en kopieer de gids hieronder.')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'De opnamegids is niet beschikbaar.')
      }
    }
  }
  async function shareStoreCapture(stores: readonly CaptureStore[]) {
    try {
      const kit = proposedWeekCaptureKit(preview, stores)
      const files = [
        new File([kit.csv], kit.csvFilename, { type: 'text/csv;charset=utf-8' }),
        new File([kit.guide], kit.guideFilename, { type: 'text/plain;charset=utf-8' }),
      ]
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' ||
          !navigator.canShare({ files })) {
        // Avoid automatic multiple downloads: mobile browsers often suppress
        // the second download. The user can request the accompanying guide.
        downloadStoreCapture(stores, 'csv')
        setNotice('Deeloptie niet beschikbaar. Lege CSV gedownload; de gids kun je apart opslaan.')
        return
      }
      await navigator.share({ title: 'Supa · ' + stores.join(' en ') + ' opnamepakket', files })
      setNotice('Lege ' + stores.join(' + ') + '-CSV en bijpassende gids gedeeld. Geen prijsbron toegevoegd.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setNotice('Winkelopname delen geannuleerd; je plan en brondata zijn ongewijzigd.')
      } else {
        setNotice('Delen niet beschikbaar. Download de winkel-CSV en opnamegids hieronder apart.')
      }
    }
  }

  function downloadFullWeek() {
    try {
      const url = URL.createObjectURL(new Blob([getFullText()], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-voorstel-volledige-weekboodschappen.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('De volledige voorgestelde weeklijst is ongeprijsd lokaal opgeslagen.')
    } catch {
      setNotice('Download mislukt. Selecteer de volledige lijst hieronder om zelf te kopiëren.')
      setShowFullCopy(true)
    }
  }
  function downloadFullWeekCsv() {
    try {
      const csv = nextWeekPhysicalListCsv(preview, day)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-voorstel-volledige-weekboodschappen.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setNotice('Ongeprijsde volledige voorgestelde weeklijst als spreadsheet opgeslagen.')
    } catch {
      setNotice('Spreadsheet downloaden mislukt. Gebruik de tekstlijst of kopieeroptie.')
      setShowFullCopy(true)
    }
  }
  async function shareFullWeekCsv() {
    try {
      const csv = nextWeekPhysicalListCsv(preview, day)
      const file = new File([csv], 'supa-voorstel-volledige-weekboodschappen.csv', {
        type: 'text/csv;charset=utf-8',
      })
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' ||
          !navigator.canShare({ files: [file] })) {
        downloadFullWeekCsv()
        return
      }
      await navigator.share({ files: [file], title: 'Supa · ongeprijsd weekvoorstel' })
      setNotice('Ongeprijsde weeklijst als CSV gedeeld; je planning blijft ongewijzigd.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setNotice('Delen geannuleerd. Je planning blijft ongewijzigd.')
      } else {
        setNotice('CSV delen niet beschikbaar. Download het bestand en deel het vanuit je bestanden.')
      }
    }
  }
  async function shareFullWeek() {
    try {
      const output = getFullText()
      if (typeof navigator.share !== 'function') {
        await copyFullWeek()
        return
      }
      await navigator.share({
        title: 'Supa · voorgestelde ongeprijsde weekboodschappen',
        text: output,
      })
      setNotice('Voorgestelde weeklijst gedeeld, zonder winkelprijzen.')
    } catch (error) {
      // Cancelling the native share sheet must not trigger an unexpected copy.
      if (error instanceof Error && error.name === 'AbortError') {
        setNotice('Delen geannuleerd. Je weekplanning is niet aangepast.')
      } else {
        setNotice('Delen niet beschikbaar. Gebruik de kopieeroptie of selecteer de lijst hieronder.')
        setShowFullCopy(true)
      }
    }
  }
  async function copyFullWeek() {
    try {
      const output = getFullText()
      if (!navigator.clipboard?.writeText) throw new Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(output)
      setNotice('Volledige voorgestelde weeklijst gekopieerd, zonder winkelprijzen.')
    } catch {
      setNotice('Kopiëren niet beschikbaar. Selecteer hieronder de volledige lijst.')
      setShowFullCopy(true)
    }
  }
  async function copy() {
    try {
      const output = getText()
      if (!navigator.clipboard?.writeText) throw Error('Klembord niet beschikbaar')
      await navigator.clipboard.writeText(output)
      setNotice('Fysieke boodschappenwijziging gekopieerd, zonder supermarktprijzen.')
    } catch {
      setNotice('Selecteer de ongeprijsde tekst hieronder om zelf te kopiëren.')
      setShowCopy(true)
    }
  }
  return <section className="recipe-reuse-preview-shopping"
    aria-label="Voorlopige fysieke boodschappenwijziging">
    <h4>Wat verandert er aan je hele weekmandje?</h4>
    <p><strong>{added} nieuw</strong> · <strong>{removed} vervalt</strong> ·
      {' '}<strong>{updated} andere hoeveelheid</strong> ·
      {' '}{preview.previousCount} → {preview.nextCount} fysieke ingrediënten.</p>
    <p>Ook andere dagen tellen mee. Dezelfde ingrediënten worden eerst samengevoegd;
      hoeveelheden zijn metrisch (g/ml) of hele stuks, zonder een prijs te schatten.</p>
    {preview.changes.length === 0 ? <p>De fysieke boodschappenbehoefte verandert niet.</p> :
      <ul className="recipe-reuse-preview-shopping__rows">
        {preview.changes.map(line => <li key={line.id}>
          <strong>{line.label}</strong>
          <span>{line.kind === 'added' ? 'Nieuw' :
            line.kind === 'removed' ? 'Vervalt' : 'Andere hoeveelheid'}</span>
          <span>{line.before ?? 'Niet nodig'} → {line.after ?? 'Niet nodig'}</span>
        </li>)}
      </ul>}
    <details className="recipe-reuse-preview-shopping__full">
      <summary>Bekijk volledige nieuwe weeklijst ({completeWeek.length} ingrediënten)</summary>
      <p>Alle actieve dagen samen; dit is je voorgestelde fysieke behoefte, niet alleen de wijziging.</p>
      {completeWeek.length === 0 ? <p>Geen fysieke ingrediënten nodig.</p> :
        <ul className="recipe-reuse-preview-shopping__rows">
          {completeWeek.map(item => <li key={item.id}>
            <strong>{item.label}</strong>
            <span>{String(item.amount).replace('.', ',')} {item.unit === 'piece' ? 'stuks' : item.unit}</span>
          </li>)}
        </ul>}
    </details>
    <p><strong>Prijsverschil nog onbekend.</strong> Na je receptkeuze moeten
      de volledige fysieke mandjes en oorspronkelijke PLUS/Deka-SKU’s opnieuw
      worden gecontroleerd. Oude productmatches zijn geen geldige nieuwe vergelijking.</p>
    <div className="recipe-reuse-preview-shopping__actions">
      <button type="button" className="ghost-button" onClick={() => void copyFullWeek()}>
        Kopieer voorgestelde weekboodschappen
      </button>
      <button type="button" className="ghost-button" onClick={() => void shareFullWeek()}>
        Deel voorgestelde weekboodschappen
      </button>
      <details className="recipe-reuse-preview-shopping__full">
        <summary>Downloaden en uitgebreide export (TXT / CSV)</summary>
        <div className="recipe-reuse-preview-shopping__actions">
          <button type="button" className="ghost-button" onClick={downloadFullWeek}>Volledige weeklijst als TXT</button>
          <button type="button" className="ghost-button" onClick={downloadFullWeekCsv}>Volledige weeklijst als CSV</button>
          <button type="button" className="ghost-button" onClick={() => void shareFullWeekCsv()}>Deel CSV-bestand</button>
          <button type="button" className="ghost-button" onClick={download}>Alleen de boodschappenwijzigingen als TXT</button>
          <button type="button" className="ghost-button" onClick={() => void copy()}>Kopieer alleen wijzigingen</button>
        </div>
      </details>
      <details className="recipe-reuse-preview-shopping__full">
        <summary>Winkelopname voorbereiden · PLUS / DekaMarkt</summary>
        <p>Je voorgestelde recept moet eerst worden gekozen om de eigen
          winkelbronbestanden daarna via Vergelijk te importeren. Oude
          bronmomenten of SKU-matches worden niet als nieuw bewijs hergebruikt.</p>
        <div className="recipe-reuse-preview-shopping__actions">
          <button type="button" className="ghost-button" onClick={() => downloadCapture('csv')}>
            Leeg gecombineerd PLUS/Deka-broninvulblad
          </button>
          <button type="button" className="ghost-button" onClick={() => downloadCapture('guide')}>
            Bijpassende gecombineerde opnamegids
          </button>
        </div>
        <p>Vul alleen de echte winkelproductgegevens in de bijpassende CSV in.
          De gids vermeldt per rij welk fysiek ingrediënt je zoekt.
          Elke winkel kan afzonderlijk via de bestaande Vergelijk-import worden verwerkt.</p>
        {(['PLUS', 'DekaMarkt'] as const).map(store => <div key={store}
          className="recipe-reuse-preview-shopping__capture-store">
          <strong>{store}</strong>
          <button type="button" className="ghost-button"
            onClick={() => void shareStoreCapture([store])}>Deel leeg CSV + gids (mobiel)</button>
          <button type="button" className="ghost-button"
            onClick={() => downloadStoreCapture([store], 'csv')}>Download lege {store}-CSV</button>
          <button type="button" className="ghost-button"
            onClick={() => downloadStoreCapture([store], 'guide')}>Download {store}-opnamegids</button>
          <button type="button" className="ghost-button"
            onClick={() => void copyStoreCaptureGuide([store])}>Kopieer {store}-opnamegids (mobiel)</button>
          <button type="button" className="ghost-button"
            onClick={() => void copyStoreCaptureTable([store])}>
            Kopieer lege {store}-tabel voor Excel/Sheets
          </button>
        </div>)}
        <button type="button" className="ghost-button"
          onClick={() => void shareStoreCapture(['PLUS', 'DekaMarkt'])}>
          Deel gecombineerd leeg PLUS + DekaMarkt-opnamepakket
        </button>
      </details>
    </div>
    <small>De invulbladen bevatten geen bronproducten of bedragen en horen alleen bij dit
      voorgestelde weekmenu. Kies het recept eerst en vul uitsluitend echt waargenomen
      brongegevens in voordat je de CSV via Vergelijk importeert.</small>
    {captureTableCopy?.identity === previewIdentity && <label>
      Lege {captureTableCopy.stores}-invultabel (tabgescheiden) zelf kopiëren
      <textarea readOnly rows={10} value={captureTableCopy.text}
        onFocus={event => event.currentTarget.select()} />
      <small>Dit bevat geen echte winkelproducten, prijzen of opnames. Vul die zelf in.</small>
    </label>}
    {captureGuideCopy?.identity === previewIdentity && <label>Opnamegids voor {captureGuideCopy.stores} handmatig kopiëren
      <textarea readOnly rows={12} value={captureGuideCopy.text}
        onFocus={event => event.currentTarget.select()} />
      <small>Dit is alleen je voorgestelde fysieke behoefte. Geen retailerprijs of bewijs.</small>
    </label>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {showFullCopy && <label>Volledige voorgestelde weeklijst zelf kopiëren (zonder prijzen)
      <textarea readOnly rows={Math.min(completeWeek.length + 7, 16)}
        value={getFullText()} onFocus={event => event.currentTarget.select()} />
    </label>}
    {showCopy && <label>Zelf kopiëren (zonder prijzen)
      <textarea readOnly rows={Math.min(preview.changes.length + 7, 16)}
        value={getText()} onFocus={event => event.currentTarget.select()} />
    </label>}
  </section>
}
