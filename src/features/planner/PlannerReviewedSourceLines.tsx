import { useState } from 'react'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { recentOwnCaptureInstant, type OwnStore, type PrivateCaptureProgress } from '../comparison/privateReviewedBasketBridge.ts'
import './plannerReviewedSourceLines.css'

const shops: OwnStore[] = ['PLUS', 'DekaMarkt']
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** Individual admitted SKU facts only. Never a complete basket authority. */
export function PlannerReviewedSourceLines({ progress, now, onReviewIngredient,
  hasCompleteComparison = false }: {
  progress: PrivateCaptureProgress | null
  now: number
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  hasCompleteComparison?: boolean
}) {
  const [query, setQuery] = useState('')
  const [shop, setShop] = useState<'both' | OwnStore>('both')
  const [expanded, setExpanded] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  if (!progress) return null
  const entries = shops.flatMap(store => {
    const source = progress.stores[store]
    if (!source?.fresh || !recentOwnCaptureInstant(source.observedAt, now)) return []
    return (source.confirmedSourceLines ?? []).map(line => ({ store, line }))
  })
  if (entries.length === 0) return null
  const plus = progress.stores.PLUS
  const deka = progress.stores.DekaMarkt
  const first = plus && observedInstant(plus.observedAt)
  const second = deka && observedInstant(deka.observedAt)
  const gap = first && second
    ? (first.ns >= second.ns ? first.ns - second.ns : second.ns - first.ns) : null
  const pairedTime = gap !== null && gap <= 86_400_000_000_000n
  const right = new Map((deka?.confirmedSourceLines ?? []).map(line => [line.ingredientId, line]))
  const pairs = !hasCompleteComparison && pairedTime &&
    entries.some(entry => entry.store === 'PLUS') &&
    entries.some(entry => entry.store === 'DekaMarkt')
    ? (plus?.confirmedSourceLines ?? []).flatMap(one => {
      const other = right.get(one.ingredientId)
      if (!other || one.requiredAmount !== other.requiredAmount ||
          one.requiredUnit !== other.requiredUnit ||
          one.ingredientLabel !== other.ingredientLabel) return []
      const difference = other.lineTotalCents - one.lineTotalCents
      return Number.isSafeInteger(difference) ? [{ one, other, difference }] : []
    }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    : []
  const search = query.trim().normalize('NFKC').toLocaleLowerCase('nl')
  const shown = entries.filter(({ store, line }) =>
    (shop === 'both' || shop === store) &&
    (!search || [line.ingredientLabel, line.productName, line.productId]
      .some(value => value.normalize('NFKC').toLocaleLowerCase('nl').includes(search))))
  function downloadPairedRows() {
    // Refresh both original source instants at the actual click. A long-open
    // tab cannot export already-expired numbers as a live price comparison.
    const current = Date.now()
    if (!plus || !deka || !recentOwnCaptureInstant(plus.observedAt, current) ||
        !recentOwnCaptureInstant(deka.observedAt, current) ||
        !pairedTime || !pairs.length) return
    const safe = (value: string) => value.replace(
      /[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 160)
    const entries = [
      'SUPA | PRIVÉ LOKALE WINKELBRONNEN | VOORLOPIGE REGELS',
      'Geen compleet mandje, onafhankelijke verificatie, winkelwinnaar of besparingsclaim.',
      'Alleen jouw persoonlijk gekoppelde producten; onbekende prijzen zijn niet nul.',
      'PLUS eigen opname: ' + safe(plus.observedAt),
      'DekaMarkt eigen opname: ' + safe(deka.observedAt),
      '',
      ...pairs.map(({ one, other, difference }) => [
        safe(one.ingredientLabel) + ' | ' + one.requiredAmount + ' ' + safe(one.requiredUnit),
        'PLUS SKU ' + safe(one.productId) + ': ' +
          one.packagesNeeded + ' pak(ken) | ' + eur.format(one.lineTotalCents / 100),
        'DekaMarkt SKU ' + safe(other.productId) + ': ' +
          other.packagesNeeded + ' pak(ken) | ' + eur.format(other.lineTotalCents / 100),
        'Voorlopig REGELverschil: ' +
          (difference === 0 ? 'gelijk' : eur.format(Math.abs(difference) / 100) +
          ' lager bij ' + (difference > 0 ? 'PLUS' : 'DekaMarkt')),
        '',
      ].join('\n')),
    ].join('\n')
    let url: string
    try {
      url = URL.createObjectURL(new Blob([entries], {
        type: 'text/plain;charset=utf-8',
      }))
    } catch {
      setExportMessage('Bestand maken lukt niet in deze browser. De bronprijzen zijn niet gewijzigd.')
      return
    }
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-eigen-voorlopige-winkelregels.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
      setExportMessage('Voorlopige lokale bronregels gedownload, zonder compleet mandtotaal.')
    } catch {
      setExportMessage('Download niet beschikbaar; brondata en productkeuzes blijven onaangeroerd.')
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  return <div className="supa-reviewed-source-lines__wrapper">
    {pairs.length > 0 && <section className="supa-reviewed-source-lines__peek"
      aria-label="Voorlopige prijsverschillen op bevestigde productregels">
      <header>
        <div>
          <strong>{pairs.length} ingrediënten met bevestigde prijzen bij beide winkels</strong>
          <p>Alleen dezelfde fysieke behoefte, originele bronmomenten maximaal 24 uur uiteen.
            Dit zijn <strong>losse regelprijzen, geen mandtotaal of winkelwinnaar</strong>.
            Overige producten en kosten zijn onbekend.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setExpanded(true)}>
          Bekijk alle bronproducten
        </button>
      </header>
      <div className="supa-reviewed-source-lines__peek-grid">
        {pairs.slice(0, 3).map(({ one, other, difference }) =>
          <article key={one.ingredientId}>
            <strong>{one.ingredientLabel} · {one.requiredAmount} {one.requiredUnit}</strong>
            <small>PLUS · {one.productName} · SKU {one.productId}</small>
            <span>{one.packagesNeeded} pak(ken) · {eur.format(one.lineTotalCents / 100)}</span>
            <small>DekaMarkt · {other.productName} · SKU {other.productId}</small>
            <span>{other.packagesNeeded} pak(ken) · {eur.format(other.lineTotalCents / 100)}</span>
            <strong>{difference === 0 ? 'Gelijke bevestigde regelprijs' :
              eur.format(Math.abs(difference) / 100) + ' op deze regel ' +
                (difference > 0 ? 'lager bij PLUS' : 'lager bij DekaMarkt')}</strong>
          </article>)}
      </div>
      {pairs.length > 3 && <small>En {pairs.length - 3} andere controleerbare
        regelverschillen. De totale winkelprijs blijft onbekend tot beide mandjes compleet zijn.</small>}
    </section>}
    <details className="supa-reviewed-source-lines" open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{entries.length} gekoppelde bronproducten en eenheidsprijzen bekijken</summary>
    {expanded && <>
      <p>Originele producten uit je eigen lokale winkelopnames. Dit zijn losse,
        gekoppelde regels, geen compleet mandje. Ontbrekende prijzen blijven onbekend.
        Zonder twee volledige recente mandjes is er <strong>geen winkelwinnaar
        of totale besparing</strong>.</p>
      {pairs.length > 0 && <section className="supa-reviewed-source-lines__paired">
        <h4>{pairs.length} ingrediënten met een eigen bronprijs bij beide winkels</h4>
        <p>Voorlopige regelverschillen bij exact dezelfde fysieke behoefte, met
          opnamemomenten maximaal 24 uur uiteen. <strong>Geen volledig mandtotaal,
          winkelwinnaar of bewezen besparing.</strong> Ontbrekende artikelen blijven onbekend.</p>
        <div className="supa-reviewed-source-lines__paired-grid">
          {pairs.slice(0, 12).map(({ one, other, difference }) =>
            <article key={one.ingredientId}>
              <strong>{one.ingredientLabel} · {one.requiredAmount} {one.requiredUnit}</strong>
              <span>PLUS: {eur.format(one.lineTotalCents / 100)} · {one.packagesNeeded} pak(ken)</span>
              <span>DekaMarkt: {eur.format(other.lineTotalCents / 100)} · {other.packagesNeeded} pak(ken)</span>
              <strong>{difference === 0 ? 'Gelijke regelprijs'
                : eur.format(Math.abs(difference) / 100) + ' verschil op deze regel (' +
                  (difference > 0 ? 'PLUS' : 'DekaMarkt') + ' lager)'}</strong>
            </article>)}
        </div>
        {pairs.length > 12 && <small>En {pairs.length - 12} andere gekoppelde regels.
          Het volledige bedrag verschijnt pas na controle van het hele mandje.</small>}
        <button type="button" className="ghost-button"
          onClick={downloadPairedRows}>Download voorlopige eigen regelvergelijking (TXT)</button>
        {exportMessage && <p role="status" aria-live="polite">{exportMessage}</p>}
      </section>}
      <div className="supa-reviewed-source-lines__controls">
        <label>Zoek ingrediënt, product of SKU
          <input type="search" value={query} maxLength={120}
            onChange={event => setQuery(event.currentTarget.value)} />
        </label>
        <label>Winkel
          <select value={shop}
            onChange={event => setShop(event.currentTarget.value as typeof shop)}>
            <option value="both">Beide winkels</option>
            <option value="PLUS">PLUS</option>
            <option value="DekaMarkt">DekaMarkt</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite">{shown.length} van {entries.length} gekoppelde
        artikelen zichtbaar; geen volledige mandtotalen.</p>
      <div className="supa-reviewed-source-lines__grid">
        {shown.map(({ store, line }) => <article
          key={JSON.stringify([store, line.ingredientId, line.productId])}>
          <small>{store} · {line.review === 'automatic'
            ? 'Eenduidig automatisch gekoppeld' : 'Zelf gecontroleerde match'}</small>
          <h4>{line.ingredientLabel}</h4>
          <strong>{line.productName}</strong>
          <small>Originele SKU: {line.productId}</small>
          <span>Pak: {line.packCount} × {line.packAmount} {line.packUnit}</span>
          <span>{eur.format(line.pricePerPackCents / 100)} per pak ·
            {' '}{line.unitPrice ?? 'Eenheidsprijs onbekend'}</span>
          <span>{line.packagesNeeded} hele pak(ken) voor deze regel ·
            {' '}{eur.format((line.packagesNeeded * line.pricePerPackCents) / 100)}</span>
          <button type="button" className="ghost-button" onClick={() => {
            const current = progress.stores[store]
            if (!current || !recentOwnCaptureInstant(current.observedAt, Date.now())) return
            onReviewIngredient(store, line.ingredientId)
          }}>Controleer originele SKU in Vergelijk</button>
        </article>)}
      </div>
    </>}
    </details>
  </div>
}
