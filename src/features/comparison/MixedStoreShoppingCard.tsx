import { useState } from 'react'
import type { MixedStoreShoppingPlan, MixedStore } from './mixedStoreShoppingPlan.ts'
import { formatMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores: MixedStore[] = ['PLUS', 'DekaMarkt']

/** Renders only a reviewed, timely, same-demand comparison. Never loads
 * another retailer or turns a missing observed price into a cheaper option.
 * Download/copy still requires the parent source gate at click time.
 */
export function MixedStoreShoppingCard({
  mixed, single, captured, eligibleNow,
}: {
  mixed: MixedStoreShoppingPlan
  single: MixedStoreShoppingPlan
  captured: Record<MixedStore, string>
  eligibleNow: () => boolean
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [showText, setShowText] = useState(false)
  const [message, setMessage] = useState('')
  const [extraVisitCost, setExtraVisitCost] = useState('')
  const [mode, setMode] = useState<'auto' | 'mixed' | 'single'>('auto')

  const mixedUsesBoth = stores.every(store => mixed.lines.some(line => line.store === store))
  const rawCost = extraVisitCost.trim()
  const costShapeOk = rawCost === '' || /^\d{1,4}(?:[,.]\d{1,2})?$/.test(rawCost)
  const cents = rawCost && costShapeOk
    ? Math.round(Number(rawCost.replace(',', '.')) * 100) : null
  const extraCostCents = mixedUsesBoth && cents !== null &&
    Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000 ? cents : null
  const costInvalid = mixedUsesBoth && rawCost !== '' && (extraCostCents === null || !costShapeOk)
  const suggestedSingle = extraCostCents !== null && extraCostCents >= mixed.additionalDifferenceCents
  const chooseSingle = mode === 'single' || (mode === 'auto' && suggestedSingle)
  const plan = chooseSingle ? single : mixed
  const visitsBoth = stores.every(store => plan.lines.some(line => line.store === store))
  const appliedCostCents = visitsBoth ? extraCostCents : null
  const netAdvantage = extraCostCents === null ? null :
    mixed.additionalDifferenceCents - extraCostCents
  const key = (id: string) => JSON.stringify([captured.PLUS, captured.DekaMarkt, id])
  const done = (id: string) => !!checked[key(id)]
  const progress = Object.fromEntries(plan.lines.map(line => [line.key, done(line.key)]))
  const doneCount = plan.lines.filter(line => progress[line.key]).length
  const printable = formatMixedStoreShoppingPlan(plan, captured, progress, appliedCostCents)
  const block = costInvalid && !chooseSingle

  function download() {
    if (block) {
      setMessage('Corrigeer eerst je extra bezoekkosten, of kies alleen de goedkoopste complete winkel.')
      return
    }
    if (!eligibleNow()) {
      setShowText(false)
      setMessage('Deze originele bronopnames zijn verlopen of de productcontrole is gewijzigd. Controleer de echte bron opnieuw.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([printable], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-winkelroute-prive.txt'
        document.body.appendChild(link)
        try { link.click() } finally { link.remove() }
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setMessage('De gekozen route met jouw persoonlijke bronartikelen is lokaal opgeslagen. Geen onafhankelijke retailerprijzen.')
    } catch {
      setMessage('Download mislukt. Je kunt de route ook lokaal selecteren en kopiëren.')
    }
  }

  return <section className="offline-price-workbench__full-breakdown"
    aria-label="Boodschappenroute met persoonlijke PLUS- en DekaMarkt-prijzen">
    <h4>Mijn boodschappenroute: goedkoopste artikelen of één winkel</h4>
    <p>Dezelfde fysieke Planner-vraag en uitsluitend jouw bevestigde producten,
      pakprijzen en hele verpakkingen. Bij dezelfde regelprijs kiest Supa PLUS.
      Er worden geen ontbrekende bronprijzen aangevuld.</p>
    <div className="offline-price-workbench__totals">
      <div><strong>PLUS volledig</strong><p>{money.format(mixed.plusWholeCents / 100)}</p></div>
      <div><strong>DekaMarkt volledig</strong><p>{money.format(mixed.dekaWholeCents / 100)}</p></div>
      <div><strong>Mijn gekozen route</strong><p>{money.format(plan.totalCents / 100)}</p></div>
    </div>
    <p role="status">Een route met de goedkoopste artikelen kan vóór extra bezoekkosten
      maximaal <strong>{money.format(mixed.additionalDifferenceCents / 100)}</strong>
      {' '}lager uitkomen dan het goedkoopste complete mandje bij één winkel.
      Dat is geen gegarandeerde besparing of live winkelprijs.</p>
    <div className="offline-price-workbench__actions">
      <label>Kies je winkelroute
        <select value={mode} onChange={event => {
          setMode(event.currentTarget.value as 'auto' | 'mixed' | 'single')
          setShowText(false); setMessage('')
        }}>
          <option value="auto">Automatisch, rekening houdend met opgegeven extra kosten</option>
          <option value="mixed">Goedkoopste artikelen, eventueel twee winkels</option>
          <option value="single">Alleen de goedkoopste complete winkel</option>
        </select>
      </label>
      <p><strong>Geselecteerd:</strong> {visitsBoth
        ? 'PLUS én DekaMarkt'
        : plan.lines[0]?.store ?? 'Geen winkel'} ·
        {' '}{money.format(plan.totalCents / 100)} aan winkelproducten.</p>
      {mode === 'auto' && chooseSingle && extraCostCents !== null && <p role="status">
        Met jouw extra kosten is een complete mand bij één winkel minstens zo voordelig.
        Je boodschappenlijst is automatisch op één winkel gezet.</p>}
    </div>
    {mixedUsesBoth && <div className="offline-price-workbench__actions">
      <label>Extra kosten van de tweede stop (€)
        <input type="text" inputMode="decimal" value={extraVisitCost} maxLength={9}
          placeholder="Bijv. 2,50" onChange={event => {
            setExtraVisitCost(event.currentTarget.value); setMessage('')
          }} />
      </label>
      <p>Dit zijn jouw zelf opgegeven extra omrij-/parkeerkosten ten opzichte
        van één winkel. Zonder ingevuld bedrag is het netto voordeel onbekend.
        De ruimte voor extra kosten is {money.format(mixed.additionalDifferenceCents / 100)}.</p>
      {costInvalid && <p role="alert">Voer een geldig bedrag in tussen € 0,00 en
        € 1.000,00, met hoogstens twee decimalen.</p>}
      {!costInvalid && netAdvantage !== null && <p role="status">
        Twee winkels zouden inclusief jouw extra kosten{' '}
        <strong>{money.format((mixed.totalCents + extraCostCents!) / 100)}</strong>
        {' '}kosten. {netAdvantage > 0
          ? 'Dat is ' + money.format(netAdvantage / 100) + ' minder dan één complete winkel.'
          : netAdvantage === 0
            ? 'Dat is gelijk aan één complete winkel.'
            : 'Een complete winkel is ' + money.format(-netAdvantage / 100) + ' goedkoper.'}
      </p>}
    </div>}
    {!visitsBoth && <p>Je gekozen lijst vergt maar één winkelbezoek.
      Extra kosten voor een tweede stop worden niet meegerekend.</p>}
    <p><strong>{doneCount} van {plan.lines.length}</strong> producten afgevinkt ·
      alleen in deze open pagina.</p>
    <div className="offline-price-workbench__actions">
      <label><input type="checkbox" checked={onlyOpen}
        onChange={event => setOnlyOpen(event.currentTarget.checked)} /> Alleen nog te kopen</label>
      <button type="button" className="ghost-button" onClick={() => setChecked({})}>Wis vinkjes</button>
      <button type="button" className="ghost-button" onClick={download}>Download gekozen route (TXT)</button>
      <button type="button" className="ghost-button" onClick={() => {
        if (block) { setMessage('Corrigeer eerst je extra kosten.'); return }
        if (!eligibleNow()) { setShowText(false); setMessage('Bronnen verlopen: opnieuw controleren.'); return }
        setShowText(value => !value)
      }}>{showText ? 'Verberg kopieerbare lijst' : 'Toon kopieerbare lijst'}</button>
    </div>
    <div className="offline-price-workbench__dates">
      {stores.map(store => {
        const all = plan.lines.filter(item => item.store === store)
        const visible = all.filter(item => !onlyOpen || !done(item.key))
        return <section key={store}>
          <h4>{store} · {money.format(plan.totals[store] / 100)}</h4>
          <p>{all.length} van {plan.lines.length} fysieke ingrediënten bij deze winkel.</p>
          {visible.length === 0
            ? <p>{all.length ? 'Alles bij deze winkel afgevinkt.' : 'Geen producten bij deze winkel nodig.'}</p>
            : <ul>{visible.map(item => <li key={item.key}><label>
              <input type="checkbox" checked={done(item.key)}
                onChange={event => {
                  const checkedNow = event.currentTarget.checked
                  setChecked(old => ({ ...old, [key(item.key)]: checkedNow }))
                }} />
              <strong>{item.ingredientLabel}</strong> · benodigd {item.amount} {item.unit}:
              {' '}{item.packs} × {item.productName} [{item.productId}]
              {' '}({item.packCount} × {item.packAmount} {item.packUnit}/pak)
              {' '}· {money.format(item.pricePerPackCents / 100)} per pak
              {' '}= {money.format(item.lineTotalCents / 100)}
            </label></li>)}</ul>}
        </section>
      })}
    </div>
    {showText && <label>Kopieer mijn private boodschappenroute
      <textarea readOnly rows={Math.min(18, plan.lines.length + 15)}
        spellCheck={false} value={printable} onFocus={event => {
          if (eligibleNow()) event.currentTarget.select()
          else { setShowText(false); setMessage('Deze bron is niet meer actueel.') }
        }} />
    </label>}
    <p role="status" aria-live="polite">{message}</p>
    <small>Alleen volledige en persoonlijk gecontroleerde winkelopnames van maximaal
      zeven dagen oud met bronmomenten binnen 24 uur. Wijziging van een product
      of Planner-vraag vereist nieuwe goedkeuring. Eventuele extra kosten worden
      uitsluitend uit jouw eigen invoer berekend.</small>
  </section>
}
