import { euro as exactEuro } from '../../lib/money.ts'
import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  recentOwnCaptureInstant,
  type OwnStore, type PrivateCaptureProgress, type PrivateReviewedBaskets,
} from '../comparison/privateReviewedBasketBridge.ts'
import { confirmedPartialBasket } from '../planner/confirmedPartialBasket.ts'
import { privateProgressPricePairs } from '../products/privateProgressProductRows.ts'
import { privatePartialShoppingExport } from './privatePartialShoppingExport.ts'
import { privatePartialPhysicalShoppingTick } from './privatePhysicalShoppingTick.ts'
import './partialReviewedShoppingList.css'

const STORES: readonly OwnStore[] = ['PLUS', 'DekaMarkt']

/** Admit source prices only from reviewed partial lines. Physical ticks share
 * the exact source SKU/pack identity with a later complete basket, but never
 * grant product approval or act as a price or savings authority. */
export function PartialReviewedShoppingList({
  progress, complete, checked, setChecked, onOpenComparison, onOpenProducts, onReviewIngredient,
}: {
  progress: PrivateCaptureProgress | null
  complete: PrivateReviewedBaskets | null
  checked: Record<string, boolean>
  setChecked: Dispatch<SetStateAction<Record<string, boolean>>>
  onOpenComparison: () => void
  onOpenProducts: () => void
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
}) {
  const [preferred, setPreferred] = useState<OwnStore>('PLUS')
  const [message, setMessage] = useState('')
  const [showAllMissing, setShowAllMissing] = useState(false)
  const [missingQuery, setMissingQuery] = useState('')
  const [copyFallback, setCopyFallback] = useState<{ key: string; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const validStores = STORES.filter(store => {
    const reviewed = confirmedPartialBasket(progress, store, now)
    return reviewed && reviewed.remainingCount > 0 && !complete?.stores[store]
  })
  const store = validStores.includes(preferred) ? preferred : validStores[0]
  const capture = store && progress?.stores[store]
  const summary = store ? confirmedPartialBasket(progress, store, now) : null
  const rows = capture?.confirmedSourceLines ?? []
  // Information only: compare identical physical demand at TWO current,
  // individually admitted original capture instants. A delta never changes
  // this store's checked shopping task or creates a whole-basket winner.
  const pairByIngredient = new Map(privateProgressPricePairs(progress, now).map(
    pair => [pair.one.ingredientId, pair]))
  const identity = capture && progress ? JSON.stringify([
    progress.planKey, store, capture.observedAt,
    rows.map(row => [
      row.ingredientId, row.requiredAmount, row.requiredUnit, row.productId,
      row.packAmount, row.packUnit, row.packCount, row.packagesNeeded,
      row.pricePerPackCents, row.lineTotalCents,
    ]),
  ]) : ''
  const tick = (line: (typeof rows)[number]) =>
    privatePartialPhysicalShoppingTick(progress!.planKey, store!, line)
  const selected = Object.fromEntries(rows.map(line =>
    [line.ingredientId, checked[tick(line)] === true]))
  const checkedKey = JSON.stringify([identity, selected])
  const currentKey = useRef(checkedKey)
  currentKey.current = checkedKey
  const currentPlan = useRef(progress?.planKey)
  currentPlan.current = progress?.planKey
  if (!store || !capture || !summary || !identity || summary.remainingCount < 1) return null

  const incompleteNeeds = [
    ...capture.missingIngredients,
    ...capture.awaitingReviewIngredients,
  ]
  const search = missingQuery.trim().normalize('NFKC').toLocaleLowerCase('nl-NL')
  const filteredNeeds = incompleteNeeds.filter(item => !search ||
    [item.label, item.id].some(value =>
      value.normalize('NFKC').toLocaleLowerCase('nl-NL').includes(search)))
  const shownNeeds = showAllMissing ? filteredNeeds : filteredNeeds.slice(0, 8)
  function setTick(line: (typeof rows)[number]) {
    if (!confirmedPartialBasket(progress, store, Date.now()) ||
        !recentOwnCaptureInstant(capture!.observedAt, Date.now())) {
      setMessage('De originele bron is verlopen; controleer eerst je opname in Vergelijk.')
      return
    }
    setCopyFallback(null)
    const key = tick(line)
    setChecked(previous => ({ ...previous, [key]: !previous[key] }))
  }
  async function produce(kind: 'text' | 'csv' | 'copy' | 'share') {
    setMessage('')
    setCopyFallback(null)
    const plan = progress?.planKey
    const confirmed = confirmedPartialBasket(progress, store, Date.now())
    if (!confirmed || confirmed.remainingCount < 1 ||
        !recentOwnCaptureInstant(capture!.observedAt, Date.now())) {
      setMessage('Oude of gewijzigde winkelopname; open de bron eerst opnieuw.')
      return
    }
    try {
      // Share sheets require transient user activation; the trusted exporter
      // is already loaded, so a click can open the chooser synchronously.
      if (currentKey.current !== checkedKey ||
          currentPlan.current !== plan ||
          !confirmedPartialBasket(progress, store, Date.now()) ||
          !recentOwnCaptureInstant(capture!.observedAt, Date.now())) {
        throw new Error('De ingrediënten of bron zijn veranderd tijdens het maken van de lijst.')
      }
      const content = privatePartialShoppingExport({
        store, observedAt: capture!.observedAt, rows, unknown: incompleteNeeds,
        checked: selected, totalDemandLines: confirmed.physicalLineCount,
      }, kind === 'csv' ? 'csv' : 'text')
      if (kind === 'share' && typeof navigator.share === 'function') {
        try {
          // Original observed source is checked immediately before native OS handoff.
          if (currentKey.current !== checkedKey ||
              !confirmedPartialBasket(progress, store, Date.now()) ||
              !recentOwnCaptureInstant(capture!.observedAt, Date.now()))
            throw new Error('De originele winkelopname is inmiddels gewijzigd of verlopen.')
          await navigator.share({
            title: 'Supa · ' + store + ' · gedeeltelijk gecontroleerde boodschappen',
            text: content,
          })
          if (currentKey.current === checkedKey)
            setMessage('De deellijst is via jouw gekozen app gedeeld. Ontbrekende producten blijven onbekend.')
          return
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          if (currentKey.current !== checkedKey) return
          // Browser or OS cannot share: use existing clipboard/text fallback.
        }
      }
      if (kind === 'copy' || kind === 'share') {
        try {
          if (currentKey.current !== checkedKey ||
              !confirmedPartialBasket(progress, store, Date.now()) ||
              !recentOwnCaptureInstant(capture!.observedAt, Date.now()))
            throw new Error('De eigen bronopname is inmiddels verlopen.')
          if (!navigator.clipboard?.writeText)
            throw new Error('Geen klembordtoegang')
          await navigator.clipboard.writeText(content)
          if (currentKey.current !== checkedKey) return
          setMessage(store + ': de gecontroleerde deelboodschappen zijn gekopieerd.')
          return
        } catch {
          if (currentKey.current !== checkedKey ||
              !confirmedPartialBasket(progress, store, Date.now())) return
          setCopyFallback({ key: checkedKey, text: content })
          setMessage('Selecteer de eigen deellijst hieronder om handmatig te kopiëren.')
          return
        }
      }
      const url = URL.createObjectURL(new Blob([content], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-' + store.toLowerCase() + '-bevestigde-deelboodschappen.' +
          (kind === 'csv' ? 'csv' : 'txt')
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      if (currentKey.current === checkedKey)
        setMessage('Alleen de persoonlijk gecontroleerde deelboodschappen lokaal gedownload; geen compleet winkelmandje.')
    } catch (cause) {
      if (currentKey.current === checkedKey)
        setMessage(cause instanceof Error ? cause.message : 'De deellijst kon niet worden gemaakt.')
    }
  }
  return <section className="screen supa-partial-shop" aria-label="Mijn gedeeltelijk gecontroleerde winkelboodschappen">
    <header>
      <div>
        <span className="eyebrow">Eigen bronproducten · nog niet compleet</span>
        <h3>Neem al bevestigde winkelproducten mee</h3>
      </div>
      <div className="supa-partial-shop__actions">
        <button type="button" className="ghost-button" onClick={onOpenProducts}>
          Vergelijk gecontroleerde producten in Producten
        </button>
        <button type="button" className="ghost-button" onClick={onOpenComparison}>
          Controleer ontbrekende bronproducten
        </button>
      </div>
    </header>
    {validStores.length > 1 && <div className="supa-partial-shop__switch" aria-label="Kies eigen winkelbron">
      {validStores.map(option => <button key={option} type="button"
        aria-pressed={store === option} onClick={() => {
          setPreferred(option)
          setMessage('')
          setCopyFallback(null)
        }}>{option}</button>)}
    </div>}
    <p><strong>{store}</strong> · jouw oorspronkelijke bronmoment: {capture.observedAt}</p>
    <p className="supa-partial-shop__warning">
      <strong>{summary.confirmedCount} van {summary.physicalLineCount} ingrediënten</strong>
      {' '}hebben gecontroleerde artikelcodes en pakprijzen.
      {' '}{summary.remainingCount} nog niet compleet; hun prijzen blijven onbekend.
      De waarde {exactEuro.formatCents(summary.knownCents)} betreft alleen de
      bevestigde regels, <strong>geen totaalbedrag, winkelwinnaar of besparingsclaim</strong>.
    </p>
    <div className="supa-partial-shop__items">
      {rows.map(line => <article key={line.ingredientId}>
        <label>
          <input type="checkbox" checked={checked[tick(line)] === true}
            onChange={() => setTick(line)} />
          <span>
            <strong>{line.ingredientLabel}</strong>
            {' '}· {line.requiredAmount} {line.requiredUnit}
            <small>{line.packagesNeeded} × {line.productName} · SKU {line.productId}</small>
            <small>{line.packCount} × {line.packAmount} {line.packUnit} per pak ·
              {' '}{exactEuro.formatCents(line.pricePerPackCents)} per pak ·
              {' '}{line.unitPrice ?? 'eenheidsprijs onbekend'}</small>
          </span>
        </label>
        <strong>{exactEuro.formatCents(line.lineTotalCents)}</strong>
        {pairByIngredient.has(line.ingredientId) && (() => {
          const pair = pairByIngredient.get(line.ingredientId)!
          const otherShop = store === 'PLUS' ? 'DekaMarkt' : 'PLUS'
          const other = store === 'PLUS' ? pair.other : pair.one
          const own = store === 'PLUS' ? pair.one : pair.other
          const difference = own.lineTotalCents - other.lineTotalCents
          return <p className="supa-partial-shop__individual-delta">
            <small>{otherShop}: {other.packagesNeeded} hele pakken ·
              {' '}{exactEuro.formatCents(other.lineTotalCents)} voor dezelfde hoeveelheid.
              {' '}Eigen bronprijs, geen kassagarantie.</small>
            <strong>{difference === 0
              ? 'Gelijke hele-pakprijs voor dit ingrediënt.'
              : exactEuro.formatCents(Math.abs(difference)) +
                ' lagere hele-pakkosten bij ' +
                (difference > 0 ? otherShop : store) + ' voor alleen deze regel.'}</strong>
            <small>Andere ingrediënten blijven onbekend. Dit is geen
              besparing op het volledige winkelmandje.</small>
          </p>
        })()}
        <button type="button" className="ghost-button"
          onClick={() => onReviewIngredient(store, line.ingredientId)}>
          Controleer SKU in Vergelijk
        </button>
      </article>)}
    </div>
    {incompleteNeeds.length > 0 && <div className="supa-partial-shop__unknown">
      <h4>Ontbrekende of nog te controleren artikelen</h4>
      <p>Hier staan de nog ongeprijsde ingrediënten van hetzelfde fysieke weekmenu.
        Ook als de andere winkel al compleet is, blijven deze hoeveelheden
        onafhankelijk zichtbaar. Ze tellen niet mee in het deelbedrag hierboven.</p>
      <label className="supa-partial-shop__missing-search">
        Zoek ontbrekend ingrediënt
        <input type="search" maxLength={120} value={missingQuery}
          onChange={event => setMissingQuery(event.currentTarget.value)}
          placeholder="Bijvoorbeeld melk of rijst" />
      </label>
      <small>{filteredNeeds.length} van {incompleteNeeds.length} nog te beoordelen
        of ongeprijsde ingrediënten in deze winkel.</small>
      {shownNeeds.map(item =>
        <button type="button" key={item.id} className="ghost-button"
          onClick={() => onReviewIngredient(store, item.id)}>
          {item.label} · {typeof item.amount === 'number' &&
            Number.isFinite(item.amount) && item.amount > 0
              ? String(item.amount).replace('.', ',') + ' ' + (item.unit ?? '')
              : 'hoeveelheid nog controleren'} ·
          {' '}bronproduct controleren
        </button>)}
      {filteredNeeds.length > 8 && <button type="button" className="ghost-button"
        aria-expanded={showAllMissing}
        onClick={() => setShowAllMissing(previous => !previous)}>
        {showAllMissing ? 'Toon de eerste acht producten' :
          'Bekijk alle ' + filteredNeeds.length + ' ontbrekende producten'}
      </button>}
      {!filteredNeeds.length && <p role="status">Geen openstaand ingrediënt
        gevonden met deze zoekterm. Wis het zoekveld om alle te tonen.</p>}
    </div>}
    <div className="supa-partial-shop__actions">
      <button type="button" onClick={() => void produce('copy')}>Kopieer gecontroleerde deellijst</button>
      <button type="button" className="ghost-button" onClick={() => void produce('share')}>
        Deel gecontroleerde deellijst via mijn telefoon
      </button>
      <button type="button" className="ghost-button" onClick={() => void produce('text')}>Download TXT</button>
      <button type="button" className="ghost-button" onClick={() => void produce('csv')}>Download CSV</button>
    </div>
    {copyFallback?.key === checkedKey && <label className="supa-partial-shop__fallback">
      Selecteer en kopieer je eigen deellijst
      <textarea readOnly rows={9} value={copyFallback.text}
        onFocus={event => event.currentTarget.select()} />
    </label>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
