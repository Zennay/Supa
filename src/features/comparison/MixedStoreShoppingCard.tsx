import { useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import type { MixedStoreShoppingPlan, MixedStore } from './mixedStoreShoppingPlan.ts'
import { createMixedStoreShoppingPlan, formatMixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'
import { MixedTripBackupControls } from './MixedTripBackupControls.tsx'
import { MixedStoreUnitBreakdown } from './MixedStoreUnitBreakdown.tsx'

const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const stores: MixedStore[] = ['PLUS', 'DekaMarkt']

/** Renders only a reviewed, timely, same-demand comparison. Never loads
 * another retailer or turns a missing observed price into a cheaper option.
 * Download/copy still requires the parent source gate at click time.
 */
export function MixedStoreShoppingCard({
  mixed, single, plus, deka, captured, eligibleNow,
}: {
  mixed: MixedStoreShoppingPlan
  single: MixedStoreShoppingPlan
  plus: OneStoreBasket
  deka: OneStoreBasket
  captured: Record<MixedStore, string>
  eligibleNow: () => boolean
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [showText, setShowText] = useState(false)
  const [message, setMessage] = useState('')
  const [extraVisitCost, setExtraVisitCost] = useState('')
  const [mode, setMode] = useState<'auto' | 'mixed' | 'single'>('auto')
  const [preferred, setPreferred] = useState<Record<string, MixedStore>>({})
  const chosenMixed = useMemo(() => createMixedStoreShoppingPlan(plus, deka, 'mixed', preferred),
    [plus, deka, preferred])
  // Source comparisons are prevalidated. A malformed choice must not quietly
  // become an apparently reviewed custom basket.
  const selectedMixed = chosenMixed ?? mixed

  // An explicit preferred store can introduce a second visit even when the
  // cheapest-by-line route would only use one store. Cost entry must follow
  // this *actual* proposed route, never only the theoretical minimum.
  const mixedUsesBoth = stores.every(store => mixed.lines.some(line => line.store === store)) ||
    stores.every(store => selectedMixed.lines.some(line => line.store === store))
  const rawCost = extraVisitCost.trim()
  const costShapeOk = rawCost === '' || /^\d{1,4}(?:[,.]\d{1,2})?$/.test(rawCost)
  const cents = rawCost && costShapeOk
    ? Math.round(Number(rawCost.replace(',', '.')) * 100) : null
  const extraCostCents = mixedUsesBoth && cents !== null &&
    Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000 ? cents : null
  const costInvalid = mixedUsesBoth && rawCost !== '' && (extraCostCents === null || !costShapeOk)
  const suggestedSingle = selectedMixed.additionalDifferenceCents < 0 ||
    (extraCostCents !== null && extraCostCents >= selectedMixed.additionalDifferenceCents)
  const chooseSingle = mode === 'single' || (mode === 'auto' && suggestedSingle)
  const plan = chooseSingle ? single : selectedMixed
  const visitsBoth = stores.every(store => plan.lines.some(line => line.store === store))
  const appliedCostCents = visitsBoth ? extraCostCents : null
  const netAdvantage = extraCostCents === null ? null :
    selectedMixed.additionalDifferenceCents - extraCostCents
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

  if (!chosenMixed) return <p role="alert">
    De aangepaste winkelroute kon niet veilig uit dezelfde complete fysieke mand worden
    berekend. Kies opnieuw een winkel per ingrediënt; er wordt geen nieuw bedrag getoond.
  </p>

  return <section className="offline-price-workbench__full-breakdown mixed-store-route"
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
      {mode === 'auto' && chooseSingle && <p role="status">
        {selectedMixed.additionalDifferenceCents < 0
          ? 'Door je handmatige winkelvoorkeuren kost de samengestelde route al meer dan het goedkoopste hele mandje bij één winkel.'
          : 'Met jouw ingevoerde extra kosten is een compleet mandje bij één winkel minstens zo voordelig.'}
        {' '}Supa heeft daarom de boodschappenlijst op één winkel gezet. Kies expliciet de gemengde
        route als je toch beide winkels wilt bezoeken.</p>}
    </div>
    <details className="offline-price-workbench__full-breakdown mixed-store-route__preferences">
      <summary>Kies zelf een winkel per ingrediënt (optioneel)</summary>
      <p>De standaard is het goedkoopste hele-verpakkingenbedrag per ingrediënt.
        Je mag een andere winkel kiezen op basis van je eigen voorkeur;
        het bedrag blijft uitsluitend de door jou gecontroleerde bronprijs.</p>
      <button type="button" className="ghost-button" onClick={() => {
        setPreferred({}); setShowText(false)
      }}>Zet alle keuzes terug op goedkoopste artikelen</button>
      <div className="offline-price-workbench__dates mixed-store-route__choices">
        {mixed.lines.map(line => {
          const plusLine = plus.lines.find(item => item.id === line.id)
          const dekaLine = deka.lines.find(item => item.id === line.id)
          if (plusLine?.status !== 'matched' || dekaLine?.status !== 'matched') return null
          return <label key={line.id}>{line.ingredientLabel} · {line.amount} {line.unit}
            <select value={preferred[line.id] ?? ''} onChange={event => {
              const chosen = event.currentTarget.value as MixedStore | ''
              setPreferred(old => {
                const next = { ...old }
                if (chosen) next[line.id] = chosen
                else delete next[line.id]
                return next
              })
              setShowText(false)
              setMessage('Winkelvoorkeur aangepast. Supa herberekent de route uit de twee eerder gecontroleerde bronartikelen.')
            }}>
              <option value="">Kies automatisch het goedkoopste artikel</option>
              <option value="PLUS">PLUS · {money.format(plusLine.lineTotalCents / 100)} · {plusLine.productName}</option>
              <option value="DekaMarkt">DekaMarkt · {money.format(dekaLine.lineTotalCents / 100)} · {dekaLine.productName}</option>
            </select>
          </label>
        })}
      </div>
    </details>
    <MixedStoreUnitBreakdown plus={plus} deka={deka} route={plan} />
    {mixedUsesBoth && <div className="offline-price-workbench__actions">
      <label>Extra kosten van de tweede stop (€)
        <input type="text" inputMode="decimal" value={extraVisitCost} maxLength={9}
          placeholder="Bijv. 2,50" onChange={event => {
            setExtraVisitCost(event.currentTarget.value); setMessage('')
          }} />
      </label>
      <p>Dit zijn jouw zelf opgegeven extra omrij-/parkeerkosten ten opzichte
        van één winkel. Zonder ingevuld bedrag is het netto voordeel onbekend.
        Het maximale theoretische voordeel vóór jouw winkelvoorkeuren is
        {' '}{money.format(mixed.additionalDifferenceCents / 100)}.</p>
      {costInvalid && <p role="alert">Voer een geldig bedrag in tussen € 0,00 en
        € 1.000,00, met hoogstens twee decimalen.</p>}
      {!costInvalid && netAdvantage !== null && <p role="status">
        Twee winkels zouden inclusief jouw extra kosten{' '}
        <strong>{money.format((selectedMixed.totalCents + extraCostCents!) / 100)}</strong>
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
    <div className="offline-price-workbench__dates mixed-store-route__shops">
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
    <MixedTripBackupControls
      context={{ plus, deka, captured }}
      settings={{ mode, preferred, extraVisitCost }}
      plan={plan}
      checked={new Set(plan.lines.filter(line => done(line.key)).map(line => line.key))}
      eligibleNow={eligibleNow}
      onRestore={restored => {
        setMode(restored.mode)
        setPreferred(restored.preferred)
        setExtraVisitCost(restored.extraVisitCost)
        setChecked(Object.fromEntries(restored.checked.map(item => [key(item), true])))
        setShowText(false)
        setOnlyOpen(false)
        setMessage('Winkelvoorkeuren en afvinkingen teruggezet zonder prijsgoedkeuringen over te nemen.')
      }}
    />
    <p role="status" aria-live="polite">{message}</p>
    <small>Alleen volledige en persoonlijk gecontroleerde winkelopnames van maximaal
      zeven dagen oud met bronmomenten binnen 24 uur. Wijziging van een product
      of Planner-vraag vereist nieuwe goedkeuring. Eventuele extra kosten worden
      uitsluitend uit jouw eigen invoer berekend.</small>
  </section>
}
