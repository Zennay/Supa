import { useState } from 'react'
import type { CaptureStore } from './plannerPriceCaptureSheet.ts'
import type { PlannerCaptureGuideNeed } from './plannerPriceCaptureGuide.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'

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
  onReview?: (files: File[]) => void
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
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    fingerprint: currentFingerprint, needs: [...needs], stores: [...stores],
  }))
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [moments, setMoments] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const changed = snapshot.fingerprint !== currentFingerprint
  const rowKey = (store: CaptureStore, index: number) => store + ':' + index
  const row = (store: CaptureStore, index: number) => rows[rowKey(store, index)] ?? empty()
  function edit(store: CaptureStore, index: number, field: Field, value: string) {
    setRows(old => {
      const key = rowKey(store, index)
      return { ...old, [key]: { ...(old[key] ?? empty()), [field]: value } }
    })
    setStatus('')
    onDraftChange?.()
  }
  function moment(store: CaptureStore, value: string) {
    setMoments(old => ({ ...old, [store]: value }))
    setStatus('')
    onDraftChange?.()
  }
  function reset() {
    if (Object.values(rows).some(r => r.state !== 'unseen') &&
      !window.confirm('Vervang je nog niet bewaarde originele winkelinvoer? Bewaar eerst de ingevulde CSV.')) return
    setSnapshot({ fingerprint: currentFingerprint, needs: [...needs], stores: [...stores] })
    setRows({}); setMoments({}); setStatus(''); setSearch('')
    onDraftChange?.()
  }
  function filledFiles(): File[] {
    const actual: File[] = []
    for (const store of snapshot.stores) {
      const selected = snapshot.needs.map((need, index) =>
        ({ need, row: row(store, index), index: index + 2 }))
        .filter(entry => entry.row.state !== 'unseen')
      if (!selected.length) continue
      const observedAt = moments[store]?.trim() ?? ''
      if (!observedAt) throw Error(store + ': noteer eerst het werkelijke ISO-bronmoment met expliciete tijdzone.')
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
        // Only source files enter the existing parser. This does not accept
        // proposals, prices, permissions or product links automatically.
        onReview(files)
        setStatus('Eigen opname doorgestuurd naar de bestaande lokale bronvoorcontrole. Controleer daar de originele producten en bevestig eventuele overname zelf.')
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
    {snapshot.stores.map(store => <fieldset key={store}>
      <legend>{store} · originele persoonlijke bronopname</legend>
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
      {snapshot.needs.map((need, index) => ({ need, index })).filter(({ need }) =>
        !search.trim() || [need.label, need.id].join(' ').normalize('NFKD')
          .toLocaleLowerCase('nl-NL').includes(search.trim().normalize('NFKD')
            .toLocaleLowerCase('nl-NL'))).map(({ need, index }) => {
        const value = row(store, index)
        const physical = readablePlannerDemandAmount(need.amount)
        return <details key={store + ':' + index + ':' + need.id}>
          <summary>Regel {index + 2}: {need.label} · Planner-vraag{' '}
            {physical === 'hoeveelheid nog controleren'
              ? physical : physical + ' ' + need.unit}
            {' '}· {value.state === 'unseen' ? 'niet waargenomen' :
              value.state === 'available' ? 'bronproduct beschikbaar' : 'bronproduct niet beschikbaar'}
          </summary>
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
            </>}
            <small>Dit is een handmatig bronconcept, geen bevestigde productmatch.
              Dezelfde SKU meerdere keren invoeren binnen één winkel is ongeldig.</small>
          </div>}
        </details>
      })}
    </fieldset>)}
    <div className="offline-price-workbench__actions">
      <button type="button" className="ghost-button"
        onClick={() => act('download')}>Bewaar ingevulde originele winkelopname op dit toestel</button>
      <button type="button" className="ghost-button"
        onClick={() => { void act('share') }}>Deel originele winkelopname-CSV via mijn telefoon</button>
      <button type="button" disabled={!onReview || changed}
        onClick={() => { void act('review') }}>Controleer mijn echte winkelopname in Supa</button>
      <button type="button" className="ghost-button"
        onClick={reset}>Start nieuw leeg opnameformulier</button>
    </div>
    {status && <p role="status" aria-live="polite">{status}</p>}
    <small>De originele invoer blijft uitsluitend in deze open browsersessie tot je
      zelf een bestand bewaart. De bestaande import controleert daarna elke
      SKU, prijs, tijd, pakinhoud en gebruikerstoestemming afzonderlijk.</small>
  </details>
}
