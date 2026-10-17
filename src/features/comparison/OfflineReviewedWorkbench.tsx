import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregatePlanIngredients, buildOneStoreBasket, type RecipeWithIngredients, type BasketTraceLine, type OneStoreBasket } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
import { LocalTwoStorePriceEditor } from './LocalTwoStorePriceEditor.tsx'
import './offlineReviewedWorkbench.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores = ['PLUS', 'DekaMarkt'] as const
type Matched = Extract<BasketTraceLine, { status: 'matched' }>

function pricePerUnit(line: Matched): string | null {
  const { unit, amount, count } = line.pack
  const physical = amount * count
  const basis = unit === 'g' || unit === 'ml' ? physical / 1000 : physical
  if (!Number.isFinite(basis) || basis <= 0) return null
  const cents = line.pricePerPackCents / basis
  if (!Number.isFinite(cents) || cents < 0) return null
  return euros.format(cents / 100) + ' per ' +
    (unit === 'g' || unit === 'kg' ? 'kg' : unit === 'ml' || unit === 'l' ? 'liter' : 'stuk')
}
function captureDate(ms: number) { return dateTime.format(new Date(ms)) }
function shoppingChecklist(basket: OneStoreBasket): string {
  return [
    `Supa · boodschappen voor ${basket.store.name} · privé ingevoerde prijzen, niet geverifieerd`,
    ...basket.lines.map(line => line.status === 'matched'
      ? `☐ ${line.ingredientLabel}: ${line.packs} × ${line.productName} (${euros.format(line.lineTotalCents / 100)})`
      : `☐ ${line.ingredientLabel}: handmatig kiezen, hoeveelheid ${line.requirement.amount ?? '?'} ${line.requirement.unit}`),
    'Prijzen zijn alleen indicatief op basis van lokaal aangeleverde gegevens.',
  ].join('\n')
}

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}) {
  const ingredientNeeds = useMemo(() => {
    try {
      return aggregatePlanIngredients(plan, recipes, activeDays)
        .filter(need => need.id.trim() && need.label.trim() &&
          ['g', 'kg', 'ml', 'l', 'piece'].includes(need.unit))
    } catch { return [] }
  }, [plan, recipes, activeDays])

  /** A deliberately incomplete field sheet, never price/source evidence. */
  function downloadBlankObservationSheet() {
    if (!ingredientNeeds.length || ingredientNeeds.length > 1000) return
    const header = 'retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available'
    const rows = stores.flatMap(store =>
      ingredientNeeds.map((need, index) => {
        const slug = need.label.normalize('NFKD').toLowerCase()
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54)
        const id = `own-${store === 'PLUS' ? 'plus' : 'deka'}-${index + 1}-${slug || 'ingredient'}`
        // Deliberately blank physical observation, product name, pack and price.
        // The downstream importer refuses these rows until completed honestly.
        return [store, '', id, '', '', need.unit, '', '', 'false'].join(',')
      }),
    )
    const csv = [header, ...rows].join('\r\n') + '\r\n'
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'supa-weekmenu-lege-prijswaarnemingen.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    }
  }

  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const importVersion = useRef(0)
  // Prevent stale imports from appearing comparable after an open browser tab
  // crosses a 7-day boundary. Refresh only the UI clock, not source observations.
  const [clockMs, setClockMs] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setClockMs(Date.now())
    const interval = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  function importSnapshots(input: string) {
    try {
      const parsed = parseOfflinePriceSnapshots(input, Date.now())
      setClockMs(Date.now())
      setImported(parsed)
      setMessage('Twee privéopnames lokaal geladen; Supa heeft geen gegevens naar een server verstuurd.')
    } catch (error) {
      // Never retain/display a previous basket after an invalid new import.
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Ongeldige import.')
    }
  }
  async function loadFile(file?: File) {
    if (!file) return
    const version = ++importVersion.current
    // Never leave an older basket, price difference or claim on screen while
    // a second local import is being read, converted or rejected.
    setImported(null)
    setBusy(true)
    setMessage('Bestand wordt alleen in deze browser verwerkt.')
    try {
      if (file.size > 256000) throw new Error('Bestand is te groot (maximaal 256 kB).')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
      let json = content
      if (isCsv) {
        // Vite copies public assets unchanged. Resolve within the deployed base,
        // not the site root, so preview and subpath deployments both work.
        const moduleUrl = new URL('offline-two-store-csv.mjs',
          new URL(import.meta.env.BASE_URL, window.location.origin)).href
        const converter: { convertTwoStoreCsv: (input: string) => string } =
          await import(/* @vite-ignore */ moduleUrl)
        json = converter.convertTwoStoreCsv(content)
      }
      if (version !== importVersion.current) return
      setText(json)
      importSnapshots(json)
    } catch (error) {
      if (version !== importVersion.current) return
      setText('')
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Kon dit bestand niet lezen.')
    } finally {
      if (version === importVersion.current) setBusy(false)
    }
  }

  const basketPair = useMemo(() => {
    if (!imported) return null
    try {
      const plus = buildOneStoreBasket({
        store: { id: 'PLUS', name: 'PLUS' }, plan, recipes, activeDays,
        products: imported.captures.PLUS.products,
      })
      const deka = buildOneStoreBasket({
        store: { id: 'DekaMarkt', name: 'DekaMarkt' }, plan, recipes, activeDays,
        products: imported.captures.DekaMarkt.products,
      })
      return { plus, deka, comparison: compareFullBaskets({ baseline: plus, candidate: deka }) }
    } catch { return null }
  }, [imported, plan, recipes, activeDays])
  const currentEnough = useMemo(() => {
    if (!imported) return false
    const nowNs = BigInt(Math.trunc(clockMs)) * 1000000n
    const first = imported.captures.PLUS.observedNs
    const second = imported.captures.DekaMarkt.observedNs
    const oldest = first < second ? first : second
    const newest = first > second ? first : second
    return nowNs >= newest - 300000000000n && nowNs - oldest <= 604800000000000n
  }, [imported, clockMs])
  const canShowDifference = !!imported && currentEnough && imported.pairedWithin24h &&
    !!basketPair?.comparison.claimable

  return (
    <section className="offline-price-workbench" aria-label="Geïmporteerde winkelprijzen vergelijken">
      <div className="offline-price-workbench__intro">
        <span className="eyebrow">Jouw planner → brongegevens → winkelmandjes</span>
        <h2>Vergelijk twee winkels met eigen prijsdata</h2>
        <p>Vul producten en prijzen direct per winkel in, of laad eigen geobserveerde winkelprijzen uit JSON of CSV.
          Supa koppelt producten aan jouw huidige weekmenu, rondt verpakkingen naar boven af
          en berekent eenheidsprijzen en volledige mandtotalen. De import start geen scraper of netwerkverzoek.</p>
        <p className="disclaimer">Privé rekenhulp: een aangeleverd bestand bewijst geen toestemming, productidentiteit,
          actuele winkelprijs of besparing. Onbekende producten krijgen nooit een verzonnen prijs.
          PLUS en DekaMarkt zijn hier uitsluitend vergelijkingslabels.</p>
      </div>
      <LocalTwoStorePriceEditor
        plan={plan} recipes={recipes} activeDays={activeDays}
        onGenerated={(json) => {
          importVersion.current++
          setBusy(false)
          setText(json)
          importSnapshots(json)
        }}
        onEdit={() => {
          // A user editing the in-app wizard also invalidates a pending file read.
          importVersion.current++
          setBusy(false)
          setImported(null)
          setMessage('Wijzigingen nog niet doorgerekend. Bereken opnieuw om de mandjes te zien.')
        }}
      />
      <details className="offline-price-workbench__schema">
        <summary>Welk importbestand werkt?</summary>
        <p>UTF-8 JSON met <code>schema: "supa-offline-prices-v1"</code> en precies twee
          <code> captures</code>, elk met <code>retailer</code> (PLUS / DekaMarkt),
          <code>observedAt</code> (ISO-tijd met tijdzone) en een <code>products</code>-lijst.
          Elk product bevat <code>id</code>, <code>name</code>, <code>packAmount</code>,
          <code>packUnit</code> (g/kg/ml/l/piece), <code>priceCents</code> (geheel aantal centen of
          null), en <code>available</code> (true/false). Optioneel <code>packCount</code>.
          Gebruik uitsluitend gegevens die je mag bewaren en verwerken.
          Ontbrekende prijzen: zet <code>priceCents: null</code> en <code>available: false</code>.</p>
      </details>
      <div className="offline-price-workbench__input">
        <p>Heb je een spreadsheet met geobserveerde PLUS- en DekaMarkt-prijzen? Importeer hier rechtstreeks
          een CSV met de negen vereiste kolommen, of maak deze eerst in de{' '}
          <a href={`${import.meta.env.BASE_URL}offline-two-store-import.html`} target="_blank" rel="noopener noreferrer">
            lokale CSV-converter (opent in een nieuw tabblad)
          </a>.
          Er wordt niets naar een server verstuurd; ontbrekende prijzen blijven onbekend.</p>
        <div>
          <button type="button" className="ghost-button"
            disabled={ingredientNeeds.length === 0 || ingredientNeeds.length > 1000}
            onClick={downloadBlankObservationSheet}>
            Download leeg CSV-invulblad voor jouw weekmenu
          </button>
          <p className="disclaimer">Het invulblad bevat alleen de ingrediënten uit Planner, tweemaal (PLUS en DekaMarkt).
            De productnaam, werkelijke waarnemingstijd, verpakking en prijs zijn expres leeg:
            pas na je eigen rechtmatige observaties, met een echte tijd per winkel en correcte beschikbaarheid,
            kan dit blad worden geïmporteerd. De product-ID vermeldt welk ingrediënt je moet zoeken;
            die ID is geen geverifieerd winkelartikel.</p>
        </div>
        <label>Importeer JSON of CSV vanaf dit apparaat
          <input type="file" accept=".json,.csv,application/json,text/csv" disabled={busy}
            onChange={event => { void loadFile(event.currentTarget.files?.[0]) }} />
        </label>
        <label>Of plak de twee winkelopnames als JSON
          <textarea rows={5} value={text} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => {
              // A pending file read is no longer authoritative after manual edits.
              importVersion.current++
              setBusy(false)
              setText(event.target.value)
              setImported(null)
              setMessage('Invoer gewijzigd. Bereken opnieuw voordat mandjes en prijsverschillen zichtbaar zijn.')
            }} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => importSnapshots(text)}>
            Bereken mandjes
          </button>
          <button type="button" className="ghost-button" onClick={() => {
            importVersion.current++
            setBusy(false)
            setImported(null); setText(''); setMessage('Geïmporteerde prijsdata uit dit scherm gewist.')
          }}>Wis lokaal geladen data</button>
        </div>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      {imported && (
        <div className="offline-price-workbench__results">
          <h3>Winkelvergelijking voor jouw huidige weekmenu</h3>
          <div className="offline-price-workbench__dates">
            {stores.map(store => (
              <p key={store}><strong>{store}</strong> · waargenomen {captureDate(imported.captures[store].observedMs)}
                {' '}· {imported.captures[store].products.length} bronproducten</p>
            ))}
          </div>
          {!currentEnough && <p role="alert" className="attention-card">
            Oude prijsdata (ouder dan 7 dagen). Er wordt geen actueel prijsverschil getoond.
          </p>}
          {!imported.pairedWithin24h && <p role="alert" className="attention-card">
            Waarnemingen liggen meer dan 24 uur uiteen. Het prijsverschil is niet vergelijkbaar.
          </p>}
          {!basketPair ? <p role="alert">Deze planning kon niet veilig aan de import worden gekoppeld.</p> : (
            <>
              <div className="offline-price-workbench__totals">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
                    basket.unresolvedLineCount === 0
                  return (
                    <section key={store}>
                      <h4>{store}</h4>
                      <strong>{complete ? euros.format(basket.totalCents / 100) : 'Geen volledig totaal'}</strong>
                      {!complete && basket.matchedLineCount > 0 && (
                        <span>Bekende regels samen: {euros.format(basket.totalCents / 100)} (geen mandtotaal)</span>
                      )}
                      <span>{basket.matchedLineCount} gekoppeld, {basket.unresolvedLineCount} onbekend</span>
                    </section>
                  )
                })}
              </div>
              {(basketPair.plus.unresolvedLineCount > 0 || basketPair.deka.unresolvedLineCount > 0) && (
                <p className="offline-price-workbench__missing" role="status">
                  Deze vergelijking is nog niet volledig. Vul onbekende artikelen in beide winkels in.
                  Bekende deelbedragen zijn geen complete winkelmandprijs en worden niet als besparing vergeleken.
                </p>
              )}
              <p className="offline-price-workbench__difference" role="status">
                {canShowDifference && basketPair.comparison.deltaCents !== null
                  ? basketPair.comparison.deltaCents === 0
                    ? 'Deze twee ingevoerde volledige mandjes hebben hetzelfde rekenkundige totaal.'
                    : `${basketPair.comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'} is op basis van deze eigen invoer ${euros.format(Math.abs(basketPair.comparison.deltaCents) / 100)} goedkoper.`
                  : 'Nog geen vergelijkbaar prijsverschil: ontbrekende producten, verouderde gegevens of ongelijke waarnemingstijden.'}
                <small> Dit is nooit een gecontroleerde publieke besparingsclaim.</small>
              </p>
              {canShowDifference && basketPair.comparison.lineDeltas.length > 0 && (
                <section className="offline-price-workbench__drivers" aria-label="Prijsverschil per ingrediënt">
                  <h4>Wat veroorzaakt het verschil?</h4>
                  {[...basketPair.comparison.lineDeltas]
                    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
                    .slice(0, 5)
                    .map(line => (
                      <p key={line.id}><strong>{line.ingredientLabel}</strong> · PLUS {euros.format(line.baselineLineTotalCents / 100)}
                        {' '}· DekaMarkt {euros.format(line.candidateLineTotalCents / 100)}
                        {' '}· {line.deltaCents === 0 ? 'zelfde bedrag'
                          : `${euros.format(Math.abs(line.deltaCents) / 100)} verschil`}</p>
                    ))}
                </section>
              )}
              <div className="offline-price-workbench__stores">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  return (
                    <section key={store}>
                      <h4>{store} · mandregels</h4>
                      <details className="offline-price-workbench__checklist">
                        <summary>Kopieer boodschappenlijst voor {store}</summary>
                        <p>Selecteer en kopieer deze lijst; de tekst blijft op je apparaat.</p>
                        <textarea readOnly rows={Math.min(18, basket.lines.length + 4)}
                          aria-label={`Boodschappenlijst ${store}`}
                          value={shoppingChecklist(basket)} onFocus={event => event.currentTarget.select()} />
                      </details>
                      {basket.lines.map(line => (
                        <article key={line.id} className="offline-price-workbench__line">
                          <div>
                            <strong>{line.ingredientLabel}</strong>
                            <span>Benodigd: {line.requirement.amount ?? '?'} {line.requirement.unit}</span>
                            {line.status === 'matched' && <span>{line.productName} · {line.packs} × verpakking</span>}
                            {line.status === 'matched' && <span>Eenheidsprijs: {pricePerUnit(line) ?? 'onbekend'}</span>}
                            {line.status === 'unresolved' && <span>Niet gekoppeld · controleer bronproduct, beschikbaarheid of verpakking.</span>}
                          </div>
                          <strong>{line.status === 'matched' ? euros.format(line.lineTotalCents / 100) : '—'}</strong>
                        </article>
                      ))}
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
