import { useState } from 'react'
import type { MixedStoreShoppingPlan, MixedStore } from './mixedStoreShoppingPlan.ts'
import { formatMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores: MixedStore[] = ['PLUS', 'DekaMarkt']

/** UI displays only when both captured baskets were fully reviewed.
 * Reconfirm original source age and review at download/copy time.
 * The checkboxes are deliberately local to this open React session.
 */
export function MixedStoreShoppingCard({
  plan, captured, eligibleNow,
}: {
  plan: MixedStoreShoppingPlan
  captured: Record<MixedStore, string>
  eligibleNow: () => boolean
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [showText, setShowText] = useState(false)
  const [message, setMessage] = useState('')
  const id = (key: string) => JSON.stringify([captured.PLUS, captured.DekaMarkt, key])
  const isDone = (key: string) => !!checked[id(key)]
  const current: Record<string, boolean> = Object.fromEntries(
    plan.lines.map(line => [line.key, isDone(line.key)]),
  )
  const complete = plan.lines.filter(line => current[line.key]).length
  const list = formatMixedStoreShoppingPlan(plan, captured, current)

  function download() {
    if (!eligibleNow()) {
      setShowText(false)
      setMessage('Deze bronopnames zijn intussen verlopen of gewijzigd. Controleer de echte producten opnieuw voordat je een lijst bewaart.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([list], { type: 'text/plain;charset=utf-8' }))
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = 'supa-prive-goedkoopste-winkels-boodschappen.txt'
        document.body.appendChild(a)
        try { a.click() } finally { a.remove() }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setMessage('Je persoonlijke twee-winkelroute is als TXT opgeslagen. Prijzen zijn alleen je eigen bevestigde invoer, zonder winkel- of reiskosten.')
    } catch {
      setMessage('Downloaden niet gelukt. Open de kopieerbare privétekst voor een alternatief.')
    }
  }

  return <section className="offline-price-workbench__full-breakdown"
    aria-label="Goedkoopste gecombineerde boodschappenroute uit twee zelf gecontroleerde winkels">
    <h4>Mijn voordeligste route: kies per ingrediënt een winkel</h4>
    <p>Dit gebruikt exact dezelfde fysieke weekvraag en per winkel persoonlijk gecontroleerde
      productcode, verpakking en geobserveerde pakprijs. Bij een gelijke regelprijs kiezen we PLUS.
      Je hoeft geen tweede winkel te bezoeken als alle gekozen artikelen in één winkel vallen.</p>
    <div className="offline-price-workbench__totals">
      <div><strong>PLUS volledig</strong><p>{money.format(plan.plusWholeCents / 100)}</p></div>
      <div><strong>DekaMarkt volledig</strong><p>{money.format(plan.dekaWholeCents / 100)}</p></div>
      <div><strong>Gecombineerde route</strong><p>{money.format(plan.totalCents / 100)}</p></div>
    </div>
    <p role="status">Rekenkundig <strong>{money.format(plan.additionalDifferenceCents / 100)}</strong>
      {' '}lager dan het goedkoopste volledige mandje bij één winkel.
      Dit is geen gegarandeerde besparing: reistijd, vervoerskosten, tijdelijke winkelacties
      en eventuele andere voorwaarden zijn niet meegerekend.</p>
    <p><strong>{complete} van {plan.lines.length}</strong> artikelen afgevinkt ·
      vinkjes blijven alleen in deze open pagina.</p>
    <div className="offline-price-workbench__actions">
      <label><input type="checkbox" checked={onlyOpen}
        onChange={event => setOnlyOpen(event.currentTarget.checked)} />
        Alleen nog te kopen</label>
      <button className="ghost-button" type="button" onClick={() => setChecked({})}>Wis vinkjes</button>
      <button className="ghost-button" type="button" onClick={download}>Download route met vinkjes (TXT)</button>
      <button className="ghost-button" type="button" onClick={() => {
        if (!eligibleNow()) { setShowText(false); setMessage('Bronnen verlopen: voer een nieuwe broncontrole uit.'); return }
        setShowText(previous => !previous)
      }}>{showText ? 'Verberg kopieerbare lijst' : 'Toon kopieerbare lijst'}</button>
    </div>
    <div className="offline-price-workbench__dates">
      {stores.map(store => {
        const items = plan.lines.filter(item => item.store === store)
        const visible = items.filter(item => !onlyOpen || !isDone(item.key))
        return <section key={store}>
          <h4>{store}: {money.format(plan.totals[store] / 100)}</h4>
          <small>{items.length} van {plan.lines.length} fysieke ingrediënten bij deze winkel</small>
          {visible.length === 0
            ? <p>{items.length ? 'Deze boodschappen zijn afgevinkt.' : 'Geen artikelen nodig bij deze winkel.'}</p>
            : <ul>{visible.map(line => <li key={line.key}>
              <label>
                <input type="checkbox" checked={isDone(line.key)}
                  onChange={event => {
                    const value = event.currentTarget.checked
                    setChecked(previous => ({ ...previous, [id(line.key)]: value }))
                  }} />
                <strong>{line.ingredientLabel}</strong> · nodig {line.amount} {line.unit}:
                {' '}{line.packs} × {line.productName} ({line.productId}) ·
                {' '}{line.packCount} × {line.packAmount} {line.packUnit} per pak ·
                {' '}{money.format(line.pricePerPackCents / 100)} per verpakking
                {' '}= {money.format(line.lineTotalCents / 100)}
              </label>
            </li>)}</ul>}
        </section>
      })}
    </div>
    {showText && <label>Privéroute selecteren en kopiëren
      <textarea readOnly rows={Math.min(18, plan.lines.length + 15)}
        spellCheck={false} value={list} onFocus={event => {
          if (eligibleNow()) event.currentTarget.select()
          else { setShowText(false); setMessage('Deze vergelijking is niet meer actueel.') }
        }} />
    </label>}
    <p role="status" aria-live="polite">{message}</p>
    <small>Het overzicht wordt alleen aangeboden wanneer de originele opnames maximaal zeven
      dagen oud zijn, onderling binnen 24 uur liggen en iedere SKU persoonlijk is bevestigd.
      Een veranderde bron of fysieke Planner-vraag blokkeert een oude route.</small>
  </section>
}
