import { useState } from 'react'
import type { aggregatePlanIngredients } from '../../domain/basket.ts'
import type { UnpricedShoppingNote } from '../shopping-list/ManualShoppingNotes.tsx'
import { serializePrivateNotes } from '../shopping-list/manualShoppingNotesBackup.ts'
import { preparePlannerPersonalNotes, type PersonalNoteDraft, type PersonalNoteDestination } from './plannerPersonalNotes.ts'

type Demand = ReturnType<typeof aggregatePlanIngredients>[number]
type Pending = { fingerprint: string; planKey: string; original: string;
  incoming: PersonalNoteDraft[]; skipped: number }

/** Explicit, all-or-nothing conversion from the CURRENT physical Planner
 * week to personal unpriced notes. No retailer evidence or price transfers.
 */
export function PlannerPersonalNoteTransfer({ items, checked, openOnly, planKey,
  notes, onImport, onOpenPriceImport }: {
  items: readonly Demand[]
  checked: Readonly<Record<string, boolean>>
  openOnly: boolean
  planKey: string
  notes: readonly UnpricedShoppingNote[]
  onImport: (incoming: readonly PersonalNoteDraft[], expected: string) => string
  onOpenPriceImport?: () => void
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [transferred, setTransferred] = useState(false)
  const [destination, setDestination] = useState<PersonalNoteDestination>('Algemeen')
  const fingerprint = JSON.stringify([planKey, checked, openOnly, destination])
  function prepare() {
    setTransferred(false)
    setShowAll(false)
    try {
      const proposal = preparePlannerPersonalNotes(items, checked, openOnly, notes, destination)
      if (!proposal.incoming.length) {
        setPending(null)
        setMessage('Deze ingrediënten staan al in je eigen lijst; bestaande vinkjes blijven behouden.')
        return
      }
      setPending({ fingerprint, planKey, original: proposal.before,
        incoming: proposal.incoming, skipped: proposal.skipped })
      setMessage('Controleer de regels hieronder. Er is nog niets toegevoegd.')
    } catch (cause) {
      setPending(null)
      setMessage(cause instanceof Error ? cause.message : 'Kan je ingrediënten niet overnemen.')
    }
  }
  function confirm() {
    if (!pending) return
    try {
      if (pending.incoming.length > 15 && !showAll) {
        throw Error('Bekijk eerst alle winkelregels voordat je ze toevoegt.')
      }
      if (pending.fingerprint !== fingerprint || pending.planKey !== planKey ||
          serializePrivateNotes([...notes]) !== pending.original) {
        throw Error('De Planner-week, afvinkingen of persoonlijke lijst is gewijzigd. Bekijk de overdracht opnieuw.')
      }
      const result = onImport(pending.incoming, pending.original)
      setPending(null)
      setTransferred(true)
      setMessage(result)
    } catch (cause) {
      setPending(null)
      setTransferred(false)
      setMessage(cause instanceof Error ? cause.message : 'Overdracht geweigerd.')
    }
  }
  const storeCounts = pending?.incoming.reduce<Record<string, number>>((counts, note) => {
    counts[note.store] = (counts[note.store] ?? 0) + 1
    return counts
  }, {}) ?? {}
  const current = pending?.fingerprint === fingerprint &&
    pending?.planKey === planKey &&
    (() => { try { return serializePrivateNotes([...notes]) === pending.original } catch { return false } })()
  return <div className="unpriced-planner-checklist__personal-transfer">
    <label>Mijn eigen ongeprijsde winkellijst
      <select value={destination} onChange={event => {
        setDestination(event.currentTarget.value as PersonalNoteDestination)
        setTransferred(false)
        setPending(null)
        setMessage('Winkelkeuze gewijzigd; maak een nieuwe voorinzage.')
      }}>
        <option value="Algemeen">Algemeen · winkel nog zelf kiezen</option>
        <option value="PLUS">PLUS · zelf gekozen, niet gematcht</option>
        <option value="DekaMarkt">DekaMarkt · zelf gekozen, niet gematcht</option>
        <option value="Beide winkels">PLUS en DekaMarkt · twee aparte ongeprijsde controlelijsten</option>
      </select>
    </label>
    <button type="button" className="ghost-button" onClick={prepare}>
      {openOnly ? 'Neem open Planner-ingrediënten over in mijn eigen lijst' :
        'Neem mijn hele Planner-week over in mijn eigen lijst'}
    </button>
    <p className="disclaimer">De winkel is uitsluitend jouw persoonlijke keuze,
      geen automatische artikelmatch. Zonder winkelprijzen, SKU’s of bronclaims;
      je originele Planner-planning en bestaande vinkjes blijven behouden.
      Beide winkels betekent twee parallelle controlelijsten, niet twee aankopen.</p>
    {message && <p role="status" className="unpriced-planner-checklist__note">{message}</p>}
    {transferred && onOpenPriceImport && <div className="unpriced-planner-checklist__next-step">
      <p className="disclaimer">De eigen lijsten zijn nog ongeprijsd. Voor een werkelijke
        vergelijking moeten beide winkels onafhankelijk ingevulde, toegestane
        bronproducten, originele SKU's, verpakkingen, prijzen en tijden bevatten.</p>
      <button type="button" className="ghost-button" onClick={onOpenPriceImport}>
        Open Vergelijk om mijn originele PLUS/Deka-winkelprijzen te controleren
      </button>
    </div>}
    {pending && current && <section role="group"
      aria-label="Controleer Planner-ingrediënten voor de persoonlijke lijst"
      className="attention-card">
      <strong>{pending.incoming.length} nieuwe ongeprijsde ingrediënten</strong>
      <p>{pending.skipped} bestaande artikelen overgeslagen; alleen eigen notities
        krijgen nieuwe regels. Bevestig zelf, zonder productmatch of prijs.</p>
      <p role="status">Controleer per winkel: {Object.entries(storeCounts).map(([store, count]) =>
        `${store}: ${count} ${count === 1 ? 'regel' : 'regels'}`).join(' · ')}.</p>
      <ul>{pending.incoming.slice(0, showAll ? undefined : 15).map(item =>
        <li key={JSON.stringify([item.store, item.label])}>{item.done ? '☑' : '☐'} [{item.store}] {item.label}</li>)}</ul>
      {pending.incoming.length > 15 && !showAll && <button type="button" onClick={() => setShowAll(true)}>
        Bekijk alle {pending.incoming.length} regels vóór bevestiging
      </button>}
      <button type="button" disabled={pending.incoming.length > 15 && !showAll} onClick={confirm}>
        Bevestig {pending.incoming.length} ongeprijsde regels voor mijn eigen lijst
      </button>
      <button type="button" onClick={() => { setPending(null); setMessage('Overdracht geannuleerd.') }}>
        Annuleer</button>
    </section>}
    {pending && !current && <p role="alert">Deze voorinzage is verouderd.
      Maak een nieuwe voordat je iets toevoegt.</p>}
  </div>
}
