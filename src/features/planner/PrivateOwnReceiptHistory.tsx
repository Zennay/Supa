import { useEffect, useRef, useState } from 'react'
import { readPrivateReceipt } from './PrivateOwnReceiptViewer.tsx'
import { comparePrivateReceiptHistory, type HistoricalReceiptResult, type ReceiptStore } from './privateReceiptHistory.ts'

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

/** Local-only historical comparison embedded in Planner, never promoting a
 * derived report back to source admission, source dates or the live budget.
 */
export function PrivateOwnReceiptHistory() {
  const [files, setFiles] = useState<[File | null, File | null]>([null, null])
  const [result, setResult] = useState<HistoricalReceiptResult | null>(null)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const version = useRef(0)
  const earlierPicker = useRef<HTMLInputElement>(null)
  const laterPicker = useRef<HTMLInputElement>(null)
  useEffect(() => () => { version.current++ }, [])

  function selectFile(index: 0 | 1, file: File | null) {
    version.current++
    setFiles(previous => index === 0 ? [file, previous[1]] : [previous[0], file])
    setResult(null)
    setQuery('')
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
    setBusy(false)
    setStatus('Beide privérapporten en de afgeleide prijsverschillen uit dit scherm gewist.')
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
      if (compared.status === 'unavailable') {
        setStatus(compared.reason)
        return
      }
      setResult(compared)
      setStatus(compared.entirePairComparable ?
        'Twee historische privémandjes volledig vergelijkbaar; geen actuele winkelprijs.' :
        'Historische verschillen per identieke SKU beschikbaar. Onvergelijkbare mandtotalen blijven onbekend.')
    } catch {
      if (serial === version.current)
        setStatus('Een van de eigen rapporten is onvolledig of gewijzigd. Controleer de originele export. Er zijn geen prijzen ingelezen als winkelbron.')
    } finally {
      if (serial === version.current) setBusy(false)
    }
  }
  const ready = result?.status === 'ready' ? result : null
  const term = query.normalize('NFKC').trim().toLocaleLowerCase('nl')
  const visible = ready?.rows.filter(row => !term || [
    row.ingredient, row.old.PLUS.sourceProductId, row.old.PLUS.sourceProductName,
    row.old.DekaMarkt.sourceProductId, row.old.DekaMarkt.sourceProductName,
  ].some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(term))) ?? []

  return <details className="own-store-planner__archive own-store-planner__history">
    <summary>Vergelijk de prijzen uit twee eerdere eigen winkelrapporten</summary>
    <p>Open twee eerder opgeslagen Supa-weekrapporten. Dit vergelijkt uitsluitend jouw eigen
      historische, afgeleide documenten; er worden geen bestanden geüpload of actuele
      winkelprijzen, bronrechten of besparingen geclaimd.</p>
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
        onClick={() => void compare()}>Vergelijk eigen opnames</button>
      <button type="button" className="ghost-button" onClick={clear}>Wis beide opnames</button>
    </div>
    {status && <p role="status">{status}</p>}
    {ready && <div className="own-store-planner__archive-content">
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
      <label>Zoek ingrediënt of SKU in historische resultaten
        <input type="search" value={query} maxLength={120}
          onChange={event => setQuery(event.currentTarget.value)} />
      </label>
      <p>{visible.length} van {ready.rows.length} vergelijkbare ingrediënten getoond.
        Deze zoekfilter verandert de mandbedragen niet.</p>
      <div className="own-store-planner__scroll" role="region"
        aria-label="Vergelijking historisch prijsverschil per product" tabIndex={0}>
        <table><thead><tr><th>Ingrediënt</th><th>PLUS</th><th>DekaMarkt</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.ingredientId}>
            <th scope="row">{row.ingredient}</th>
            {STORES.map(store => <td key={store}>
              <div>{row.old[store].sourceProductName} · {row.old[store].sourceProductId}</div>
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
      <p className="own-store-planner__history-notice">Geen kassagarantie, liveprijs of onafhankelijk
        besparingsbewijs. Deze gegevens worden nooit teruggeschreven als winkelopnames.</p>
    </div>}
  </details>
}
