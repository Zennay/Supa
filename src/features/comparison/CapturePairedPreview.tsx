import { useMemo, useState } from 'react'
import { euro } from '../../lib/money.ts'
import { readablePlannerDemandAmount } from './plannerPriceCaptureGuide.ts'
import type { PreviewMatchLine } from './CaptureMatchingPreview.tsx'

function labelQuantity(line: PreviewMatchLine): string {
  return readablePlannerDemandAmount(line.amount) + ' ' + line.unit
}
function localOffer(line: PreviewMatchLine | null) {
  if (!line || line.status !== 'matched' || !line.product ||
      line.originalSku === null || line.packs === null ||
      line.pricePerPackCents === null || line.lineTotalCents === null) {
    return <span>Ontbrekende of niet betrouwbare productmatch. Prijs onbekend.</span>
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
  plus, deka, within24h, sourceFresh, retainedStore,
}: {
  plus: readonly PreviewMatchLine[]
  deka: readonly PreviewMatchLine[]
  within24h: boolean
  sourceFresh: boolean
  retainedStore?: 'PLUS' | 'DekaMarkt'
}) {
  const [query, setQuery] = useState('')
  const [openOnly, setOpenOnly] = useState(false)
  const [limit, setLimit] = useState(25)
  const rows = useMemo(() => {
    const byDeka = new Map(deka.map(line => [line.id, line]))
    const joined: Array<{
      id: string; label: string; left: PreviewMatchLine | null
      right: PreviewMatchLine | null; sameDemand: boolean; open: boolean
    }> = plus.map(left => {
      const right = byDeka.get(left.id) ?? null
      const sameDemand = !!right && left.amount === right.amount &&
        left.unit === right.unit && left.label === right.label
      return { id: left.id, label: left.label, left, right, sameDemand,
        open: !sameDemand || left.status !== 'matched' ||
          right?.status !== 'matched' }
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
      Er is geen vergelijkbaar prijsverschil totdat de oudste winkel werkelijk opnieuw is opgenomen.</p>}
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
          <th scope="col">PLUS</th>
          <th scope="col">DekaMarkt</th>
        </tr></thead>
        <tbody>{visible.slice(0, limit).map(row =>
          <tr key={row.id}>
            <th scope="row">{row.label}<small style={{ display: 'block' }}>
              {row.sameDemand && row.left ? labelQuantity(row.left) :
                'Vraag ongelijk of ontbrekend — controleren'}
            </small></th>
            {row.sameDemand
              ? <><td>{localOffer(row.left)}</td><td>{localOffer(row.right)}</td></>
              : <td colSpan={2}>De originele fysieke vraag is niet eenduidig
                voor beide winkels. Geen prijsweergave totdat de Planner-regel
                en beide bronkeuzes overeenkomen.</td>}
          </tr>)}</tbody>
      </table>
    </div>
    {visible.length === 0 && <p>Geen regels gevonden voor dit filter.</p>}
    {visible.length > limit && <button type="button" className="ghost-button"
      onClick={() => setLimit(Math.min(limit + 25, visible.length))}>
      Toon volgende {Math.min(25, visible.length - limit)} regels
    </button>}
    <small>Niet geprijsde, ontbrekende, oude of ongecontroleerde bronwaarden worden
      niet als € 0,00 of bewezen besparing gepresenteerd. Bevestig de officiële
      import hieronder pas na controle van je eigen waarnemingen.</small>
  </details>
}
