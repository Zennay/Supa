import { useEffect, useMemo, useRef, useState } from 'react'
import type { OneStoreBasket, BasketTraceLine } from '../../domain/basket.ts'
import { selectShoppingCopyText } from '../shopping-list/selectShoppingCopyText.ts'
import './privateStoreTripChecklist.css'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

function basketConsistent(basket: OneStoreBasket): boolean {
  try {
    if (!basket || !basket.store || !['PLUS', 'DekaMarkt'].includes(basket.store.id) ||
      basket.store.name !== basket.store.id ||
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
      line.productName +
      (line.reasons.includes('explicit local user selection; not an automatic or verified retailer match') ?
        ' (zelf gekoppeld)' : '') + ' · ' + euro.format(line.lineTotalCents / 100)
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

const PLUS_KEY = 'supa:private-trip:v1:plus'
const DEKA_KEY = 'supa:private-trip:v1:dekamarkt'
type SavedState = { enabled: boolean; protected: boolean; raw: string | null; done: string[] }

// Each operation uses a statically scoped key and only a known retailer.
function readTripValue(id: string): string | null {
  if (id === 'PLUS') return window.sessionStorage.getItem(PLUS_KEY)
  if (id === 'DekaMarkt') return window.sessionStorage.getItem(DEKA_KEY)
  throw Error('Unsupported store')
}
function writeTripValue(id: string, value: string) {
  if (id === 'PLUS') window.sessionStorage.setItem(PLUS_KEY, value)
  else if (id === 'DekaMarkt') window.sessionStorage.setItem(DEKA_KEY, value)
  else throw Error('Unsupported store')
}
function deleteTripValue(id: string) {
  if (id === 'PLUS') window.sessionStorage.removeItem(PLUS_KEY)
  else if (id === 'DekaMarkt') window.sessionStorage.removeItem(DEKA_KEY)
  else throw Error('Unsupported store')
}

/** Basket-specific identity; includes prices and selected source time, not only IDs. */
function progressIdentity(basket: OneStoreBasket, observedAt: string): string {
  return JSON.stringify([
    basket.store.id, observedAt, basket.selectedMealCount, basket.totalCents,
    basket.matchedLineCount, basket.unresolvedLineCount,
    basket.lines.map(line => line.status === 'matched'
      ? [line.id, line.ingredientLabel, line.requirement.amount, line.requirement.unit,
        line.productId, line.productName, line.pack.amount, line.pack.unit, line.pack.count,
        line.packs, line.pricePerPackCents, line.lineTotalCents]
      : [line.id, line.ingredientLabel, 'unknown', line.requirement.amount, line.requirement.unit]),
  ])
}

function readSavedTrip(basket: OneStoreBasket, observedAt: string): SavedState {
  const empty: SavedState = { enabled: false, protected: false, raw: null, done: [] }
  if (typeof window === 'undefined') return empty
  let raw: string | null = null
  try { raw = readTripValue(basket.store.id) }
  catch { return { ...empty, protected: true } }
  if (raw === null) return empty
  if (raw.length > 64000) return { ...empty, raw, protected: true }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('shape')
    const record = parsed as Record<string, unknown>
    if (record.schemaVersion !== 1 ||
        Object.keys(record).some(key => !['schemaVersion', 'basketIdentity', 'done'].includes(key)) ||
        record.basketIdentity !== progressIdentity(basket, observedAt) ||
        !Array.isArray(record.done) || record.done.length > basket.lines.length ||
        !record.done.every(value => typeof value === 'string') ||
        new Set(record.done).size !== record.done.length ||
        record.done.some(id => !basket.lines.some(line => line.id === id))) throw Error('shape')
    return { enabled: true, protected: false, raw, done: record.done as string[] }
  } catch {
    // A saved list for a different basket or unknown schema is kept intact.
    return { ...empty, raw, protected: true }
  }
}

/** In-memory checklist, with optional per-tab recovery for the SAME basket. */
export function PrivateStoreTripChecklist({
  basket, observedAt, fresh, memoryProgress, onMemoryChange,
}: {
  basket: OneStoreBasket
  observedAt: string
  fresh: boolean
  memoryProgress?: { identity: string; done: string[] }
  onMemoryChange?: (identity: string, done: string[]) => void
}) {
  const [initial] = useState(() => readSavedTrip(basket, observedAt))
  const [localDone, setLocalDone] = useState<ReadonlySet<string>>(() => new Set(initial.done))
  const identity = progressIdentity(basket, observedAt)
  const memoryDone = memoryProgress?.identity === identity ? memoryProgress.done : null
  const done = useMemo<ReadonlySet<string>>(
    () => memoryDone === null ? localDone : new Set(memoryDone),
    [memoryDone, localDone],
  )
  function updateDone(next: ReadonlySet<string>) {
    setLocalDone(next)
    onMemoryChange?.(identity, [...next])
  }
  const [saveEnabled, setSaveEnabled] = useState(initial.enabled)
  const [storageProtected, setStorageProtected] = useState(initial.protected)
  const [savedRaw, setSavedRaw] = useState(initial.raw)
  const [copyVisible, setCopyVisible] = useState(false)
  const copyField = useRef<HTMLTextAreaElement>(null)
  const [message, setMessage] = useState(initial.protected
    ? 'Een eerder concept voor een andere winkelmand of versie is beschermd tegen overschrijven.'
    : initial.enabled ? 'Vinkjes voor ditzelfde mandje hersteld uit de huidige browsertab.' : '')
  useEffect(() => {
    if (!saveEnabled || storageProtected || typeof window === 'undefined') return
    try {
      const current = readTripValue(basket.store.id)
      if (current !== savedRaw) {
        setStorageProtected(true)
        setMessage('Een ander of gewijzigd concept is beschermd tegen overschrijven.')
        return
      }
      const next = JSON.stringify({
        schemaVersion: 1,
        basketIdentity: progressIdentity(basket, observedAt),
        done: [...done],
      })
      if (new TextEncoder().encode(next).length > 64000) throw Error('oversized')
      if (next !== current) writeTripValue(basket.store.id, next)
      if (savedRaw !== next) setSavedRaw(next)
    } catch {
      setSaveEnabled(false)
      setMessage('Vinkjes kunnen niet worden bewaard in dit tabblad. Download je lijst.')
    }
  }, [saveEnabled, storageProtected, savedRaw, basket, observedAt, done])

  function changeOptIn(checked: boolean) {
    if (checked) {
      if (storageProtected) return
      setSaveEnabled(true)
      setMessage('Optioneel bewaren ingeschakeld; alleen in deze browsertab.')
      return
    }
    if (typeof window !== 'undefined') {
      try {
          const current = readTripValue(basket.store.id)
        if (current === savedRaw) deleteTripValue(basket.store.id)
        else setStorageProtected(true)
      } catch { setStorageProtected(true) }
    }
    setSaveEnabled(false)
    setSavedRaw(null)
    setMessage('Automatisch bewaren gestopt; eigen vinkjes blijven alleen in dit scherm.')
  }
  function releaseProtectedConcept() {
    // Only this explicit click may remove a previous or unknown session record.
    // Compare-and-delete protects a newer concept written by another tab.
    if (typeof window === 'undefined') return
    try {
      const current = readTripValue(basket.store.id)
      if (current !== savedRaw) {
        setMessage('Het andere concept is inmiddels gewijzigd; er is niets overschreven of verwijderd.')
        return
      }
      if (current !== null) deleteTripValue(basket.store.id)
      setSavedRaw(null)
      setStorageProtected(false)
      setSaveEnabled(false)
      setMessage('Het vorige privéconcept is gewist. Je kunt nu vinkjes voor dit mandje bewaren.')
    } catch {
      setMessage('Dit tabblad geeft geen toestemming om het oude concept te wijzigen. Er is niets verwijderd.')
    }
  }

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
    const next = new Set(done)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    updateDone(next)
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
    <label className="private-store-trip__save">
      <input type="checkbox" checked={saveEnabled} disabled={storageProtected}
        onChange={event => changeOptIn(event.target.checked)} />
      <span>Bewaar mijn vinkjes in dit browsertabblad (optioneel)</span>
    </label>
    {storageProtected && <div className="private-store-trip__warning" role="status">
      <p>Een eerder concept voor een andere opname of onbekende versie is beschermd.
        Je kunt deze lijst gewoon afvinken en downloaden.</p>
      <button type="button" className="ghost-button" onClick={releaseProtectedConcept}>
        Wis vorig privéconcept en gebruik dit mandje
      </button>
    </div>}
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
        aria-expanded={copyVisible} onClick={() => setCopyVisible(visible => !visible)}>
        {copyVisible ? 'Verberg kopieerbare tekst' : 'Toon kopieerbare tekst'}
      </button>
      <button type="button" className="ghost-button" disabled={!completed}
        onClick={() => { updateDone(new Set()); setMessage('Alle vinkjes in dit scherm gewist.') }}>
        Wis vinkjes
      </button>
    </div>
    <p aria-live="polite" role="status">{message}</p>
    {copyVisible && <div className="private-store-trip__copy">
      <label>Te kopiëren boodschappenlijst
        <textarea ref={copyField} readOnly rows={Math.min(16, Math.max(5, lines.length + 5))}
          value={text} aria-label={'Kopieerbare lijst ' + basket.store.name}
          onFocus={event => event.currentTarget.select()} />
      </label>
      <button type="button" className="ghost-button"
        onClick={() => {
          const selected = selectShoppingCopyText(copyField.current, text)
          setMessage(selected ? 'Tekst geselecteerd. Kies Kopieer op je apparaat.' :
            'Selecteer de tekst handmatig en kies Kopieer op je apparaat.')
        }}>Selecteer alle tekst</button>
    </div>}
    <p className="private-store-trip__notice">
      Zonder jouw toestemming blijven vinkjes alleen in het geheugen van dit browsertabblad. Met opt-in worden uitsluitend
      de vinkjes en een mandgebonden sleutel lokaal in de sessieopslag van dit tabblad bewaard;
      een andere bronopname of week krijgt nooit automatisch jouw oude vinkjes.
      Deze privéopname wordt niet vermengd met demo-/algemene lijsten en gaat niet naar de server.
    </p>
  </section>
}
