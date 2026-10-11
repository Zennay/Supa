import { useEffect, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'
import { shoppingListDemandIdentity } from './shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from './shoppingListRowsV2.ts'
import { openShoppingProgressStorageV2 } from './shoppingListStorageControllerV2.ts'

type Props = Readonly<{
  basket: OneStoreBasket
  /** Explicit, one-time owner choice: never infer consent to v1 migration. */
  allowLegacyUpgrade?: boolean
}>

function browserStorage() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Additive v2 view for the original ShoppingListView owner to review/adopt.
 * Not routed from App.tsx yet: the existing UI owner remains unchanged.
 *
 * Opening reads only; writes happen after an explicit click or in the effect
 * that commits an already-observed physical basket transition/opt-in upgrade.
 */
export function ShoppingListViewV2({ basket, allowLegacyUpgrade = false }: Props) {
  const [controller] = useState(() =>
    openShoppingProgressStorageV2(basket, browserStorage(), { allowLegacyUpgrade }),
  )
  const [session, setSession] = useState(() => controller.snapshot())
  const [saveFailed, setSaveFailed] = useState(false)
  const [recheckFailed, setRecheckFailed] = useState(false)
  // Set after mount to keep SSR markup stable when browser storage differs.
  const [unknownStoredRecord, setUnknownStoredRecord] = useState(false)
  const [unavailableStorage, setUnavailableStorage] = useState(false)
  const [unavailableReadRetryFailed, setUnavailableReadRetryFailed] = useState(false)

  // Re-evaluate even for an in-place mutation of a reused basket reference.
  const liveIdentity = shoppingListDemandIdentity(basket)
  const rows = shoppingListRowsV2(basket, session)
  const completedCount = rows.filter((row) => row.checked).length
  const unresolvedCount = rows.filter((row) => row.unresolved).length

  useEffect(() => {
    const previous = controller.snapshot()
    const next = controller.rebase(basket)
    setSession(next)
    setUnknownStoredRecord(controller.storageFormatStatus() === 'unknown-record')
    setUnavailableStorage(controller.storageFormatStatus() === 'unavailable')

    // Do not write when the view first renders or on price-only prop refresh.
    // Changing the *physical* basket invalidates old checks in durable storage.
    // An explicitly authorized legacy upgrade is committed only after mount.
    if (
      next.demandIdentity !== null &&
      (previous.demandIdentity !== next.demandIdentity ||
        previous.upgradedFromLegacy)
    ) {
      setSaveFailed(!controller.persist())
    } else if (previous.demandIdentity !== next.demandIdentity) {
      setSaveFailed(false)
    }
  }, [basket, liveIdentity, controller])

  function toggle(lineId: string) {
    // Rebase against the latest prop before handling a click, even if React
    // has not run the basket-change effect yet.
    controller.rebase(basket)
    const next = controller.toggle(lineId)
    setSession(next)
    setSaveFailed(next.serialized !== null && !controller.persist())
    setUnknownStoredRecord(controller.storageFormatStatus() === 'unknown-record')
    setUnavailableStorage(controller.storageFormatStatus() === 'unavailable')
  }

  function clearChecked() {
    // Never touch legacy v1 or persist a stale basket: clear is an explicit
    // user action against the latest physical shopping demand only.
    controller.rebase(basket)
    const next = controller.clear()
    setSession(next)
    setSaveFailed(next.serialized !== null && !controller.persist())
    setUnknownStoredRecord(controller.storageFormatStatus() === 'unknown-record')
    setUnavailableStorage(controller.storageFormatStatus() === 'unavailable')
  }

  function reloadSaved() {
    // Explicit recovery after a conflict: this drops unsaved local changes
    // only when the durable v2 read succeeds. Never write during recovery.
    controller.rebase(basket)
    const latest = controller.reloadSaved({ requireSameDemand: unknownStoredRecord || unavailableStorage })
    if (latest === null) {
      if (controller.storageFormatStatus() === 'unknown-record') {
        // Protected bytes remain read-only; don't suggest a stale-tab save.
        setRecheckFailed(true)
        setSaveFailed(false)
      } else if (controller.storageFormatStatus() === 'unavailable') {
        // An initially denied read is not evidence that another tab saved.
        setUnavailableReadRetryFailed(true)
        setSaveFailed(false)
      } else {
        setSaveFailed(true)
      }
      return
    }
    setRecheckFailed(false)
    setUnavailableReadRetryFailed(false)
    setSession(latest)
    setSaveFailed(false)
    setUnknownStoredRecord(controller.storageFormatStatus() === 'unknown-record')
    setUnavailableStorage(controller.storageFormatStatus() === 'unavailable')
  }

  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">In de winkel</span>
          <h2>Boodschappenlijst</h2>
        </div>
      </div>

      {unresolvedCount > 0 && (
        <div className="attention-card">
          <strong>{unresolvedCount} productkeuze vraagt controle</strong>
          <span>SUPA vult een onzekere match niet automatisch in.</span>
        </div>
      )}

      {unknownStoredRecord && (
        <div className="attention-card" role="status" aria-live="polite" data-storage-state="unknown-record">
          <strong>Opgeslagen boodschappenlijst beschermd</strong>
          <span>De opgeslagen versie is onbekend of ongeldig. Je kunt tijdelijk afvinken,
            maar nieuwe vinkjes worden niet bewaard. SUPA overschrijft de bestaande gegevens niet.</span>
          {recheckFailed && (
            <span>De opgeslagen versie is nog niet leesbaar. Bestaande gegevens zijn behouden.</span>
          )}
          <button type="button" className="ghost-button" onClick={reloadSaved}>
            Opgeslagen versie opnieuw controleren
          </button>
          <small>Dit leest opnieuw zonder iets te bewaren. Niet-opgeslagen vinkjes verdwijnen als het laden lukt.</small>
        </div>
      )}

      {unavailableStorage && (
        <div className="attention-card" role="status" aria-live="polite" data-storage-state="unavailable">
          <strong>Opgeslagen voortgang niet beschikbaar</strong>
          <span>Opslaan werkt hier niet. Vinkjes blijven alleen tijdelijk zichtbaar
            en kunnen verdwijnen als je de pagina sluit of herlaadt.</span>
          {controller.canRetryStorageRead() && (
            <>
              {unavailableReadRetryFailed && (
                <span>Opgeslagen voortgang is nog niet leesbaar. Je tijdelijke vinkjes blijven staan.</span>
              )}
              <button type="button" className="ghost-button" onClick={reloadSaved}>
                Opgeslagen voortgang opnieuw controleren
              </button>
              <small>Dit leest opnieuw zonder iets te bewaren. Niet-opgeslagen vinkjes verdwijnen alleen als laden lukt.</small>
            </>
          )}
        </div>
      )}

      {saveFailed && (
        <div className="attention-card" role="status">
          <strong>Voortgang niet opgeslagen</strong>
          <span>De wijziging is niet bewaard. Na herladen kunnen oude vinkjes terugkomen of nieuwe vinkjes verdwijnen.</span>
          <p>Een ander tabblad kan de lijst hebben aangepast. Je kunt de nieuwste opgeslagen lijst opnieuw laden.</p>
          <button type="button" className="ghost-button" onClick={reloadSaved}>
            Opgeslagen lijst laden
          </button>
          <small>Niet-opgeslagen vinkjes verdwijnen als het laden lukt.</small>
        </div>
      )}

      {rows.length > 0 && (
        <div className="section-heading">
          <p className="shopping-progress" role="status" aria-live="polite">
            {completedCount} van {rows.length} afgevinkt
          </p>
          {completedCount > 0 && (
            <button className="ghost-button" type="button" onClick={clearChecked}>
              Vinkjes wissen
            </button>
          )}
        </div>
      )}

      <div className="list-card">
        {rows.length === 0 && <p>Geen boodschappen voor deze planning.</p>}
        {rows.map((row) => (
          <button
            type="button"
            className={[
              'shopping-row',
              row.checked ? 'checked' : '',
              row.unresolved ? 'unresolved-shopping' : '',
            ].filter(Boolean).join(' ')}
            key={row.id}
            aria-pressed={row.checked}
            onClick={() => toggle(row.id)}
          >
            <span className="check" aria-hidden="true">{row.checked ? '✓' : ''}</span>
            <span>
              <strong>{row.label}</strong>
              <small>{row.quantity}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
