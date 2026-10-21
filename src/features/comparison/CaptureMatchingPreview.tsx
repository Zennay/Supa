import { useMemo, useState } from 'react'
type Line = { id: string; label: string; status: 'matched' | 'unresolved'; amount: number | null; unit: string; product: string | null; originalSku: string | null; packs: number | null; reasons: string[] }
const clean = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('nl-NL')
const safe = (text: unknown) => String(text ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 180)
/** Display-only matching triage: never accepts a price or SKU automatically. */
export function CaptureMatchingPreview({ retailer, lines, proposed, unresolved, appended, reason }: {
  retailer: 'PLUS' | 'DekaMarkt'; lines: readonly Line[]; proposed: number
  unresolved: number; appended: boolean; reason: (text: string) => string
}) {
  const [query, setQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [shown, setShown] = useState(40)
  const [message, setMessage] = useState('')
  const visible = useMemo(() => lines.filter(line =>
    (!missingOnly || line.status === 'unresolved') &&
    (!query.trim() || clean([line.label, line.product ?? '', line.originalSku ?? ''].join(' ')).includes(clean(query.trim())))
  ), [lines, missingOnly, query])
  function downloadMissing() {
    try {
      setMessage('')
      const missing = lines.filter(line => line.status === 'unresolved')
      if (!missing.length) throw Error('Geen onopgeloste ingrediënten.')
      const text = [
        'SUPA | ' + retailer + ' | mijn nog te controleren Planner-ingrediënten',
        'PRIVÉ CHECKLIST: geen winkelprijs, bronbewijs of besparingsclaim.', '',
        ...missing.flatMap((line, index) => [
          String(index + 1) + '. ' + safe(line.label) + ' | nodig: ' + safe(line.amount ?? '?') + ' ' + safe(line.unit),
          '  Controle: ' + safe(line.reasons[0] ? reason(line.reasons[0]) : 'Handmatige artikelkeuze nodig'),
        ]), '',
      ].join('\n')
      if (new TextEncoder().encode(text).length > 128000) throw Error('Controlelijst te groot.')
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
  return <details className="offline-price-workbench__capture-matching">
    <summary>{retailer}: Planner-productmatching vooraf bekijken
      {appended ? ' (bestaande + nieuwe bronproducten)' : ''}
      {' '}({proposed} voorstellen, {unresolved} nog zonder match)</summary>
    <p className="disclaimer">Bekijk alle {lines.length} Planner-regels vóór import.
      Voorstellen zijn niet bevestigd: geen compleet mandbedrag of besparing.</p>
    <div className="offline-price-workbench__matching-controls">
      <label>Zoek ingrediënt, product of artikelcode
        <input type="search" value={query} placeholder="Zoek in alle oorspronkelijke regels"
          onChange={event => { setQuery(event.currentTarget.value); setShown(40) }} />
      </label>
      <label><input type="checkbox" checked={missingOnly}
        onChange={event => { setMissingOnly(event.currentTarget.checked); setShown(40) }} />
        {' '}Alleen zonder match ({unresolved})</label>
    </div>
    <p className="disclaimer" role="status">{Math.min(shown, visible.length)} van {visible.length} passende regels zichtbaar.
      {' '}Filters veranderen geen brondata.</p>
    {visible.length === 0 ? <p>Geen passende regels. Wis de zoekterm of het filter.</p> :
      <ul>{visible.slice(0, shown).map(line => <li key={line.id}>
        <strong>{line.label}</strong>: {' '}
        {line.status === 'matched' ? 'Voorstel: ' + line.product + ' · broncode ' +
          line.originalSku + ' · ' + line.packs + ' hele verpakking(en). Controleer zelf.' :
          'Nog geen betrouwbare productmatch. ' +
          (line.reasons[0] ? reason(line.reasons[0]) : 'Handmatige keuze nodig.')}
      </li>)}</ul>}
    {shown < visible.length && <div className="offline-price-workbench__matching-actions">
      <button type="button" onClick={() => setShown(n => n + 40)}>Toon volgende {Math.min(40, visible.length - shown)}</button>
      <button type="button" className="ghost-button" onClick={() => setShown(visible.length)}>Toon alle {visible.length}</button>
    </div>}
    {unresolved > 0 && <button type="button" className="ghost-button" onClick={downloadMissing}>
      Download alle {unresolved} onopgeloste ingrediënten als privécontrolelijst
    </button>}
    {message && <p role="alert">{message}</p>}
  </details>
}
