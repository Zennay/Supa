import { euro as exactEuro } from '../../lib/money.ts'
import { productSearchText } from '../products/productSearchText.ts'
import { useRef, useState } from 'react'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { recentOwnCaptureInstant, type OwnStore, type PrivateCaptureProgress } from '../comparison/privateReviewedBasketBridge.ts'
import './plannerReviewedSourceLines.css'

const shops: OwnStore[] = ['PLUS', 'DekaMarkt']

/** Individual admitted SKU facts only. Never a complete basket authority. */
export function PlannerReviewedSourceLines({ progress, now, onReviewIngredient,
  hasCompleteComparison = false, onOpenComparison }: {
  progress: PrivateCaptureProgress | null
  now: number
  onReviewIngredient: (store: OwnStore, ingredientId: string) => void
  onOpenComparison: () => void
  hasCompleteComparison?: boolean
}) {
  const [query, setQuery] = useState('')
  const [shop, setShop] = useState<'both' | OwnStore>('both')
  const [expanded, setExpanded] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [pairCopyFallback, setPairCopyFallback] = useState<{ source: PrivateCaptureProgress; csv: string } | null>(null)
  const latestEvidence = useRef(progress)
  latestEvidence.current = progress
  if (!progress) return null
  const entries = shops.flatMap(store => {
    const source = progress.stores[store]
    if (!source?.fresh || !recentOwnCaptureInstant(source.observedAt, now)) return []
    return (source.confirmedSourceLines ?? []).map(line => ({ store, line }))
  })
  const plus = progress.stores.PLUS
  const deka = progress.stores.DekaMarkt
  const expiredStoreNames = shops.filter(store => {
    const capture = progress.stores[store]
    return capture && (!capture.fresh || !recentOwnCaptureInstant(capture.observedAt, now))
  })
  if (entries.length === 0 && expiredStoreNames.length === 0) return null
  const first = plus && observedInstant(plus.observedAt)
  const second = deka && observedInstant(deka.observedAt)
  const gap = first && second
    ? (first.ns >= second.ns ? first.ns - second.ns : second.ns - first.ns) : null
  const pairedTime = gap !== null && gap <= 86_400_000_000_000n
  // One store can cross the seven-day boundary while the other is still
  // fresh (even with a <=24h capture gap). A partial product row does not
  // make the older store's unexpired source valid again.
  const bothFresh = !!plus?.fresh && !!deka?.fresh &&
    recentOwnCaptureInstant(plus.observedAt, now) &&
    recentOwnCaptureInstant(deka.observedAt, now)
  const right = new Map((deka?.confirmedSourceLines ?? []).map(line => [line.ingredientId, line]))
  const pairs = !hasCompleteComparison && pairedTime && bothFresh &&
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
  const pairCopy = pairCopyFallback?.source === progress && bothFresh && pairs.length > 0
    ? pairCopyFallback.csv : null
  const search = productSearchText(query.trim())
  const shown = entries.filter(({ store, line }) =>
    (shop === 'both' || shop === store) &&
    (!search || [line.ingredientLabel, line.productName, line.productId]
      .some(value => productSearchText(value).includes(search))))
  async function downloadPairedCsv() {
    setExportMessage('')
    try {
      const original = progress
      if (!plus || !deka || !pairedTime || !pairs.length ||
          !recentOwnCaptureInstant(plus.observedAt, Date.now()) ||
          !recentOwnCaptureInstant(deka.observedAt, Date.now())) {
        throw new Error('Bevestigde bronprijzen zijn niet meer actueel of onderling vergelijkbaar.')
      }
      const { privatePairedSourceCsv } = await import('./privatePairedSourceCsv.ts')
      // The lazy formatter must not extend the lifetime of an obsolete
      // receipt when another source or physical Planner week replaces it.
      if (latestEvidence.current !== original ||
          !recentOwnCaptureInstant(plus.observedAt, Date.now()) ||
          !recentOwnCaptureInstant(deka.observedAt, Date.now())) {
        throw new Error('De winkelbron is gewijzigd of verlopen. Open de huidige bron opnieuw.')
      }
      const csv = privatePairedSourceCsv(pairs, {
        PLUS: plus.observedAt, DekaMarkt: deka.observedAt,
      })
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-voorlopige-plus-deka-productregels.csv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setExportMessage('Bevestigde productregels met originele SKU’s en regelverschillen als privé-CSV opgeslagen. Geen volledig mandtotaal.')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Voorlopige productregels exporteren lukt niet.')
    }
  }

  async function copyPairedCsv() {
    setExportMessage('')
    setPairCopyFallback(null)
    let portableCsv: string | null = null
    try {
      const original = progress
      if (!plus || !deka || !pairedTime || !bothFresh || !pairs.length)
        throw new Error('Er zijn geen twee actuele, controleerbare bronproducten om te kopiëren.')
      const { privatePairedSourceCsv } = await import('./privatePairedSourceCsv.ts')
      // Lazy import and tab updates must never retain an expired pair.
      if (latestEvidence.current !== original ||
          !recentOwnCaptureInstant(plus.observedAt, Date.now()) ||
          !recentOwnCaptureInstant(deka.observedAt, Date.now()))
        throw new Error('De bron is gewijzigd of verlopen. Bekijk eerst de huidige winkelopname.')
      portableCsv = privatePairedSourceCsv(pairs, {
        PLUS: plus.observedAt, DekaMarkt: deka.observedAt,
      })
      if (!navigator.clipboard?.writeText) throw new Error('Klembord niet beschikbaar.')
      await navigator.clipboard.writeText(portableCsv)
      setExportMessage('Eigen oorspronkelijke PLUS/Deka-bronproducten als privé-CSV gekopieerd. Deel ze alleen bewust; dit is geen volledig mandtotaal.')
    } catch (error) {
      // Permission denied or browser clipboard unavailable: give a local
      // selectable fallback ONLY for this unchanged, still-fresh source.
      if (portableCsv && progress && latestEvidence.current === progress && bothFresh && pairs.length > 0 &&
          plus && deka && recentOwnCaptureInstant(plus.observedAt, Date.now()) &&
          recentOwnCaptureInstant(deka.observedAt, Date.now())) {
        setPairCopyFallback({ source: progress, csv: portableCsv })
        setExportMessage('Automatisch kopiëren niet beschikbaar. Selecteer hieronder je eigen privé-CSV.')
        return
      }
      setExportMessage(error instanceof Error ? error.message :
        'Bronproducten kopiëren is niet beschikbaar. Download de privé-CSV.')
    }
  }

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
          one.packagesNeeded + ' pak(ken) | ' + exactEuro.formatCents(one.lineTotalCents),
        'DekaMarkt SKU ' + safe(other.productId) + ': ' +
          other.packagesNeeded + ' pak(ken) | ' + exactEuro.formatCents(other.lineTotalCents),
        'Voorlopig REGELverschil: ' +
          (difference === 0 ? 'gelijk' : exactEuro.formatCents(Math.abs(difference)) +
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
    {expiredStoreNames.length > 0 && <p className="supa-reviewed-source-lines__age" role="status">
      {expiredStoreNames.join(' en ')}: de eerdere eigen bronopname is verlopen of
      niet meer bruikbaar. De voorlopige twee-winkelregelverschillen zijn verborgen;
      vernieuw eerst de oorspronkelijke winkelbron in Vergelijk. Onbekende
      prijzen blijven onbekend.
    </p>}
    {expiredStoreNames.length > 0 && <button type="button" className="ghost-button"
      onClick={onOpenComparison}>
      Vernieuw mijn eigen {expiredStoreNames.join(' en ')}-winkelbron in Vergelijk
    </button>}
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
            <span>{one.packagesNeeded} pak(ken) · {exactEuro.formatCents(one.lineTotalCents)}</span>
            <small>{one.unitPrice ?? 'Eenheidsprijs onbekend'}</small>
            <small>DekaMarkt · {other.productName} · SKU {other.productId}</small>
            <span>{other.packagesNeeded} pak(ken) · {exactEuro.formatCents(other.lineTotalCents)}</span>
            <small>{other.unitPrice ?? 'Eenheidsprijs onbekend'}</small>
            <strong>{difference === 0 ? 'Gelijke bevestigde regelprijs' :
              exactEuro.formatCents(Math.abs(difference)) + ' op deze regel ' +
                (difference > 0 ? 'lager bij PLUS' : 'lager bij DekaMarkt')}</strong>
          </article>)}
      </div>
      {pairs.length > 3 && <small>En {pairs.length - 3} andere controleerbare
        regelverschillen. De totale winkelprijs blijft onbekend tot beide mandjes compleet zijn.</small>}
      <button type="button" className="ghost-button" onClick={() => void copyPairedCsv()}>
        Kopieer originele PLUS/Deka-productregels (CSV)
      </button>
      {pairCopy && <label>Handmatig kopiëren van je eigen originele bronproducten
        <textarea readOnly rows={Math.min(pairs.length + 3, 12)} value={pairCopy}
          onFocus={event => event.currentTarget.select()} />
      </label>}
      <button type="button" className="ghost-button" onClick={() => void downloadPairedCsv()}>
        Download gecontroleerde PLUS/Deka-productregels (CSV)
      </button>
      {exportMessage && <p role="status" aria-live="polite">{exportMessage}</p>}
    </section>}
    {entries.length > 0 && <details className="supa-reviewed-source-lines" open={expanded}
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
              <span>PLUS: {exactEuro.formatCents(one.lineTotalCents)} · {one.packagesNeeded} pak(ken)</span>
              <span>DekaMarkt: {exactEuro.formatCents(other.lineTotalCents)} · {other.packagesNeeded} pak(ken)</span>
              <strong>{difference === 0 ? 'Gelijke regelprijs'
                : exactEuro.formatCents(Math.abs(difference)) + ' verschil op deze regel (' +
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
          <span>{exactEuro.formatCents(line.pricePerPackCents)} per pak ·
            {' '}{line.unitPrice ?? 'Eenheidsprijs onbekend'}</span>
          <span>{line.packagesNeeded} hele pak(ken) voor deze regel ·
            {' '}{exactEuro.formatCents(line.lineTotalCents)}</span>
          <button type="button" className="ghost-button" onClick={() => {
            const current = progress.stores[store]
            if (!current || !recentOwnCaptureInstant(current.observedAt, Date.now())) return
            onReviewIngredient(store, line.ingredientId)
          }}>Controleer originele SKU in Vergelijk</button>
        </article>)}
      </div>
    </>}
    </details>}
  </div>
}
