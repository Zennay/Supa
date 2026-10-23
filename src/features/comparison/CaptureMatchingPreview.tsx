import { useMemo, useRef, useState } from 'react'
import { euro } from '../../lib/money.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import { completePreviewProposal } from './privateTwoStorePreviewChecklist.ts'

export type PreviewMatchLine = {
  id: string; label: string; status: 'matched' | 'unresolved'
  amount: number | null; unit: string; product: string | null
  originalSku: string | null; packs: number | null; reasons: string[]
  packAmount: number | null; packUnit: string | null; packCount: number | null
  pricePerPackCents: number | null; lineTotalCents: number | null
  unitPrice: string | null
  sourceUrl?: string | null; sourceSha256?: string | null
  sourceKind?: 'product' | 'catalog' | 'offers' | null
}
const clean = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl-NL')
const safe = (text: unknown) => String(text ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 180)

/** Display-only matching triage: never accepts a price or SKU automatically. */
export function CaptureMatchingPreview({ retailer, lines, appended, reason }: {
  retailer: 'PLUS' | 'DekaMarkt'; lines: readonly PreviewMatchLine[]; proposed: number
  unresolved: number; appended: boolean; reason: (text: string) => string
}) {
  const [query, setQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [shown, setShown] = useState(40)
  const [message, setMessage] = useState('')
  const [portable, setPortable] = useState<{ source: readonly PreviewMatchLine[]; text: string } | null>(null)
  const currentLines = useRef(lines)
  currentLines.current = lines
  const incomplete = useMemo(() => lines.filter(line =>
    !completePreviewProposal(line)), [lines])
  const visible = useMemo(() => lines.filter(line =>
    (!missingOnly || !completePreviewProposal(line)) &&
    (!query.trim() || clean([line.label, line.product ?? '', line.originalSku ?? ''].join(' ')).includes(clean(query.trim())))
  ), [lines, missingOnly, query])
  function missingReviewText(): string {
      const missing = incomplete
      if (!missing.length) throw Error('Geen onopgeloste ingrediënten.')
      const text = [
        'SUPA | ' + retailer + ' | mijn nog te controleren Planner-ingrediënten',
        'PRIVÉ CHECKLIST: geen winkelprijs, bronbewijs of besparingsclaim.', '',
        ...missing.flatMap((line, index) => [
          String(index + 1) + '. ' + safe(line.label) + ' | nodig: ' +
            readablePlannerDemandAmount(line.amount) + ' ' + safe(line.unit),
          '  Controle: ' + safe(line.reasons[0] ? reason(line.reasons[0]) : 'Handmatige artikelkeuze nodig'),
        ]), '',
      ].join('\n')
      if (new TextEncoder().encode(text).length > 128000) throw Error('Controlelijst te groot.')
      return text
  }
  function downloadMissing() {
    try {
      setMessage('')
      const text = missingReviewText()
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url; link.download = 'supa-' + retailer.toLowerCase() + '-ontbrekende-matches.txt'
        document.body.append(link); try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kon controlelijst niet maken.')
    }
  }
  async function carryMissing(method: 'copy' | 'share') {
    try {
      setMessage('')
      const text = missingReviewText()
      setPortable({ source: lines, text })
      if (method === 'copy') {
        if (!navigator.clipboard?.writeText) throw Error('Selecteer de tekst hieronder om te kopiëren.')
        await navigator.clipboard.writeText(text)
      } else {
        if (!navigator.share) throw Error('Mobiel delen is niet beschikbaar. Selecteer de tekst hieronder.')
        await navigator.share({ title: 'Supa · eigen ontbrekende ' + retailer + '-matches', text })
      }
      if (currentLines.current === lines) setMessage(
        'Privécontrole van openstaande ' + retailer + '-matches ' +
        (method === 'copy' ? 'gekopieerd.' : 'gedeeld via jouw toestel.') +
        ' Er is geen prijs bevestigd.')
    } catch (cause) {
      if (currentLines.current === lines) setMessage(cause instanceof Error && cause.name === 'AbortError'
        ? 'Delen geannuleerd. De lokale lijst blijft selecteerbaar.'
        : cause instanceof Error ? cause.message : 'Gebruik de selecteerbare lijst hieronder.')
    }
  }
  return <details className="offline-price-workbench__capture-matching">
    <summary>{retailer}: Planner-productmatching vooraf bekijken
      {appended ? ' (bestaande + nieuwe bronproducten)' : ''}
      {' '}({lines.length - incomplete.length} volledige voorstellen, {incomplete.length} nog te controleren)</summary>
    <p className="disclaimer">Bekijk alle {lines.length} Planner-regels vóór import.
      Voorstellen zijn niet bevestigd: geen compleet mandbedrag of besparing.</p>
    <div className="offline-price-workbench__matching-controls">
      <label>Zoek ingrediënt, product of artikelcode
        <input type="search" value={query} placeholder="Zoek in alle oorspronkelijke regels"
          onChange={event => { setQuery(event.currentTarget.value); setShown(40) }} />
      </label>
      <label><input type="checkbox" checked={missingOnly}
        onChange={event => { setMissingOnly(event.currentTarget.checked); setShown(40) }} />
        {' '}Alleen ontbrekende of incomplete matches ({incomplete.length})</label>
    </div>
    <p className="disclaimer" role="status">{Math.min(shown, visible.length)} van {visible.length} passende regels zichtbaar.
      {' '}Filters veranderen geen brondata.</p>
    {visible.length === 0 ? <p>Geen passende regels. Wis de zoekterm of het filter.</p> :
      <ul>{visible.slice(0, shown).map(line => <li key={line.id}>
        <strong>{line.label}</strong>: {' '}
        {completePreviewProposal(line) ? <>
            <span>Voorstel: {line.product} · broncode {line.originalSku}</span>
            <span style={{ display: 'block' }}>Oorspronkelijke behoefte:{' '}
              {readablePlannerDemandAmount(line.amount)} {line.unit}.{' '}
              Bronverpakking: {readablePlannerDemandAmount(line.packAmount)}{' '}
              {line.packUnit} × {line.packCount};{' '}
              <strong>{euro.formatCents(line.pricePerPackCents)} per verpakking</strong>.
            </span>
            <span style={{ display: 'block' }}>Voor diezelfde Planner-vraag:{' '}
              {line.packs} hele verpakking(en) ={' '}
              <strong>{euro.formatCents(line.lineTotalCents)}</strong>.
              {' '}Indicatieve eenheidsprijs: {line.unitPrice ?? 'niet berekenbaar'}.
            </span>
            <small>Voorstel uit jouw eigen lokale bron; prijs, SKU en pakketinhoud
              zijn nog niet persoonlijk bevestigd. Geen mandtotaal of besparingsclaim.</small>
            {(line.sourceUrl || line.sourceSha256 || line.sourceKind) && <details
              className="offline-price-workbench__source-provenance">
              <summary>Herkomst van dit bronartikel</summary>
              {line.sourceKind && <p>Bronsoort: {line.sourceKind === 'product'
                ? 'productpagina' : line.sourceKind === 'catalog'
                  ? 'catalogus' : 'aanbiedingen'}.</p>}
              {line.sourceUrl && <p>Originele bronpagina:{' '}
                <a href={line.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {line.sourceUrl}
                </a>
              </p>}
              {line.sourceSha256 && <p>Snapshot SHA-256: <code>{line.sourceSha256}</code></p>}
              <small>De hash identificeert de aangeleverde snapshot; dit bewijst op zichzelf
                geen bronrechten, prijsactualiteit of productgelijkwaardigheid.</small>
            </details>}
          </> : 'Nog geen betrouwbare productmatch. ' +
            (line.reasons[0] ? reason(line.reasons[0]) : 'Handmatige keuze nodig.')}
      </li>)}</ul>}
    {shown < visible.length && <div className="offline-price-workbench__matching-actions">
      <button type="button" onClick={() => setShown(n => n + 40)}>Toon volgende {Math.min(40, visible.length - shown)}</button>
      <button type="button" className="ghost-button" onClick={() => setShown(visible.length)}>Toon alle {visible.length}</button>
    </div>}
    {incomplete.length > 0 && <div className="offline-price-workbench__matching-actions">
      <button type="button" className="ghost-button" onClick={downloadMissing}>
        Download alle {incomplete.length} onvolledige voorstellen als privécontrolelijst
      </button>
      <button type="button" className="ghost-button" onClick={() => void carryMissing('copy')}>
        Kopieer {incomplete.length} openstaande {retailer}-matches voor onderweg
      </button>
      <button type="button" className="ghost-button" onClick={() => void carryMissing('share')}>
        Deel alleen openstaande {retailer}-matches via mijn telefoon
      </button>
    </div>}
    {portable?.source === lines && <label>Privécontrolelijst op dit apparaat, ook zonder klembord- of deeltoestemming
      <textarea rows={9} spellCheck={false} readOnly value={portable.text}
        onFocus={event => event.currentTarget.select()}
        style={{ display: 'block', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} />
      <button type="button" className="ghost-button" onClick={() => setPortable(null)}>
        Sluit kopieertekst
      </button>
    </label>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </details>
}
