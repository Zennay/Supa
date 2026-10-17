import { useMemo, useState } from 'react'
import { buildOneStoreBasket, type RecipeWithIngredients, type BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { parseOfflinePriceSnapshots, type OfflinePriceSnapshots } from '../../domain/offlineReviewedImport.ts'
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

/** Independent opt-in local import. Never treats JSON as evidence of retailer licensing or physical verification. */
export function OfflineReviewedWorkbench({
  plan, recipes, activeDays,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}) {
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function importSnapshots(input: string) {
    try {
      const parsed = parseOfflinePriceSnapshots(input)
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
    setBusy(true)
    try {
      if (file.size > 256000) throw new Error('Bestand is te groot (maximaal 256 kB).')
      const content = await file.text()
      setText(content)
      importSnapshots(content)
    } catch (error) {
      setImported(null)
      setMessage(error instanceof Error ? error.message : 'Kon dit bestand niet lezen.')
    } finally { setBusy(false) }
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
  const canShowDifference = !!imported && imported.currentEnough && imported.pairedWithin24h &&
    !!basketPair?.comparison.claimable

  return (
    <section className="offline-price-workbench" aria-label="Geïmporteerde winkelprijzen vergelijken">
      <div className="offline-price-workbench__intro">
        <span className="eyebrow">Jouw planner → brongegevens → winkelmandjes</span>
        <h2>Vergelijk twee winkels met eigen prijsdata</h2>
        <p>Laad lokaal een eerder rechtmatig verkregen, zelf gecontroleerde JSON-export.
          Supa koppelt producten aan jouw huidige weekmenu, rondt verpakkingen naar boven af
          en berekent eenheidsprijzen en volledige mandtotalen. De import start geen scraper of netwerkverzoek.</p>
        <p className="disclaimer">Privé rekenhulp: een aangeleverd bestand bewijst geen toestemming, productidentiteit,
          actuele winkelprijs of besparing. Onbekende producten krijgen nooit een verzonnen prijs.
          PLUS en DekaMarkt zijn hier uitsluitend vergelijkingslabels.</p>
      </div>
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
        <label>Importeer JSON vanaf dit apparaat
          <input type="file" accept=".json,application/json" disabled={busy}
            onChange={event => { void loadFile(event.currentTarget.files?.[0]) }} />
        </label>
        <label>Of plak de twee winkelopnames als JSON
          <textarea rows={5} value={text} maxLength={256000} spellCheck={false}
            placeholder={'{"schema":"supa-offline-prices-v1","captures":[...]}'}
            onChange={event => setText(event.target.value)} />
        </label>
        <div className="offline-price-workbench__actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => importSnapshots(text)}>
            Bereken mandjes
          </button>
          <button type="button" className="ghost-button" onClick={() => {
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
          {!imported.currentEnough && <p role="alert" className="attention-card">
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
                      <span>{basket.matchedLineCount} gekoppeld, {basket.unresolvedLineCount} onbekend</span>
                    </section>
                  )
                })}
              </div>
              <p className="offline-price-workbench__difference" role="status">
                {canShowDifference && basketPair.comparison.deltaCents !== null
                  ? basketPair.comparison.deltaCents === 0
                    ? 'Deze twee ingevoerde volledige mandjes hebben hetzelfde rekenkundige totaal.'
                    : `${basketPair.comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt'} is op basis van deze eigen invoer ${euros.format(Math.abs(basketPair.comparison.deltaCents) / 100)} goedkoper.`
                  : 'Nog geen vergelijkbaar prijsverschil: ontbrekende producten, verouderde gegevens of ongelijke waarnemingstijden.'}
                <small> Dit is nooit een gecontroleerde publieke besparingsclaim.</small>
              </p>
              <div className="offline-price-workbench__stores">
                {stores.map(store => {
                  const basket = store === 'PLUS' ? basketPair.plus : basketPair.deka
                  return (
                    <section key={store}>
                      <h4>{store} · mandregels</h4>
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
