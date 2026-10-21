import { useMemo, useState } from 'react'
import { euro } from '../../lib/money.ts'
import { observedInstant } from '../../domain/offlineReviewedImport.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import type { PreviewMatchLine } from './CaptureMatchingPreview.tsx'
import { completePreviewProposal, privateTwoStoreMissingChecklist, privateTwoStorePreviewChecklist } from './privateTwoStorePreviewChecklist.ts'
import { privateTwoStorePreviewPrintHtml } from './privateTwoStorePreviewPrintHtml.ts'
import { samePrivatePhysicalDemand } from './samePrivatePhysicalDemand.ts'

function labelQuantity(line: PreviewMatchLine): string {
  return readablePlannerDemandAmount(line.amount) + ' ' + line.unit
}
function localOffer(line: PreviewMatchLine | null, describeReason: (value: string) => string) {
  if (!completePreviewProposal(line)) {
    return <span>Geen complete betrouwbare productmatch. Prijs onbekend.
      {line?.reasons?.length ? <small style={{ display: 'block' }}>
        {describeReason(line.reasons[0])}
      </small> : <small style={{ display: 'block' }}>
        Controleer de originele productcode, verpakking en de hele-pak-prijs.
      </small>}
    </span>
  }
  return <span>
    <strong>{line.product}</strong>
    <small style={{ display: 'block' }}>Originele code {line.originalSku}</small>
    <span style={{ display: 'block' }}>
      {line.packCount} × {readablePlannerDemandAmount(line.packAmount)} {line.packUnit}
      {' '}per pak · {euro.formatCents(line.pricePerPackCents)} / pak
    </span>
    <span style={{ display: 'block' }}>
      Voor deze vraag: {line.packs} hele pakken ·{' '}
      <strong>{euro.formatCents(line.lineTotalCents)}</strong>
    </span>
    <small>Indicatief {line.unitPrice ?? 'eenheidsprijs onbekend'}; niet bevestigd</small>
  </span>
}

/**
 * Preview only. The two sources are canonical-admitted *drafts*, but human
 * SKU review has NOT happened. Showing two independently captured cost lines
 * is not a whole-basket financial comparison or a right to publish prices.
 */
export function CapturePairedPreview({
  plus, deka, within24h, sourceFresh, retainedStore, plusObservedAt, dekaObservedAt, describeReason,
}: {
  plus: readonly PreviewMatchLine[]
  deka: readonly PreviewMatchLine[]
  within24h: boolean
  sourceFresh: boolean
  retainedStore?: 'PLUS' | 'DekaMarkt'
  plusObservedAt: string
  dekaObservedAt: string
  describeReason: (value: string) => string
}) {
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [limit, setLimit] = useState(25)
  const [exportMessage, setExportMessage] = useState('')
  const [printable, setPrintable] = useState<string | null>(null)
  const rows = useMemo(() => {
    const byDeka = new Map(deka.map(line => [line.id, line]))
    const joined: Array<{
      id: string; label: string; left: PreviewMatchLine | null
      right: PreviewMatchLine | null; sameDemand: boolean; open: boolean
    }> = plus.map(left => {
      const right = byDeka.get(left.id) ?? null
      const sameDemand = !!right && left.label === right.label &&
        samePrivatePhysicalDemand(left, right)
      return { id: left.id, label: left.label, left, right, sameDemand,
        open: !sameDemand || !completePreviewProposal(left) ||
          !completePreviewProposal(right) }
    })
    for (const right of deka) {
      if (!plus.some(left => left.id === right.id)) joined.push({
        id: right.id, label: right.label, left: null,
        right, sameDemand: false, open: true,
      })
    }
    return joined
  }, [plus, deka])
  const norm = (value: string) => value.normalize('NFKD')
    .replace(/\p{M}/gu, '').toLocaleLowerCase('nl-NL')
  const filter = norm(query.trim())
  const visible = rows.filter(row => (!openOnly || row.open) &&
    (!filter || norm([
      row.label, row.left?.product ?? '', row.left?.originalSku ?? '',
      row.right?.product ?? '', row.right?.originalSku ?? '',
    ].join(' ')).includes(filter)))
  const missing = rows.filter(row => row.open).length
  const plusMoment = observedInstant(plusObservedAt)
  const dekaMoment = observedInstant(dekaObservedAt)
  const olderStore = plusMoment && dekaMoment
    ? plusMoment.ns <= dekaMoment.ns ? 'PLUS' : 'DekaMarkt' : null

  function reviewText() {
    return privateTwoStorePreviewChecklist({
      plus, deka, plusObservedAt, dekaObservedAt, within24h, sourceFresh, describeReason,
    })
  }
  function downloadLocal(content: string, mime: string, filename: string) {
    // Download from in-memory private text only; nothing is uploaded or fetched.
    const uri = URL.createObjectURL(new Blob([content], { type: mime }))
    try {
      const a = document.createElement('a')
      a.href = uri
      a.download = filename
      document.body.append(a)
      try { a.click() } finally { a.remove() }
    } finally { window.setTimeout(() => URL.revokeObjectURL(uri), 1000) }
  }
  function downloadMissingReview() {
    try {
      setExportMessage('')
      const text = privateTwoStoreMissingChecklist({
        plus, deka, plusObservedAt, dekaObservedAt, within24h, sourceFresh, describeReason,
      })
      downloadLocal(text, 'text/plain;charset=utf-8',
        'supa-PLUS-Deka-ontbrekende-bronmatches-prive.txt')
      setExportMessage('Alleen ontbrekende of incomplete bronvoorstellen lokaal bewaard. Nog geen winkelprijzen bevestigd.')
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'Kan de ontbrekende bronregels niet bewaren.')
    }
  }
  function downloadReview() {
    try {
      setExportMessage('')
      downloadLocal(reviewText(), 'text/plain;charset=utf-8',
        'supa-PLUS-Deka-bronmatch-voorcontrole-prive.txt')
      setExportMessage('Voorcontrole lokaal gedownload, zonder bevestigde prijsverschillen.')
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'Kan het privécontroleblad niet bewaren.')
    }
  }
  function downloadPrintableReview() {
    try {
      setExportMessage('')
      downloadLocal(privateTwoStorePreviewPrintHtml(reviewText()), 'text/html;charset=utf-8',
        'supa-PLUS-Deka-broncontrole-afdruk-prive.html')
      setExportMessage('Afdrukbaar privécontroleblad lokaal bewaard. Open het HTML-bestand om te printen; de conceptprijzen zijn niet bevestigd.')
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'Kan het offline printblad niet bewaren.')
    }
  }
  async function carryReview(scope: 'all' | 'missing', method: 'copy' | 'share') {
    try {
      setExportMessage('')
      const note = scope === 'all' ? reviewText() : privateTwoStoreMissingChecklist({
        plus, deka, plusObservedAt, dekaObservedAt, within24h, sourceFresh, describeReason,
      })
      // Always provide a local selectable fallback for denied permissions.
      setPrintable(note)
      if (method === 'copy') {
        if (!navigator.clipboard?.writeText) {
          throw Error('Klembord niet beschikbaar. Selecteer de tekst hieronder.')
        }
        await navigator.clipboard.writeText(note)
        setExportMessage('Privébroncontrole gekopieerd. Geen prijzen geaccepteerd.')
      } else {
        if (!navigator.share) {
          throw Error('Mobiel delen niet beschikbaar. Selecteer de tekst hieronder.')
        }
        await navigator.share({
          title: 'Supa · privé ' + (scope === 'missing' ? 'ontbrekende winkelmatches' : 'winkelbroncontrole'),
          text: note,
        })
        setExportMessage('Privécontroleblad bewust via je toestel gedeeld. Geen bron geaccepteerd.')
      }
    } catch (cause) {
      setExportMessage(cause instanceof Error && cause.name === 'AbortError'
        ? 'Delen geannuleerd; de tekst blijft hieronder selecteerbaar.'
        : cause instanceof Error ? cause.message : 'Gebruik de selecteerbare tekst hieronder.')
    }
  }

  return <details className="offline-price-workbench__capture-pair"
    aria-label="Beide winkels naast elkaar vóór bronovername">
    <summary>Zelfde Planner-vraag bij PLUS en DekaMarkt · bekijk de bronproducten naast elkaar
      {' '}({rows.length - missing} met twee voorstellen; {missing} nog te controleren)</summary>
    {retainedStore && <p role="status">{retainedStore}: de vergelijking gebruikt
      de reeds ingevoerde originele opname van deze winkel (ongewijzigd tijdstip).
      De nieuw ingevoerde andere winkel blijft een concept en heeft nog geen review.
      Bronmomenten worden niet automatisch gelijkgetrokken.</p>}
    <p className="disclaimer">Twee onafhankelijke <strong>nog niet geaccepteerde</strong>{' '}
      opnameconcepten voor dezelfde Planner-behoefte. De getoonde prijzen zijn uitsluitend
      de ingevoerde lokale bronwaarden, niet persoonlijk bevestigd. Pas ná
      controle van beide originele SKU’s en bronmomenten kan de bestaande
      vergelijking een volledig prijsverschil bepalen.</p>
    {!within24h && <p role="status">De echte opname-tijden verschillen meer dan 24 uur.
      {olderStore ? ' Vernieuw de bron van ' + olderStore + ' met een werkelijke nieuwe opname.' :
        ' Controleer beide oorspronkelijke bronmomenten.'}
      {' '}Er is geen volledig vergelijkbaar prijsverschil zolang het bronpaar te ver uiteenligt.</p>}
    {!sourceFresh && <p role="status">Minstens één bronmoment is ouder dan zeven
      dagen of ongeldig. Vermeld deze getallen niet als actuele prijzen.</p>}
    <div className="offline-price-workbench__matching-controls">
      <label>Zoek origineel ingrediënt of bronproduct
        <input type="search" value={query} maxLength={120}
          onChange={event => { setQuery(event.currentTarget.value); setLimit(25) }}
          placeholder="Zoek in beide winkels" />
      </label>
      <label><input type="checkbox" checked={openOnly}
        onChange={event => { setOpenOnly(event.currentTarget.checked); setLimit(25) }} />
        {' '}Alleen ontbrekende/twijfelachtige regels ({missing})</label>
    </div>
    <p role="status">{Math.min(limit, visible.length)} van {visible.length} regels zichtbaar.
      Filters wijzigen geen originele bron of productreview.</p>
    <div className="offline-price-workbench__breakdown-scroll">
      <table>
        <caption>Privé bronvoorinzage: dezelfde fysieke Planner-vraag, twee winkels.
          Dit zijn geen bevestigde prijzen of totaalmandbedragen.</caption>
        <thead><tr>
          <th scope="col">Ingrediënt</th>
          <th scope="col">PLUS<small style={{ display: 'block' }}>
            Origineel bronmoment: <time dateTime={plusObservedAt}>{plusObservedAt}</time>
            {!within24h && olderStore === 'PLUS' && ' · oudste opname'}
          </small></th>
          <th scope="col">DekaMarkt<small style={{ display: 'block' }}>
            Origineel bronmoment: <time dateTime={dekaObservedAt}>{dekaObservedAt}</time>
            {!within24h && olderStore === 'DekaMarkt' && ' · oudste opname'}
          </small></th>
        </tr></thead>
        <tbody>{visible.slice(0, limit).map(row =>
          <tr key={row.id}>
            <th scope="row">{row.label}<small style={{ display: 'block' }}>
              {row.sameDemand && row.left
                ? labelQuantity(row.left) + (row.right &&
                    (row.left.unit !== row.right.unit || row.left.amount !== row.right.amount)
                    ? ' = ' + labelQuantity(row.right) + ' · fysiek gelijk' : '')
                : 'Vraag ongelijk of ontbrekend — controleren'}
            </small></th>
            {row.sameDemand
              ? <><td>{localOffer(row.left, describeReason)}</td><td>{localOffer(row.right, describeReason)}</td></>
              : <td colSpan={2}>De originele fysieke vraag is niet eenduidig
                voor beide winkels. PLUS: {row.left ? labelQuantity(row.left) : 'ontbreekt'}.
                {' '}DekaMarkt: {row.right ? labelQuantity(row.right) : 'ontbreekt'}.
                {' '}Herstel de Planner-vraag of de oorspronkelijke bronregels vóór
                prijsweergave of bevestiging.</td>}
          </tr>)}</tbody>
      </table>
    </div>
    {visible.length === 0 && <p>Geen regels gevonden voor dit filter.</p>}
    {visible.length > limit && <button type="button" className="ghost-button"
      onClick={() => setLimit(Math.min(limit + 25, visible.length))}>
      Toon volgende {Math.min(25, visible.length - limit)} regels
    </button>}
    <div className="offline-price-workbench__matching-actions">
      <button type="button" className="ghost-button" onClick={downloadReview}>
        Download privécontrole van beide bronvoorstellen (TXT)
      </button>
      <button type="button" className="ghost-button" onClick={downloadPrintableReview}>
        Bewaar offline printblad van beide originele bronvoorstellen (HTML)
      </button>
      <button type="button" className="ghost-button" onClick={downloadMissingReview}
        disabled={missing === 0}>
        Download alleen {missing} incomplete twee-winkelmatches (TXT)
      </button>
      <button type="button" className="ghost-button" onClick={() => void carryReview('all', 'copy')}>
        Kopieer broncontrole voor onderweg
      </button>
      <button type="button" className="ghost-button" disabled={missing === 0}
        onClick={() => void carryReview('missing', 'copy')}>
        Kopieer alleen {missing} openstaande winkelmatches
      </button>
      <button type="button" className="ghost-button" disabled={missing === 0}
        onClick={() => void carryReview('missing', 'share')}>
        Deel alleen openstaande broncontroles via mijn telefoon
      </button>
    </div>
    {printable !== null && <label>Gekozen privébronregels als selecteerbare tekst
      <textarea readOnly rows={9} spellCheck={false} value={printable}
        onFocus={event => event.currentTarget.select()}
        style={{ display: 'block', boxSizing: 'border-box', maxWidth: '100%', width: '100%' }} />
      <button type="button" className="ghost-button" onClick={() => setPrintable(null)}>
        Sluit kopieertekst
      </button>
    </label>}
    {exportMessage && <p role="status" aria-live="polite">{exportMessage}</p>}
    <small>Niet geprijsde, ontbrekende, oude of ongecontroleerde bronwaarden worden
      niet als € 0,00 of bewezen besparing gepresenteerd. Bevestig de officiële
      import hieronder pas na controle van je eigen waarnemingen.</small>
  </details>
}
