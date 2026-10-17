import { useMemo, useState } from 'react'
import type { OneStoreBasket, BasketTraceLine } from '../../domain/basket.ts'
import './privateStoreTripChecklist.css'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

function basketConsistent(basket: OneStoreBasket): boolean {
  try {
    if (!basket || !basket.store || !basket.store.id?.trim() || !basket.store.name?.trim() ||
      !Number.isSafeInteger(basket.selectedMealCount) || basket.selectedMealCount < 0 ||
      !Number.isSafeInteger(basket.matchedLineCount) || basket.matchedLineCount < 0 ||
      !Number.isSafeInteger(basket.unresolvedLineCount) || basket.unresolvedLineCount < 0 ||
      !Number.isSafeInteger(basket.totalCents) || basket.totalCents < 0 ||
      !Array.isArray(basket.lines) || basket.lines.length > 1000 ||
      basket.lines.length !== basket.matchedLineCount + basket.unresolvedLineCount ||
      (basket.lines.length > 0 && basket.selectedMealCount === 0)) return false
    const ids = new Set<string>()
    let matched = 0
    let unresolved = 0
    let total = 0
    for (const line of basket.lines) {
      if (!line || typeof line.id !== 'string' || !line.id.trim() ||
        typeof line.ingredientLabel !== 'string' || !line.ingredientLabel.trim() ||
        ids.has(line.id) || !line.requirement) return false
      ids.add(line.id)
      if (line.status === 'unresolved') {
        unresolved++
        continue
      }
      if (line.status !== 'matched' || !line.productId?.trim() || !line.productName?.trim() ||
        !Number.isSafeInteger(line.packs) || line.packs < 1 ||
        !Number.isSafeInteger(line.pricePerPackCents) || line.pricePerPackCents < 0 ||
        !Number.isSafeInteger(line.lineTotalCents) || line.lineTotalCents < 0 ||
        line.lineTotalCents !== line.packs * line.pricePerPackCents) return false
      matched++
      total += line.lineTotalCents
      if (!Number.isSafeInteger(total)) return false
    }
    return matched === basket.matchedLineCount &&
      unresolved === basket.unresolvedLineCount && total === basket.totalCents
  } catch {
    return false
  }
}

function formatLine(line: BasketTraceLine, checked: boolean): string {
  const box = checked ? '☑ ' : '☐ '
  if (line.status === 'matched') {
    return box + line.ingredientLabel + ': ' + line.packs + ' × ' +
      line.productName + ' · ' + euro.format(line.lineTotalCents / 100)
  }
  return box + line.ingredientLabel + ': handmatig kiezen; nodig ' +
    (line.requirement.amount ?? '?') + ' ' + line.requirement.unit + ' · geen prijs'
}

function checklistText(basket: OneStoreBasket, done: ReadonlySet<string>, observedAt: string, fresh: boolean): string {
  const complete = basket.selectedMealCount > 0 && basket.lines.length > 0 &&
    basket.unresolvedLineCount === 0
  return [
    'SUPA · PRIVÉBOODSCHAPPENLIJST · ' + basket.store.name,
    'Geobserveerd: ' + observedAt + ' (eigen invoer, niet onafhankelijk geverifieerd)',
    fresh ? 'Prijsdatum recent genoeg voor particuliere vergelijking' : 'LET OP: verouderde prijswaarneming',
    complete ? 'Totaal eigen invoer: ' + euro.format(basket.totalCents / 100) :
      'Alleen bekende deelprijzen: ' + euro.format(basket.totalCents / 100) + ' (GEEN volledig totaal)',
    '',
    ...basket.lines.map(line => formatLine(line, done.has(line.id))),
    '',
    'Geen live winkelgarantie, officiële bronlicentie of geverifieerde besparing.',
  ].join('\n')
}

/** In-memory shop trip progress for ONE import, separate from saved demo list. */
export function PrivateStoreTripChecklist({
  basket, observedAt, fresh,
}: {
  basket: OneStoreBasket
  observedAt: string
  fresh: boolean
}) {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [message, setMessage] = useState('')
  const consistent = useMemo(() => basketConsistent(basket), [basket])
  const lines = consistent ? basket.lines : []
  const completed = lines.filter(line => done.has(line.id)).length
  const text = consistent ? checklistText(basket, done, observedAt, fresh) : ''

  if (!consistent) {
    return <div className="private-store-trip" role="alert">
      Onbetrouwbare winkelmandgegevens: de afvinklijst is niet beschikbaar.
    </div>
  }

  function toggle(id: string) {
    setDone(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setMessage('')
  }

  function download() {
    const uri = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    try {
      const link = document.createElement('a')
      link.href = uri
      link.download = 'supa-boodschappen-' + basket.store.id.toLowerCase().replace(/[^a-z0-9-]/g, '') + '.txt'
      document.body.append(link)
      link.click()
      link.remove()
      setMessage('Je privéboodschappenlijst is gedownload.')
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(uri), 1000)
    }
  }

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard')
      await navigator.clipboard.writeText(text)
      setMessage('Boodschappenlijst gekopieerd.')
    } catch {
      setMessage('Automatisch kopiëren is niet beschikbaar; gebruik de selecteerbare lijsttekst.')
    }
  }

  return <section className="private-store-trip" aria-label={'Afvinklijst voor ' + basket.store.name}>
    <div className="private-store-trip__head">
      <div>
        <h5>Boodschappen afvinken · {basket.store.name}</h5>
        <p>{fresh ? 'Privéprijzen volgens de opgegeven datum nog recent.' :
          'Deze prijzen zijn verouderd: controleer ze zelf.'}</p>
      </div>
      <strong role="status">{completed} van {lines.length} afgevinkt</strong>
    </div>
    <progress value={completed} max={Math.max(lines.length, 1)}
      aria-label={'Boodschappenvoortgang ' + basket.store.name} />
    {basket.unresolvedLineCount > 0 && <p className="private-store-trip__warning">
      {basket.unresolvedLineCount} ontbrekende productkeuzes. Het bekende deelbedrag is geen volledig mandtotaal.
    </p>}
    {lines.length === 0 && <p>Plan eerst maaltijden om artikelen te zien.</p>}
    <ul className="private-store-trip__items">
      {lines.map(line => <li key={line.id}>
        <label>
          <input type="checkbox" checked={done.has(line.id)} onChange={() => toggle(line.id)} />
          <span className={done.has(line.id) ? 'private-store-trip__checked' : ''}>
            <strong>{line.ingredientLabel}</strong>
            <small>{line.status === 'matched'
              ? line.packs + ' × ' + line.productName + ' · ' + euro.format(line.lineTotalCents / 100)
              : 'Zelf kiezen · ' + (line.requirement.amount ?? '?') + ' ' + line.requirement.unit +
                ' · prijs onbekend'}</small>
          </span>
        </label>
      </li>)}
    </ul>
    <div className="private-store-trip__actions">
      <button type="button" className="ghost-button" disabled={!lines.length} onClick={download}>
        Download lijst
      </button>
      <button type="button" className="ghost-button" disabled={!lines.length}
        onClick={() => { void copy() }}>Kopieer lijst</button>
      <button type="button" className="ghost-button" disabled={!completed}
        onClick={() => { setDone(new Set()); setMessage('Alle vinkjes in dit scherm gewist.') }}>
        Wis vinkjes
      </button>
    </div>
    <p aria-live="polite" role="status">{message}</p>
    <details>
      <summary>Toon selecteerbare lijsttekst</summary>
      <textarea readOnly rows={Math.min(16, Math.max(5, lines.length + 5))}
        value={text} aria-label={'Kopieerbare lijst ' + basket.store.name}
        onFocus={event => event.currentTarget.select()} />
    </details>
    <p className="private-store-trip__notice">Vinkjes worden alleen tijdelijk in dit scherm bijgehouden.
      Deze privéopname wordt niet vermengd met de algemene of demo-boodschappenlijst en
      er wordt niets naar retailers of een server verstuurd.</p>
  </section>
}
