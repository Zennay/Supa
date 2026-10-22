import { useRef, useState } from 'react'
import { exportManualOwnSourceDraft, importManualOwnSourceDraft, MANUAL_DRAFT_MAX_BYTES, type ManualSources } from './manualOwnSourceDraft.ts'
import type { OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import './manualOwnSourceEntry.css'

type Store = 'PLUS' | 'DekaMarkt'
type Field = 'id' | 'name' | 'packAmount' | 'packUnit' | 'packCount' | 'priceCents' | 'available'
type Entry = Record<Field, string>
type Source = { observedAt: string; products: Entry[] }

const STORES: readonly Store[] = ['PLUS', 'DekaMarkt']
const FIELDS: readonly Field[] = ['id', 'name', 'packAmount', 'packUnit', 'packCount', 'priceCents', 'available']
const HEADER = [
  'retailer', 'observedAt', 'id', 'name', 'packAmount',
  'packUnit', 'packCount', 'priceCents', 'available',
] as const
const emptyEntry = (): Entry => ({
  id: '', name: '', packAmount: '', packUnit: '', packCount: '',
  priceCents: '', available: '',
})
const initialSource = (): Source => ({ observedAt: '', products: [emptyEntry()] })
const csvCell = (value: string) =>
  /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value

/** UI-only serializer. The existing CSV converter and private source admission
 * still validate every SKU, timestamp, pack, availability and price. */
function serializeManualCapture(sources: Record<Store, Source>): string {
  const rows: string[][] = []
  for (const store of STORES) {
    const source = sources[store]
    const products = source.products.filter(product =>
      Object.values(product).some(value => value.trim() !== ''))
    if (source.observedAt.trim() && products.length === 0)
      throw new Error(store + ': voeg ten minste één echt geobserveerd product toe.')
    if (products.length === 0) continue
    if (!source.observedAt.trim())
      throw new Error(store + ': vul het oorspronkelijke bronmoment in, inclusief tijdzone.')
    for (const product of products) {
      // Do not trim or normalize source facts: canonical admission must reject
      // unreviewed/unsafe identifiers rather than silently editing evidence.
      rows.push([store, source.observedAt, ...FIELDS.map(key => product[key])])
    }
  }
  if (!rows.length)
    throw new Error('Vul eerst een daadwerkelijk geobserveerd product bij PLUS of DekaMarkt in.')
  return [HEADER.join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n') + '\n'
}

/** Manual entry is an alternative to preparing a spreadsheet, not an
 * alternative to source rights, original identifiers or user review. */
export function ManualOwnSourceEntry({ onPreview, busy, template }: {
  onPreview: (raw: string) => void
  busy: boolean
  template: OfflinePriceSnapshots | null
}) {
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<Record<Store, Source>>({
    PLUS: initialSource(), DekaMarkt: initialSource(),
  })
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [pendingDraft, setPendingDraft] = useState<ManualSources | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ManualSources | null>(null)
  const readTicket = useRef(0)
  function invalidateRestore() {
    ++readTicket.current
    setPendingDraft(null)
    setPendingTemplate(null)
    setBackupMessage('')
    setAcknowledged(false); setError('')
  }

  function updateSource(store: Store, observedAt: string) {
    setSources(previous => ({ ...previous, [store]: { ...previous[store], observedAt } }))
    invalidateRestore()
  }
  function updateProduct(store: Store, index: number, field: Field, value: string) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: previous[store].products.map((entry, i) =>
          i === index ? { ...entry, [field]: value } : entry),
      },
    }))
    invalidateRestore()
  }
  function addProduct(store: Store) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: [...previous[store].products, emptyEntry()],
      },
    }))
    invalidateRestore()
  }
  function removeProduct(store: Store, index: number) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: previous[store].products.filter((_, i) => i !== index),
      },
    }))
    invalidateRestore()
  }
  function stageOriginalIdentifiers() {
    if (!template) return
    const reused = {} as ManualSources
    for (const store of STORES) {
      const products = template.captures[store]?.products ?? []
      reused[store] = {
        // Historic observation times cannot become new retail evidence.
        observedAt: '',
        products: products.slice(0, 30).map(product => ({
          id: product.id, name: product.name, packAmount: '', packUnit: '',
          packCount: '', priceCents: '', available: '',
        })),
      }
    }
    setPendingTemplate(reused)
    setPendingDraft(null)
    setBackupMessage('Alleen originele identificaties en namen staan klaar. Geen oude prijs, verpakking, beschikbaarheid of bronmoment is overgenomen.')
  }
  function applyOriginalIdentifiers() {
    if (!pendingTemplate) return
    ++readTicket.current
    setSources(pendingTemplate)
    setPendingTemplate(null)
    setAcknowledged(false)
    setError('')
    setBackupMessage('Originele SKU’s en productnamen overgenomen. Vul alle nieuwe waarnemingen zelf opnieuw in.')
  }
  function downloadDraft() {
    setBackupMessage('')
    try {
      const content = exportManualOwnSourceDraft(sources)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-winkelbron-invulconcept.json'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setBackupMessage('Concept lokaal bewaard, inclusief nog onvolledige velden. Geen geverifieerde prijsbron.')
    } catch (cause) {
      setBackupMessage(cause instanceof Error ? cause.message : 'Concept kon niet worden bewaard.')
    }
  }
  async function readDraft(file: File | undefined) {
    if (!file) return
    const ticket = ++readTicket.current
    setPendingDraft(null); setPendingTemplate(null); setBackupMessage('')
    if (file.size > MANUAL_DRAFT_MAX_BYTES || file.size === 0) {
      setBackupMessage('Kies een ingevuld Supa-invulconcept van maximaal 64 kB.')
      return
    }
    try {
      const raw = await file.text()
      if (ticket !== readTicket.current) return
      const parsed = importManualOwnSourceDraft(raw)
      if (ticket !== readTicket.current) return
      setPendingDraft(parsed)
      setBackupMessage('Concept gelezen maar nog niet overgenomen. Bestaande invoer blijft staan tot bevestiging.')
    } catch (cause) {
      if (ticket === readTicket.current)
        setBackupMessage(cause instanceof Error ? cause.message : 'Conceptbestand ongeldig.')
    }
  }
  function applyDraft() {
    if (!pendingDraft) return
    ++readTicket.current
    setSources(pendingDraft)
    setPendingDraft(null)
    setAcknowledged(false)
    setError('')
    setBackupMessage('Concept hersteld als onbevestigde invoer. Controleer alle bronmomenten en prijzen opnieuw.')
  }
  function preview() {
    setError('')
    if (!acknowledged) {
      setError('Bevestig eerst dat alle productgegevens en bronmomenten daadwerkelijk door jou zijn vastgelegd.')
      return
    }
    try {
      onPreview(serializeManualCapture(sources))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De handmatige bron kon niet worden voorbereid.')
    }
  }

  return <details className="supa-manual-source" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Geen spreadsheet? Voer eigen winkelproducten in via formulier</summary>
    {open && <>
      <p>Maak je eigen PLUS- en/of DekaMarkt-bronblad. Vul <strong>zelf geobserveerde</strong>
        originele artikelcodes, verpakkingen, bedragen in eurocenten en echte
        bronmomenten in. Supa vult geen product, prijs of tijd automatisch aan.
        Ook na dit formulier controleer je de originele SKU’s in Vergelijk.</p>
      {STORES.map(store => {
        const source = sources[store]
        return <fieldset className="supa-manual-source__store" key={store}>
          <legend>{store} — eigen waarneming</legend>
          <label>Werkelijk bronmoment, inclusief tijdzone
            <input type="text" maxLength={40} value={source.observedAt}
              spellCheck={false} autoComplete="off"
              placeholder="JJJJ-MM-DDTuu:mm:ss+02:00"
              onChange={event => updateSource(store, event.currentTarget.value)} />
          </label>
          <small>Alle artikelen hieronder moeten echt op ditzelfde bronmoment zijn
            vastgelegd. Gebruik anders een apart bronbestand; geen geschat moment.</small>
          {source.products.map((product, index) =>
            <div className="supa-manual-source__product" key={index}>
              <div className="supa-manual-source__product-heading">
                <strong>Origineel artikel {index + 1}</strong>
                <button type="button" className="ghost-button"
                  onClick={() => removeProduct(store, index)}>
                  Verwijder regel
                </button>
              </div>
              <div className="supa-manual-source__fields">
                <label>Originele SKU / artikelcode
                  <input type="text" maxLength={100} value={product.id}
                    onChange={event => updateProduct(store, index, 'id', event.currentTarget.value)} />
                </label>
                <label>Originele productnaam
                  <input type="text" maxLength={160} value={product.name}
                    onChange={event => updateProduct(store, index, 'name', event.currentTarget.value)} />
                </label>
                <label>Inhoud per pak
                  <input type="text" inputMode="decimal" maxLength={20} value={product.packAmount}
                    placeholder="Bijv. 500 of 0,75"
                    onChange={event => updateProduct(store, index, 'packAmount', event.currentTarget.value)} />
                </label>
                <label>Eenheid
                  <select value={product.packUnit}
                    onChange={event => updateProduct(store, index, 'packUnit', event.currentTarget.value)}>
                    <option value="">Kies eenheid</option>
                    <option value="g">gram</option><option value="kg">kilogram</option>
                    <option value="ml">milliliter</option><option value="l">liter</option>
                    <option value="piece">stuks</option>
                  </select>
                </label>
                <label>Aantal verpakkingen per multipack
                  <input type="text" inputMode="numeric" maxLength={5} value={product.packCount}
                    placeholder="Origineel aantal (bijv. 1)"
                    onChange={event => updateProduct(store, index, 'packCount', event.currentTarget.value)} />
                </label>
                <label>Waargenomen pakprijs in hele eurocenten
                  <input type="text" inputMode="numeric" maxLength={7} value={product.priceCents}
                    placeholder="Bijv. 249 is € 2,49"
                    onChange={event => updateProduct(store, index, 'priceCents', event.currentTarget.value)} />
                </label>
                <label>Werkelijk beschikbaar volgens je bron
                  <select value={product.available}
                    onChange={event => updateProduct(store, index, 'available', event.currentTarget.value)}>
                    <option value="">Kies beschikbaarheid</option>
                    <option value="true">Ja, beschikbaar</option>
                    <option value="false">Nee, niet beschikbaar</option>
                  </select>
                </label>
              </div>
              <small>Voor een beschikbaar artikel zijn een echte pakinhoud, multipack en
                prijs vereist. Is het artikel daadwerkelijk niet beschikbaar, dan
                mogen die velden leeg blijven. Een onbekend bedrag is nooit € 0.</small>
            </div>)}
          <button type="button" className="ghost-button" disabled={source.products.length >= 30}
            onClick={() => addProduct(store)}>+ Nog een origineel product</button>
          <small>Maximaal 30 producten per winkel via dit formulier. Voor grotere
            bestanden kun je bovenaan CSV of TSV importeren.</small>
        </fieldset>
      })}
      {template && <section className="supa-manual-source__template">
        <h4>Een bestaande eigen winkelbron opnieuw opnemen</h4>
        <p>Herbruik uitsluitend de oorspronkelijke SKU’s en namen van jouw
          al bekeken bron. Oude tijdstempels, prijzen, verpakking en beschikbaarheid
          worden bewust <strong>leeg</strong> gemaakt. Controleer ze opnieuw.</p>
        <button type="button" className="ghost-button" onClick={stageOriginalIdentifiers}>
          Bereid nieuwe opname voor met oude SKU’s (zonder prijzen)
        </button>
        {pendingTemplate && <div className="supa-manual-source__pending" role="status">
          <p>Nieuwe blanco opname: PLUS {pendingTemplate.PLUS.products.length} originele
            {' '}SKU’s; DekaMarkt {pendingTemplate.DekaMarkt.products.length} originele
            {' '}SKU’s. Per winkel maximaal 30; de rest blijft in de originele bron.</p>
          <button type="button" onClick={applyOriginalIdentifiers}>
            Vervang mijn formulier door de lege herhaalopname
          </button>
          <button type="button" className="ghost-button" onClick={() => {
            setPendingTemplate(null)
            setBackupMessage('Herhaalopname geannuleerd. Jouw huidige invoer blijft staan.')
          }}>Annuleer herhaalopname</button>
        </div>}
      </section>}
      <details className="supa-manual-source__backup">
        <summary>Invulconcept bewaren of openen (ook als het nog niet af is)</summary>
        <p>Het invulconcept bevat uitsluitend jouw ingevoerde gegevens. Het wordt
          lokaal gedownload en niet naar Supa verstuurd. Terugzetten maakt
          geen winkelprijzen of bronrechten geldig.</p>
        <button type="button" className="ghost-button" onClick={downloadDraft}>
          Download mijn huidige invulconcept
        </button>
        <label>Open een eerder Supa-invulconcept (.json)
          <input type="file" accept=".json,application/json"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void readDraft(file)
            }} />
        </label>
        {pendingDraft && <div role="status" className="supa-manual-source__pending">
          <p>Concept klaar voor herstel: PLUS {pendingDraft.PLUS.products.length}
            {' '}regels; DekaMarkt {pendingDraft.DekaMarkt.products.length} regels.
            Je huidige invoer wordt alleen na je bevestiging vervangen.</p>
          <button type="button" onClick={applyDraft}>Vervang mijn invoer door dit concept</button>
          <button type="button" className="ghost-button" onClick={() => {
            ++readTicket.current; setPendingDraft(null)
            setBackupMessage('Herstel geannuleerd. Huidige invoer ongewijzigd.')
          }}>Annuleren</button>
        </div>}
        {backupMessage && <p role="status">{backupMessage}</p>}
      </details>
      <label className="supa-manual-source__confirmation">
        <input type="checkbox" checked={acknowledged}
          onChange={event => { setAcknowledged(event.currentTarget.checked); setError('') }} />
        Ik heb deze originele productgegevens en bronmomenten zelf rechtmatig
        verkregen en bewust ingevuld; ik begrijp dat dit geen onafhankelijke
        prijs- of toestemmingsverificatie is.
      </label>
      <button type="button" disabled={busy || !acknowledged} onClick={preview}>
        Zet mijn invoer om naar de bestaande broncontrole
      </button>
      {error && <p role="alert">{error}</p>}
    </>}
  </details>
}
