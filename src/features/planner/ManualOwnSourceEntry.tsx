import { useState } from 'react'
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
export function ManualOwnSourceEntry({ onPreview, busy }: {
  onPreview: (raw: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<Record<Store, Source>>({
    PLUS: initialSource(), DekaMarkt: initialSource(),
  })
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  function updateSource(store: Store, observedAt: string) {
    setSources(previous => ({ ...previous, [store]: { ...previous[store], observedAt } }))
    setAcknowledged(false); setError('')
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
    setAcknowledged(false); setError('')
  }
  function addProduct(store: Store) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: [...previous[store].products, emptyEntry()],
      },
    }))
    setAcknowledged(false); setError('')
  }
  function removeProduct(store: Store, index: number) {
    setSources(previous => ({
      ...previous,
      [store]: {
        ...previous[store],
        products: previous[store].products.filter((_, i) => i !== index),
      },
    }))
    setAcknowledged(false); setError('')
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
              placeholder="2026-10-22T14:35:00+02:00"
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
