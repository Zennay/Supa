import { useEffect, useState, type FormEvent } from 'react'
import { decodeSaved, extraGroceriesSavedEvent, restore, signalSavedExtras, storageKey, valid, type Item, type Unit } from './ownExtraGroceriesStorage.ts'

type Snapshot = { identity: string; items: Item[]; raw: string | null; locked: boolean }

/** The same saved, explicitly private week list used by Lijst and route exports.
 * These rows never acquire a retailer SKU, source price or financial review. */
export function PrivateRouteExtraGroceries({
  identity, onlyOpen, onCount,
}: { identity: string; onlyOpen: boolean; onCount?: (count: number) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ identity, ...restore(identity) }))
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<Unit>('piece')
  const active = snapshot.identity === identity ? snapshot : null
  const reload = () => {
    setSnapshot({ identity, ...restore(identity) })
  }
  useEffect(() => { onCount?.(active?.items.length ?? 0) },
    [active?.items.length, identity, onCount])
  useEffect(() => {
    const onSaved = (event: Event) => {
      if ((event as CustomEvent<string>).detail === identity) reload()
    }
    window.addEventListener(extraGroceriesSavedEvent, onSaved)
    return () => window.removeEventListener(extraGroceriesSavedEvent, onSaved)
  }, [identity])
  useEffect(() => {
    setSnapshot({ identity, ...restore(identity) })
    setMessage('')
    setName('')
    setQuantity('1')
  }, [identity])

  function saveExtras(updated: Item[], announcement: string): boolean {
    if (!active || active.locked) {
      setMessage('De privéboodschappenlijst is niet veilig leesbaar. Er is niets gewijzigd.')
      return false
    }
    try {
      const key = storageKey(identity)
      if (window.sessionStorage.getItem(key) !== active.raw) {
        reload()
        throw Error('De lijst is ondertussen elders in dit tabblad gewijzigd. De bewaarde lijst is opnieuw geladen; controleer je wijziging.')
      }
      const raw = JSON.stringify({ schema: 'supa-extra-v1', identity, items: updated })
      if (new TextEncoder().encode(raw).length > 100000)
        throw Error('Er passen niet meer persoonlijke boodschappen in dit weekmenu.')
      decodeSaved(raw, identity)
      window.sessionStorage.setItem(key, raw)
      setSnapshot({ identity, items: updated, raw, locked: false })
      signalSavedExtras(identity)
      setMessage(announcement + ' Winkel en prijs blijven onbekend.')
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kon de privélijst niet veilig bewaren.')
      return false
    }
  }
  function tick(item: Item, done: boolean) {
    if (!active || !active.items.some(current => current.id === item.id)) return
    saveExtras(active.items.map(current => current.id === item.id
      ? { ...current, done } : current), done ? 'Extra artikel afgevinkt.' : 'Extra artikel teruggezet.')
  }
  function add(event: FormEvent) {
    event.preventDefault()
    if (!active || active.locked) return
    if (active.items.length >= 100) {
      setMessage('Maximaal 100 extra artikelen per week. Verwijder eerst een regel.')
      return
    }
    if (!/^\d{1,6}(?:[.,]\d{1,3})?$/.test(quantity)) {
      setMessage('Gebruik een geldige hoeveelheid, bijvoorbeeld 2 stuks of 500 g.')
      return
    }
    const random = new Uint32Array(4)
    try { window.crypto.getRandomValues(random) } catch {
      setMessage('De browser kan geen veilige artikel-ID maken; er is niets toegevoegd.')
      return
    }
    const item: Item = {
      id: Array.from(random, part => part.toString(16).padStart(8, '0')).join('-'),
      name: name.trim(), quantity: Number(quantity.replace(',', '.')), unit, done: false,
    }
    if (!valid(item) || active.items.some(other => other.id === item.id)) {
      setMessage('Artikel of hoeveelheid ongeldig. Stuks moeten hele aantallen zijn.')
      return
    }
    if (saveExtras([...active.items, item], 'Ongeprijsd extra artikel aan deze week toegevoegd.')) {
      setName(''); setQuantity('1')
    }
  }
  function remove(item: Item) {
    if (!active || !active.items.some(current => current.id === item.id)) return
    if (!window.confirm('Verwijder dit ongeprijsde extra artikel uit de huidige weeklijst?')) return
    saveExtras(active.items.filter(current => current.id !== item.id),
      'Extra artikel uit deze weeklijst verwijderd.')
  }
  if (!active) return null
  const total = active.items.length
  const completed = active.items.filter(item => item.done).length
  const visible = onlyOpen ? active.items.filter(item => !item.done) : active.items
  return <section className="offline-price-workbench__full-breakdown mixed-store-route__extras"
    aria-label="Extra persoonlijke boodschappen zonder winkelprijzen">
    <h4>Mijn extra boodschappen · winkel en prijs onbekend</h4>
    <p>Eigen artikelen naast de gecontroleerde Planner-boodschappen. Je kunt ze direct
      toevoegen en afvinken. Ze zijn <strong>niet gekoppeld</strong> aan PLUS of DekaMarkt
      en tellen <strong>niet mee</strong> in de mand- of budgetbedragen.
      Het uiteindelijke totaal inclusief deze artikelen blijft onbekend.</p>
    <div className="offline-price-workbench__actions">
      <strong>{completed} van {total} extra artikelen afgevinkt</strong>
      <button type="button" className="ghost-button" onClick={reload}>Ververs mijn opgeslagen extra lijst</button>
    </div>
    {active.locked ? <p role="alert">De opgeslagen privélijst is niet leesbaar.
      Er worden geen artikelen overschreven; herstel je eigen back-up via Lijst.</p> : <>
      <form className="mixed-store-route__extras-form" onSubmit={add}>
        <label>Eigen artikel <input type="text" required value={name} maxLength={120}
          placeholder="Bijv. toiletpapier" onChange={event => setName(event.target.value)} /></label>
        <label>Hoeveelheid <input required type="text" inputMode="decimal" value={quantity}
          maxLength={12} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Eenheid <select value={unit} onChange={event => setUnit(event.target.value as Unit)}>
          <option value="piece">stuks</option><option value="g">g</option><option value="ml">ml</option>
        </select></label>
        <button type="submit" disabled={total >= 100}>Voeg ongeprijsd toe</button>
      </form>
      {total === 0
        ? <p>Nog geen eigen extra artikelen voor deze Planner-week.</p>
        : visible.length === 0
          ? <p>Alle extra artikelen zijn afgevinkt.</p>
          : <ul>{visible.map(item => <li key={item.id}>
              <label><input type="checkbox" checked={item.done}
                onChange={event => tick(item, event.currentTarget.checked)} />
                <span>{item.quantity} {item.unit === 'piece' ? 'stuks' : item.unit}
                  {' '}{item.name} · <strong>prijs onbekend</strong></span>
              </label>
              <button type="button" className="ghost-button"
                aria-label={'Verwijder ' + item.name} onClick={() => remove(item)}>Verwijder</button>
            </li>)}</ul>}
    </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
