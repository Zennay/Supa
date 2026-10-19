import { useEffect, useRef, useState } from 'react'
import { readPrivateReceipt } from './PrivateOwnReceiptViewer.tsx'
import { privateOwnComparisonReceipt } from './privateOwnComparisonReceipt.ts'
import type { PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { comparePrivateReceiptHistory, type HistoricalReceiptResult, type ReceiptStore } from './privateReceiptHistory.ts'
import { exportPrivateReceiptHistoryCsv } from './privateReceiptHistoryCsv.ts'

const MONEY = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const STORES: readonly ReceiptStore[] = ['PLUS', 'DekaMarkt']
const amount = (cents: number) => MONEY.format(cents / 100)
const movement = (cents: number | null) => cents === null ? 'onbekend' :
  cents === 0 ? 'ongewijzigd' : (cents > 0 ? '+' : '−') + amount(Math.abs(cents))

function privateHistoryText(result: Extract<HistoricalReceiptResult, { status: 'ready' }>): string {
  return [
    'Supa · historisch privérapport · geen actuele winkelprijs of onafhankelijk besparingsbewijs',
    'PLUS eerder: ' + result.older.plusObservedAt,
    'PLUS later: ' + result.later.plusObservedAt,
    'DekaMarkt eerder: ' + result.older.dekaObservedAt,
    'DekaMarkt later: ' + result.later.dekaObservedAt,
    result.entirePairComparable ? 'Twee volledige identieke winkelmandjes: ja' :
      'Twee volledige identieke winkelmandjes: nee · totaalverschil onbekend',
    ...STORES.map(store => {
      const scope = result.stores[store]
      return store + ': ' + scope.comparableLines + ' identieke productregels; ' +
        (scope.completeBasket ? 'hele identieke winkelmand: ' : 'alleen identieke SKU-regels: ') +
        (scope.changeCents === null ? 'onbekend' :
          amount(scope.earlierSubsetCents) + ' -> ' + amount(scope.laterSubsetCents) +
          ' (' + movement(scope.changeCents) + ')')
    }),
    '',
    'Ingrediënt | PLUS verandering | DekaMarkt verandering',
    ...result.rows.map(row => row.ingredient + ' | ' +
      movement(row.changeCents.PLUS) + ' | ' + movement(row.changeCents.DekaMarkt)),
    '',
    'Uitgesloten verschillen:',
    ...result.excluded.map(row => row.ingredient + ' | ' + row.reason),
    'De rapporten zijn uitsluitend eigen afgeleide documenten, geen originele bronwaarnemingen.',
  ].join('\n') + '\n'
}
function downloadText(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = 'supa-historische-eigen-prijzen.txt'
    document.body.append(a)
    try { a.click() } finally { a.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

function downloadCsv(result: Extract<HistoricalReceiptResult, { status: 'ready' }>) {
  const csv = exportPrivateReceiptHistoryCsv(result)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = 'supa-historische-eigen-prijzen-geen-brondata.csv'
    document.body.append(a)
    try { a.click() } finally { a.remove() }
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

/** Local-only historical comparison embedded in Planner, never promoting a
 * derived report back to source admission, source dates or the live budget.
 */
export function PrivateOwnReceiptHistory({ reviewed }: {
  reviewed: PrivateReviewedBaskets | null
}) {
  const [files, setFiles] = useState<[File | null, File | null]>([null, null])
  const [result, setResult] = useState<HistoricalReceiptResult | null>(null)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [storeFilter, setStoreFilter] = useState<'all' | ReceiptStore>('all')
  const [changedOnly, setChangedOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [comparisonMode, setComparisonMode] = useState<'files' | 'planner'>('files')
  const version = useRef(0)
  // Read the latest Planner source AFTER the asynchronous local file read.
  // A stale render closure must never turn an expired price into a new week.
  const latestReviewed = useRef(reviewed)
  latestReviewed.current = reviewed
  const earlierPicker = useRef<HTMLInputElement>(null)
  const laterPicker = useRef<HTMLInputElement>(null)
  useEffect(() => () => { version.current++ }, [])

  function selectFile(index: 0 | 1, file: File | null) {
    version.current++
    setFiles(previous => index === 0 ? [file, previous[1]] : [previous[0], file])
    setResult(null)
    setQuery('')
    setChangedOnly(false)
    setStoreFilter('all')
    setComparisonMode('files')
    setBusy(false)
    setStatus('Bestanden gewijzigd; vergelijk opnieuw. Eerdere bedragen zijn uit dit scherm gewist.')
  }
  function clear() {
    version.current++
    if (earlierPicker.current) earlierPicker.current.value = ''
    if (laterPicker.current) laterPicker.current.value = ''
    setFiles([null, null])
    setResult(null)
    setQuery('')
    setChangedOnly(false)
    setStoreFilter('all')
    setComparisonMode('files')
    setBusy(false)
    setStatus('Beide privérapporten en de afgeleide prijsverschillen uit dit scherm gewist.')
  }
  function displayCompared(compared: HistoricalReceiptResult) {
    if (compared.status === 'unavailable') {
      setStatus(compared.reason)
      return
    }
    setResult(compared)
    setStatus(compared.entirePairComparable ?
      'Twee historische privémandjes volledig vergelijkbaar; geen actuele winkelprijs.' :
      'Historische verschillen per identieke SKU beschikbaar. Onvergelijkbare mandtotalen blijven onbekend.')
  }

  async function compare() {
    const serial = ++version.current
    setResult(null)
    setStatus('')
    if (!files[0] || !files[1]) {
      setStatus('Kies een eerder én een later eigen JSON-rapport.')
      return
    }
    if ([files[0], files[1]].some(file => !file.size || file.size > 512_000)) {
      setStatus('Elk rapport moet gevuld zijn en maximaal 512 kB groot zijn.')
      return
    }
    setBusy(true)
    try {
      const sources = await Promise.all(files.map(file => file!.text()))
      if (serial !== version.current) return
      const old = readPrivateReceipt(sources[0])
      const latest = readPrivateReceipt(sources[1])
      if (!old || !latest) throw Error('Ongeldig rapport')
      const compared = comparePrivateReceiptHistory(old, latest)
      if (serial !== version.current) return
      setComparisonMode('files')
      displayCompared(compared)
    } catch {
      if (serial === version.current)
        setStatus('Een van de eigen rapporten is onvolledig of gewijzigd. Controleer de originele export. Er zijn geen prijzen ingelezen als winkelbron.')
    } finally {
      if (serial === version.current) setBusy(false)
    }
  }
  async function compareEarlierWithCurrent() {
    const serial = ++version.current
    setResult(null)
    setStatus('')
    const file = files[0]
    if (!file || file.size === 0 || file.size > 512_000) {
      setStatus('Kies eerst een geldig eerder eigen Supa-JSON-rapport (maximaal 512 kB).')
      return
    }
    setBusy(true)
    try {
      const oldRaw = await file.text()
      if (serial !== version.current) return
      const previous = readPrivateReceipt(oldRaw)
      if (!previous) {
        setStatus('Het eerdere bestand is geen volledig, geldig eigen Supa-prijsrapport.')
        return
      }
      // The live Planner handoff uses existing exact source matching,
      // whole-pack totals and age/permission-gated reviewed baskets.
      const currentRaw = privateOwnComparisonReceipt(latestReviewed.current, Date.now())
      const current = readPrivateReceipt(currentRaw)
      if (!current) throw Error('Ongeldig huidig bronpaar')
      const compared = comparePrivateReceiptHistory(previous, current)
      if (serial !== version.current) return
      setComparisonMode('planner')
      displayCompared(compared)
    } catch (error) {
      if (serial !== version.current) return
      setStatus(error instanceof Error &&
        error.message === 'Voor een privérapport zijn twee actuele, fysiek gecontroleerde winkelmandjes nodig.'
        ? 'Geen twee actuele en volledig gecontroleerde winkelmandjes in de Planner. Vul echte eigen PLUS- en DekaMarkt-bronnen in en bevestig alle matches eerst.'
        : 'Je eerdere rapport of de huidige gecontroleerde winkelbronnen kunnen niet veilig worden vergeleken. Niets is als nieuwe bronprijs ingelezen.')
    } finally {
      if (serial === version.current) setBusy(false)
    }
  }

  const ready = result?.status === 'ready' ? result : null
  const term = query.normalize('NFKC').trim().toLocaleLowerCase('nl')
  const shownStores = storeFilter === 'all' ? STORES : [storeFilter]
  const visible = ready?.rows.filter(row =>
    (!changedOnly || shownStores.some(store => row.changeCents[store] !== null &&
      row.changeCents[store] !== 0)) &&
    (!term || [
      row.ingredient, row.old.PLUS.sourceProductId, row.old.PLUS.sourceProductName,
      row.old.DekaMarkt.sourceProductId, row.old.DekaMarkt.sourceProductName,
    ].some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(term)))) ?? []

  return <details className="own-store-planner__archive own-store-planner__history">
    <summary>Vergelijk eigen historische prijzen met je huidige Planner-mandje</summary>
    <p>Open een ouder eigen Supa-weekrapport en vergelijk met je huidige, volledig
      gecontroleerde PLUS/Deka-wekelijkse bronnen. Je kunt ook twee eerdere
      rapporten vergelijken. Alles blijft lokaal; ontbrekende of oude winkelprijzen
      blijven onbekend en er worden geen bronrechten of besparingen geclaimd.</p>
    <div className="own-store-planner__history-pickers">
      <label>Eerder rapport (eigen JSON)
        <input type="file" accept=".json,application/json" ref={earlierPicker}
          onChange={event => selectFile(0, event.currentTarget.files?.[0] ?? null)} />
      </label>
      <label>Later rapport (eigen JSON)
        <input type="file" accept=".json,application/json" ref={laterPicker}
          onChange={event => selectFile(1, event.currentTarget.files?.[0] ?? null)} />
      </label>
    </div>
    <div className="own-store-planner__history-actions">
      <button type="button" className="ghost-button" disabled={busy}
        onClick={() => void compareEarlierWithCurrent()}>
        Vergelijk oud rapport met huidige gecontroleerde Planner-prijzen
      </button>
      <button type="button" className="ghost-button" disabled={busy}
        onClick={() => void compare()}>Vergelijk twee eerdere rapporten</button>
      <button type="button" className="ghost-button" onClick={clear}>Wis beide opnames</button>
    </div>
    {status && <p role="status">{status}</p>}
    {ready && <div className="own-store-planner__archive-content">
      <p className="own-store-planner__history-notice">{comparisonMode === 'planner'
        ? 'Het latere rapport is bij de knopdruk lokaal samengesteld uit je huidige, volledig gecontroleerde Planner-bronnen. Dit is geen nieuwe retailerobservatie.'
        : 'Beide rapporten zijn eerder door jou geëxporteerd. Geen nieuwe retailerobservatie.'}</p>
      <p><strong>Alleen historische vergelijking</strong> · bronmomenten PLUS:
        {' '}{ready.older.plusObservedAt} → {ready.later.plusObservedAt};
        {' '}DekaMarkt: {ready.older.dekaObservedAt} → {ready.later.dekaObservedAt}.</p>
      <p className="own-store-planner__history-notice">{ready.entirePairComparable ?
        'Dezelfde fysieke vraag, SKU’s en verpakkingen bij beide winkels.' :
        'De mandjes zijn veranderd. Alleen identieke fysieke producten worden per winkel vergeleken. Een onvolledig mandtotaal blijft onbekend.'}</p>
      <div className="own-store-planner__history-cards">
        {STORES.map(store => {
          const scope = ready.stores[store]
          return <section key={store} aria-label={'Historisch bij ' + store}>
            <strong>{store}</strong>
            <p>{scope.comparableLines} identieke productregels</p>
            {scope.changeCents === null ? <p>Prijsverandering onbekend</p> :
              <><p>{amount(scope.earlierSubsetCents)} → {amount(scope.laterSubsetCents)}</p>
                <strong>{movement(scope.changeCents)}</strong></>}
            <small>{scope.completeBasket ? 'Hele eigen mand vergelijkbaar' :
              'Alleen onveranderde SKU-regels; hele mand onbekend'}</small>
          </section>
        })}
      </div>
      <div className="own-store-planner__archive-filters">
        <label>Zoek ingrediënt of SKU
          <input type="search" value={query} maxLength={120}
            onChange={event => setQuery(event.currentTarget.value)} />
        </label>
        <label>Bekijk winkel
          <select value={storeFilter} onChange={event =>
            setStoreFilter(event.currentTarget.value as typeof storeFilter)}>
            <option value="all">Beide winkels</option>
            <option value="PLUS">PLUS</option>
            <option value="DekaMarkt">DekaMarkt</option>
          </select>
        </label>
        <label className="own-store-planner__history-check">
          <input type="checkbox" checked={changedOnly}
            onChange={event => setChangedOnly(event.currentTarget.checked)} />
          Alleen werkelijk gewijzigde prijzen
        </label>
      </div>
      <p role="status">{visible.length} van {ready.rows.length} vergelijkbare ingrediënten getoond.
        Zoeken en filteren veranderen de oorspronkelijke mandbedragen niet.</p>
      <div className="own-store-planner__scroll" role="region"
        aria-label="Vergelijking historisch prijsverschil per product" tabIndex={0}>
        <table><thead><tr><th>Ingrediënt</th>{shownStores.map(store =>
          <th key={store}>{store} · eerder → later</th>)}</tr></thead>
          <tbody>{visible.map(row => <tr key={row.ingredientId}>
            <th scope="row">{row.ingredient}</th>
            {shownStores.map(store => <td key={store}>
              <div>{row.old[store].sourceProductName} · {row.old[store].sourceProductId}</div>
              {row.changeCents[store] !== null &&
                <div>{amount(row.old[store].totalWholePackagesCents)} → {' '}
                  {amount(row.later[store].totalWholePackagesCents)}</div>}
              <strong>{movement(row.changeCents[store])}</strong>
              {row.changeCents[store] === null && <small>Andere SKU of verpakking</small>}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {!!ready.excluded.length && <details>
        <summary>{ready.excluded.length} niet-vergelijkbare ingrediënten</summary>
        <ul>{ready.excluded.map((row, index) =>
          <li key={index}>{row.ingredient}: {row.reason}</li>)}</ul>
      </details>}
      <button className="ghost-button" type="button" onClick={() =>
        downloadText(privateHistoryText(ready))}>Download historische privévergelijking (TXT)</button>
      <button className="ghost-button" type="button" onClick={() => {
        try { downloadCsv(ready) }
        catch { setStatus('Dit privéoverzicht is te groot voor CSV. Gebruik TXT.') }
      }}>Download privéprijsontwikkeling als spreadsheet-CSV</button>
      <p className="own-store-planner__history-notice">Geen kassagarantie, liveprijs of onafhankelijk
        besparingsbewijs. Deze gegevens worden nooit teruggeschreven als winkelopnames.</p>
    </div>}
  </details>
}
