import { useState } from 'react'
import { euro as exactEuro } from '../../lib/money.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { privateUnitPrice, privatePackUnitRate } from './privateUnitPrice.ts'
import type { MixedStoreShoppingPlan } from './mixedStoreShoppingPlan.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>

/** Purely presentational readout of the SAME source-admitted baskets already
 * checked for complete, personally reviewed physical demand by the parent.
 * The per-unit amount is explanatory; the route uses whole-package totals.
 */
export function MixedStoreUnitBreakdown({
  plus, deka, route, captured, eligibleNow,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  route: MixedStoreShoppingPlan
  captured?: { PLUS: string; DekaMarkt: string }
  eligibleNow?: () => boolean
}) {
  const ownMatched = (basket: OneStoreBasket) =>
    new Map(basket.lines.filter((line): line is Matched =>
      line.status === 'matched').map(line => [line.id, line]))
  const plusLines = ownMatched(plus)
  const dekaLines = ownMatched(deka)
  const [sortBy, setSortBy] = useState<'planner' | 'biggest-difference' | 'unit-difference'>('planner')
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [search, setSearch] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const comparisons = route.lines.flatMap((chosen, index) => {
    const p = plusLines.get(chosen.id)
    const d = dekaLines.get(chosen.id)
    if (!p || !d) return []
    const plusUnit = privatePackUnitRate({
      amount: p.pack.amount, unit: p.pack.unit, count: p.pack.count,
      priceCents: p.pricePerPackCents,
    })
    const dekaUnit = privatePackUnitRate({
      amount: d.pack.amount, unit: d.pack.unit, count: d.pack.count,
      priceCents: d.pricePerPackCents,
    })
    const unitDifference = plusUnit && dekaUnit && plusUnit.unit === dekaUnit.unit
      ? Math.abs(plusUnit.milliCentsPerUnit - dekaUnit.milliCentsPerUnit) : null
    return [{
      chosen, p, d, index, unitDifference,
      difference: Math.abs(p.lineTotalCents - d.lineTotalCents),
    }]
  })
  const distinct = comparisons.filter(item => item.difference > 0).length
  const query = search.normalize('NFC').trim().toLocaleLowerCase('nl-NL')
  const filtered = comparisons.filter(({ chosen, p, d, difference }) => {
    if (onlyDifferences && difference === 0) return false
    if (!query) return true
    const haystack = [
      chosen.ingredientLabel, p.productName, d.productName, p.productId, d.productId,
    ].join(' ').normalize('NFC').toLocaleLowerCase('nl-NL')
    return haystack.includes(query)
  })
  const visible = sortBy === 'biggest-difference'
    ? [...filtered].sort((a, b) => b.difference - a.difference || a.index - b.index)
    : sortBy === 'unit-difference'
      ? [...filtered].sort((a, b) =>
          (b.unitDifference ?? -1) - (a.unitDifference ?? -1) || a.index - b.index)
      : filtered
  function downloadVisibleComparison() {
    if (!captured || !eligibleNow?.() || !visible.length) {
      setExportMessage('Bronprijzen zijn verlopen, ontbreken of de selectie is leeg. Controleer eerst jouw eigen winkelopnames.')
      return
    }
    const clean = (value: string) =>
      value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
    const text = [
      'Supa · mijn persoonlijke PLUS/Deka-prijsvergelijking',
      'PLUS originele opname: ' + clean(captured.PLUS),
      'DekaMarkt originele opname: ' + clean(captured.DekaMarkt),
      'Alleen persoonlijk gecontroleerde eigen bronproducten en hele verpakkingen.',
      'Getoonde regels: ' + visible.length + ' van ' + comparisons.length,
      'Geen live kassaprijzen, onafhankelijke besparingsclaim of retailerbronrecht.',
      '',
      ...visible.flatMap(({ chosen, p, d, difference }) => [
        clean(chosen.ingredientLabel) + ' · nodig ' + chosen.amount + ' ' + clean(chosen.unit),
        'PLUS: ' + clean(p.productName) + ' [SKU ' + clean(p.productId) + ']' +
          ' · ' + p.packs + ' pak(ken)' +
          ' · ' + exactEuro.formatCents(p.pricePerPackCents) + ' per pak' +
          ' · ' + (privateUnitPrice(p) ?? 'eenheidsprijs onbekend') +
          ' · hele weekregel ' + exactEuro.formatCents(p.lineTotalCents),
        'DekaMarkt: ' + clean(d.productName) + ' [SKU ' + clean(d.productId) + ']' +
          ' · ' + d.packs + ' pak(ken)' +
          ' · ' + exactEuro.formatCents(d.pricePerPackCents) + ' per pak' +
          ' · ' + (privateUnitPrice(d) ?? 'eenheidsprijs onbekend') +
          ' · hele weekregel ' + exactEuro.formatCents(d.lineTotalCents),
        'Verschil voor dezelfde benodigde hoeveelheid: ' + exactEuro.formatCents(difference) +
          (p.lineTotalCents === d.lineTotalCents ? ' (gelijk)' :
            ' (' + (p.lineTotalCents < d.lineTotalCents ? 'PLUS' : 'DekaMarkt') + ' lager)') +
          '; jouw gekozen route: ' + chosen.store, '',
      ]),
      'De originele brongegevens zijn niet bijgewerkt of doorgestuurd.',
    ].join('\n')
    if (new TextEncoder().encode(text).length > 128000 || !eligibleNow()) {
      setExportMessage('De selectie is te groot of je originele bronopnames zijn gewijzigd.')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-eigen-twee-winkel-prijsverschillen.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        setExportMessage('Alleen jouw zichtbare prijsvergelijking is lokaal opgeslagen.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch {
      setExportMessage('Deze lokale download is niet beschikbaar.')
    }
  }
  return <details className="offline-price-workbench__full-breakdown mixed-store-route__unit-breakdown">
    <summary>Vergelijk mijn twee bronproducten, eenheidsprijzen en pakbedragen per ingrediënt</summary>
    <p>De eenheidsprijs is alleen indicatief per kilogram, liter of stuk.
      De goedkoopste winkel voor jouw week wordt gekozen op het werkelijk benodigde
      <strong> aantal hele verpakkingen</strong> en bijbehorende regelbedrag.
      Een lagere prijs per kilo maakt een grotere verpakking niet automatisch
      goedkoper voor jouw benodigde hoeveelheid.</p>
    {captured && <p role="status">Eigen bronmomenten: PLUS <strong>{captured.PLUS}</strong> en
      DekaMarkt <strong>{captured.DekaMarkt}</strong>. Dit zijn opgeslagen
      waarnemingen, geen live prijzen of zelfstandig bevestigd veldbewijs.</p>}
    {eligibleNow && !eligibleNow() && <p role="alert">Deze vergelijking is
      inmiddels verlopen of gewijzigd. Herzie de oorspronkelijke winkelbronnen
      voordat je prijzen exporteert of hierop koopt.</p>}
    <div className="mixed-store-route__unit-controls" role="group"
      aria-label="Toon en sorteer vergeleken bronproducten">
      <label>Zoek ingrediënt, oorspronkelijk product of SKU
        <input type="search" value={search} maxLength={80}
          placeholder="Bijv. tomaten of broncode" onChange={event =>
            setSearch(event.currentTarget.value)} />
      </label>
      <label>Sorteer de prijsverschillen
        <select value={sortBy} onChange={event =>
          setSortBy(event.currentTarget.value as 'planner' | 'biggest-difference' | 'unit-difference')}>
          <option value="planner">Volgorde van mijn Planner</option>
          <option value="biggest-difference">Grootste prijsverschil eerst</option>
          <option value="unit-difference">Grootste vergelijkbare eenheidsprijsverschil eerst</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={onlyDifferences}
          onChange={event => setOnlyDifferences(event.currentTarget.checked)} />
        Toon alleen ingrediënten met een prijsverschil
      </label>
      {(search || onlyDifferences || sortBy !== 'planner') && <button type="button"
        onClick={() => { setSearch(''); setOnlyDifferences(false); setSortBy('planner') }}>
        Toon weer de volledige Planner-volgorde
      </button>}
      <p role="status">{distinct} van {comparisons.length} ingrediënten hebben
        een verschillend pakbedrag voor dezelfde benodigde hoeveelheid.
        {onlyDifferences ? ' Gelijke bedragen zijn tijdelijk verborgen.' : ''}
        {' '}Er zijn {visible.length} ingrediënten zichtbaar.
        Zoeken en sorteren veranderen je mandje, brongegevens en winkelroute niet.
        {sortBy === 'unit-difference' && ' Alleen eenheidsprijzen met dezelfde basis (kg, liter of stuk) worden vergeleken. Onbekende of onvergelijkbare eenheden komen achteraan; je echte weekkosten blijven op hele pakken gebaseerd.'}</p>
    </div>
    {captured && eligibleNow && <p>
      <button type="button" disabled={!visible.length || !eligibleNow()} onClick={downloadVisibleComparison}>
        Download deze persoonlijke prijsverschillen (TXT)
      </button>
      <small>Inclusief originele SKU, pakbedrag, eenheidsprijs en bronmoment per winkel;
        uitsluitend wat je hierboven hebt gefilterd.</small>
    </p>}
    {exportMessage && <p role="status" aria-live="polite">{exportMessage}</p>}
    <div className="mixed-store-route__unit-rows">
      {visible.map(({ chosen, p, d, difference }) => {
        const lessExpensive = p.lineTotalCents === d.lineTotalCents
          ? 'Beide winkels hebben hetzelfde regelbedrag.'
          : (p.lineTotalCents < d.lineTotalCents ? 'PLUS' : 'DekaMarkt') +
            ' is ' + exactEuro.formatCents(difference) +
            ' goedkoper voor deze benodigde hoeveelheid.'
        const row = (store: 'PLUS' | 'DekaMarkt', line: Matched) =>
          <div className={chosen.store === store ? 'mixed-store-route__unit-selected' : ''}
            key={store}>
            <strong>{store} {chosen.store === store ? '· gekozen voor jouw route' : ''}</strong>
            <span>{line.productName}</span>
            <small>Originele broncode: {line.productId}</small>
            <span>{line.packs} × {line.pack.count} × {line.pack.amount} {line.pack.unit}
              {' '}· {exactEuro.formatCents(line.pricePerPackCents)} per verpakking</span>
            <span>Eenheidsprijs: {privateUnitPrice(line) ?? 'Niet berekenbaar'}</span>
            <strong>Weekregel: {exactEuro.formatCents(line.lineTotalCents)}</strong>
          </div>
        return <article key={chosen.id}>
          <h5>{chosen.ingredientLabel} · nodig {chosen.amount} {chosen.unit}</h5>
          <div className="mixed-store-route__unit-stores">
            {row('PLUS', p)}
            {row('DekaMarkt', d)}
          </div>
          <p>{lessExpensive}</p>
          {difference > 0 && chosen.store !==
            (p.lineTotalCents < d.lineTotalCents ? 'PLUS' : 'DekaMarkt') && <p>
            Je hebt {chosen.store} gekozen. Voor deze oorspronkelijke fysieke
            hoeveelheid is dat <strong>{exactEuro.formatCents(difference)} duurder</strong>
            dan het andere beoordeelde product. Dit is alleen een vergelijking
            van jouw bronopnames, niet een actuele kassaprijs.
          </p>}
        </article>
      })}
      {visible.length === 0 && <p>Geen ingrediënten gevonden binnen deze selectie.
        Wis je zoekterm of schakel 'alleen verschillen' uit om de complete
        vergelijking uit jouw eigen bronopnames te bekijken.</p>}
    </div>
    <small>De originele productkeuzes zijn privé door jou bevestigd tegen eigen bronmateriaal.
      Eenheidsprijzen zijn rekenhulp, geen toezegging van actuele winkelvoorraad
      of onafhankelijke supermarktprijsvalidatie.</small>
  </details>
}
