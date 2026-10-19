import { lazy, Suspense, useMemo, useState } from 'react'
import type { BasketTraceLine } from '../../domain/basket.ts'
import { freshReviewedBaskets, type OwnStore, type PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { createMixedStoreShoppingPlan } from '../comparison/mixedStoreShoppingPlan.ts'
import './privateSourceShoppingList.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const date = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
const stores: OwnStore[] = ['PLUS', 'DekaMarkt']
const MixedStoreShoppingCard = lazy(async () => {
  const module = await import('../comparison/MixedStoreShoppingCard.tsx')
  return { default: module.MixedStoreShoppingCard }
})

/** Private owner-reviewed baskets only. No fixture rows, browser storage or APIs. */
export function PrivateSourceShoppingList({ reviewed, budget, preferred, onChooseStore, onOpenComparison }: {
  reviewed: PrivateReviewedBaskets
  budget: number
  preferred: OwnStore
  onChooseStore: (store: OwnStore) => void
  onOpenComparison: () => void
}) {
  const available = stores.filter(store => !!reviewed.stores[store])
  const store = available.includes(preferred) ? preferred : available[0]
  const capture = reviewed.stores[store]!
  const basket = capture.basket
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [remainingOnly, setRemainingOnly] = useState(false)
  const [message, setMessage] = useState('')
  const [showMixedRoute, setShowMixedRoute] = useState(false)
  // Physical quantity, original source instant, SKU and money bind each tick.
  const identity = useMemo(() => JSON.stringify([
    reviewed.planKey, store, capture.observedAt, basket.store.id,
    basket.lines.map(line => line.status === 'matched'
      ? [line.id, line.productId, line.requirement.amount, line.requirement.unit,
        line.productName, line.packs, line.pack.amount, line.pack.unit, line.pack.count,
        line.pricePerPackCents, line.lineTotalCents]
      : [line.id, 'unknown']),
  ]), [reviewed.planKey, store, capture.observedAt, basket])
  const tick = (line: BasketTraceLine) => JSON.stringify([identity, line.id])
  const doneCount = basket.lines.filter(line => checked[tick(line)]).length
  const visibleLines = remainingOnly ? basket.lines.filter(line => !checked[tick(line)]) : basket.lines
  const readable = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const label = (line: BasketTraceLine) => line.status === 'matched'
    ? readable(line.ingredientLabel) + ': ' + line.packs + ' × ' + readable(line.productName) +
      ' (SKU ' + readable(line.productId) + ') · ' +
      line.pack.count + ' × ' + line.pack.amount + ' ' + line.pack.unit + ' per pak · ' +
      euros.format(line.pricePerPackCents / 100) + ' per pak · ' +
      (privateUnitPrice(line) ?? 'eenheidsprijs onbekend') + ' · ' +
      euros.format(line.lineTotalCents / 100) + ' totaal'
    : line.ingredientLabel + ': product onbekend'
  const textList = [
    'Supa · ' + store + ' · privé gecontroleerd mandje',
    'Eigen bronopname: ' + readable(capture.observedAt),
    ...basket.lines.map(line => (checked[tick(line)] ? '☑ ' : '☐ ') + label(line)),
    'Privébron. Geen actuele kassagarantie of publieke besparingsclaim.',
  ].join('\n')
  const plus = reviewed.stores.PLUS
  const deka = reviewed.stores.DekaMarkt
  const paired = !!plus && !!deka &&
    Math.abs(plus.capturedMs - deka.capturedMs) <= 86400000
  const comparison = paired
    ? compareFullBaskets({ baseline: plus!.basket, candidate: deka!.basket }) : null
  const pairReady = paired && comparison?.claimable === true && !!plus && !!deka
  const mixed = pairReady ? createMixedStoreShoppingPlan(plus!.basket, deka!.basket) : null
  const single = pairReady ? createMixedStoreShoppingPlan(plus!.basket, deka!.basket, 'single') : null
  // Reusing the same UI after a different verified SKU/physical pack must
  // not retain earlier route preferences or checked-item progress.
  const pairIdentity = pairReady ? JSON.stringify([reviewed.planKey,
    ...stores.map(name => [name, reviewed.stores[name]!.observedAt,
      reviewed.stores[name]!.basket.lines]),
  ]) : null
  const pairCurrentNow = () => {
    const current = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
    if (!current?.stores.PLUS || !current.stores.DekaMarkt ||
        current.stores.PLUS !== plus || current.stores.DekaMarkt !== deka ||
        Math.abs(current.stores.PLUS.capturedMs - current.stores.DekaMarkt.capturedMs) > 86400000) return false
    return compareFullBaskets({ baseline: plus!.basket, candidate: deka!.basket }).claimable
  }
  const budgetCents = Number.isFinite(budget) ? Math.round(budget * 100) : null

  function currentCaptureAvailable() {
    const valid = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())?.stores[store]
    return !!valid && valid.observedAt === capture.observedAt && valid.basket === basket
  }
  function downloadList() {
    if (!currentCaptureAvailable()) {
      setMessage('De bronopname is inmiddels verlopen. Werk je eigen winkelprijzen opnieuw bij in Vergelijk.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([textList], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-eigen-boodschappen.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setMessage('Je actuele lokale boodschappenlijst is gedownload; niets verzonden.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch { setMessage('Download niet beschikbaar. Kopieer de lijst hieronder.') }
  }
  return (
    <section className="screen private-source-shopping" aria-label="Eigen gecontroleerde boodschappenlijst">
      <header>
        <span className="eyebrow">Eigen gecontroleerde winkelbron</span>
        <h2>Boodschappenlijst</h2>
        <p>Je bevestigde winkelartikelen uit de Vergelijk-tab. Geen Supa-voorbeeldprijzen,
          automatische winkelupdates of opslag van privéprijzen.</p>
      </header>
      <label className="private-source-shopping__choose">Winkel met gecontroleerd volledig mandje
        <select value={store} onChange={event => {
          onChooseStore(event.currentTarget.value as OwnStore); setMessage('')
        }}>
          {available.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className="private-source-shopping__summary">
        <p><strong>{store}</strong> · bron van {date.format(new Date(capture.capturedMs))}</p>
        <strong>{euros.format(basket.totalCents / 100)}</strong>
        <p>{basket.lines.length} ingrediënten · {doneCount} afgevinkt</p>
        {budgetCents !== null && budgetCents >= 0 &&
          <p>{basket.totalCents <= budgetCents
            ? euros.format((budgetCents - basket.totalCents) / 100) + ' onder je Planner-weekbudget'
            : euros.format((basket.totalCents - budgetCents) / 100) + ' boven je Planner-weekbudget'}</p>}
        <small>Alleen hele verpakkingen in eigen bronopname. Geen actuele kassagarantie.</small>
      </div>
      {comparison?.claimable && comparison.deltaCents !== null &&
        <p role="status" className="private-source-shopping__comparison">
          {comparison.deltaCents === 0 ? 'Beide eigen winkelmandjes hebben hetzelfde totaal.'
            : (comparison.deltaCents > 0 ? 'PLUS' : 'DekaMarkt') + ' is ' +
              euros.format(Math.abs(comparison.deltaCents) / 100) +
              ' goedkoper volgens jouw twee lokale, binnen 24 uur waargenomen bronnen.'}
          <small>Geen onafhankelijk gecontroleerde besparing.</small>
        </p>}
      {mixed && single && plus && deka && <section className="private-source-shopping__mixed" aria-label="Combineer beide eigen winkelmandjes">
        <h3>Goedkoopste artikelen combineren</h3>
        <p>Verdeel alleen jouw gecontroleerde hele verpakkingen over beide winkels.
          De productkosten bedragen {euros.format(mixed.totalCents / 100)}.
          {mixed.lines.some(line => line.store === 'PLUS') && mixed.lines.some(line => line.store === 'DekaMarkt')
            ? ' Extra bezoekkosten en reistijd moet je zelf invullen; zonder die kosten is het netto voordeel onbekend.'
            : ' Voor de goedkoopste combinatie is maar één winkel nodig.'}</p>
        <button type="button" aria-expanded={showMixedRoute} aria-controls="supa-mixed-shopping-list"
          onClick={() => setShowMixedRoute(value => !value)}>
          {showMixedRoute ? 'Verberg gecombineerde route' : 'Open gecombineerde winkelroute'}
        </button>
        {showMixedRoute && <div id="supa-mixed-shopping-list">
          <Suspense fallback={<p role="status">Jouw gecontroleerde winkelroute openen…</p>}>
            <MixedStoreShoppingCard key={pairIdentity ?? ''} mixed={mixed} single={single}
              plus={plus.basket} deka={deka.basket}
              captured={{ PLUS: plus.observedAt, DekaMarkt: deka.observedAt }}
              eligibleNow={pairCurrentNow} />
          </Suspense>
        </div>}
      </section>}
      <div className="private-source-shopping__actions">
        <label><input type="checkbox" checked={remainingOnly}
          onChange={event => setRemainingOnly(event.target.checked)} /> Alleen nog te kopen</label>
        <button type="button" onClick={downloadList}>Download eigen boodschappenlijst (TXT)</button>
        <button type="button" onClick={onOpenComparison}>Herzie prijzen en productmatching</button>
      </div>
      <p role="status" aria-live="polite">{message}</p>
      <div className="private-source-shopping__items">
        {visibleLines.map(line => (
          <label className="private-source-shopping__item" key={line.id}>
            <input type="checkbox" checked={!!checked[tick(line)]}
              onChange={event => { const value = event.currentTarget.checked
                setChecked(before => ({ ...before, [tick(line)]: value })) }} />
            <span><strong>{line.ingredientLabel}</strong>
              <small>{line.status === 'matched'
                ? line.packs + ' × ' + line.productName + ' · SKU ' + line.productId +
                  ' · ' + line.pack.amount + ' ' + line.pack.unit + ' × ' + line.pack.count + ' per verpakking' +
                  ' · ' + euros.format(line.pricePerPackCents / 100) + ' per pak' +
                  ' · ' + (privateUnitPrice(line) ?? 'eenheidsprijs onbekend')
                : 'Dit product is niet betrouwbaar gekoppeld.'}</small>
            </span>
            <strong>{line.status === 'matched' ? euros.format(line.lineTotalCents / 100) : 'Onbekend'}</strong>
          </label>
        ))}
        {visibleLines.length === 0 && <p>Alles voor {store} is afgevinkt.</p>}
      </div>
      <details>
        <summary>Kopieer de eigen boodschappenlijst</summary>
        <textarea readOnly value={textList} rows={Math.min(16, basket.lines.length + 4)}
          onFocus={event => {
            if (currentCaptureAvailable()) event.currentTarget.select()
            else { event.currentTarget.blur(); setMessage('Deze winkelopname is verlopen. Werk de brongegevens bij.') }
          }}
          aria-label="Kopieerbare eigen boodschappenlijst" />
      </details>
      <p className="disclaimer">Vinkjes zijn tijdelijk in deze browsersessie en worden niet opgeslagen
        of doorgestuurd. Een nieuwe bron, andere producten, weekvraag of prijs vervangt de
        fysieke lijst en maakt oudere afvinkingen ongeldig.</p>
    </section>
  )
}
