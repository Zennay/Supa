import { useEffect, useState } from 'react'
import { decodeSaved, restore, storageKey, type Item } from './ownExtraGroceriesStorage.ts'

type Snapshot = { identity: string; items: Item[]; raw: string | null; locked: boolean }

/**
 * The same explicitly saved private extras used by Lijst and the source-checked
 * route exports. Each tap persists its current physical tick, but cannot admit
 * a price, retailer SKU or product equivalence to the compared basket.
 */
export function PrivateRouteExtraGroceries({
  identity, onlyOpen,
}: { identity: string; onlyOpen: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ identity, ...restore(identity) }))
  const [message, setMessage] = useState('')
  const active = snapshot.identity === identity ? snapshot : null
  const reload = () => {
    setSnapshot({ identity, ...restore(identity) })
  }
  useEffect(() => {
    setSnapshot({ identity, ...restore(identity) })
    setMessage('')
  }, [identity])

  function tick(item: Item, done: boolean) {
    if (!active || active.locked) return
    try {
      const key = storageKey(identity)
      if (window.sessionStorage.getItem(key) !== active.raw) {
        reload()
        throw Error('De lijst is elders in dit tabblad gewijzigd. Gegevens opnieuw geladen; probeer opnieuw.')
      }
      const updated = active.items.map(current => current.id === item.id
        ? { ...current, done } : current)
      if (!updated.some(current => current.id === item.id)) return
      const raw = JSON.stringify({ schema: 'supa-extra-v1', identity, items: updated })
      if (new TextEncoder().encode(raw).length > 100000) throw Error('De privélijst is te groot.')
      decodeSaved(raw, identity)
      window.sessionStorage.setItem(key, raw)
      setSnapshot({ identity, items: updated, raw, locked: false })
      setMessage('Extra artikel ' + (done ? 'afgevinkt' : 'teruggezet') +
        '. Dit is geen betaling of geverifieerde winkelprijs.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kon de extra privélijst niet veilig bewaren.')
    }
  }
  if (!active) return null
  const total = active.items.length
  const completed = active.items.filter(item => item.done).length
  const visible = onlyOpen ? active.items.filter(item => !item.done) : active.items
  return <section className="offline-price-workbench__full-breakdown mixed-store-route__extras"
    aria-label="Extra persoonlijke boodschappen zonder winkelprijzen">
    <h4>Mijn extra boodschappen · winkel en prijs onbekend</h4>
    <p>Dit zijn alleen de artikelen die je zelf onder Lijst hebt bewaard.
      Je kunt ze hier afvinken. Ze zijn <strong>niet gekoppeld</strong> aan PLUS of DekaMarkt
      en tellen <strong>niet mee</strong> in de getoonde mand- of budgetbedragen.
      Het uiteindelijke totaal inclusief deze artikelen is onbekend.</p>
    <div className="offline-price-workbench__actions">
      <strong>{completed} van {total} extra artikelen afgevinkt</strong>
      <button type="button" className="ghost-button" onClick={reload}>Ververs mijn opgeslagen extra lijst</button>
    </div>
    {active.locked
      ? <p role="alert">De opgeslagen privélijst is niet leesbaar. Er worden geen
          artikelen verzonnen of overschreven. Herstel je eigen back-up via Lijst.</p>
      : total === 0
        ? <p>Geen apart opgeslagen extra boodschappen voor deze Planner-week.
            Voeg ze toe via het tabblad Lijst en kies daar Bewaar in deze tab.</p>
        : visible.length === 0
          ? <p>Alle extra artikelen zijn afgevinkt.</p>
          : <ul>{visible.map(item => <li key={item.id}>
              <label><input type="checkbox" checked={item.done}
                onChange={event => tick(item, event.currentTarget.checked)} />
                <span>{item.quantity} {item.unit === 'piece' ? 'stuks' : item.unit}
                  {' '}{item.name} · <strong>prijs onbekend</strong>
                </span>
              </label>
            </li>)}</ul>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
