import { useMemo, useState } from 'react'
import { matchIngredient, type MatchUnit } from '../../domain/matching.ts'
import type { OfflinePriceSnapshots, OfflineRetailer, OfflineStoreProduct } from '../../domain/offlineReviewedImport.ts'
import type { PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'
import './plannerSourceMatchPreview.css'

const stores = ['PLUS', 'DekaMarkt'] as const
const units = new Set(['g', 'kg', 'ml', 'l', 'piece'])
const family = (unit: string): 'mass' | 'volume' | 'piece' | null =>
  unit === 'g' || unit === 'kg' ? 'mass' :
  unit === 'ml' || unit === 'l' ? 'volume' :
  unit === 'piece' ? 'piece' : null
type Suggestion = { name: string; sku: string } | null

/** Unconfirmed, read-only candidate hints. Canonical Workbench approves totals. */
export function PlannerSourceMatchPreview({ needs, source }: {
  needs: readonly PlannerCaptureGuideNeed[]
  source: OfflinePriceSnapshots
}) {
  const [showAll, setShowAll] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const coverage = useMemo(() => {
    const products = Object.fromEntries(stores.map(store => [
      store, new Map(source.captures[store]?.products.map(p => [p.id, p]) ?? []),
    ])) as Record<OfflineRetailer, Map<string, OfflineStoreProduct>>
    return needs.map(need => {
      const suggestions = {} as Record<OfflineRetailer, Suggestion>
      for (const store of stores) {
        const capture = source.captures[store]
        if (!capture || need.amount === null || !Number.isFinite(need.amount) ||
            need.amount <= 0 || !units.has(need.unit)) {
          suggestions[store] = null
          continue
        }
        const choice = matchIngredient({
          id: need.id, query: need.query || need.label, amount: need.amount,
          unit: need.unit as MatchUnit,
        }, capture.products)
        const match = choice.type === 'match' ? products[store].get(choice.productId) : null
        // The fuzzy matcher can rank an attractive name even if the source
        // package belongs to a different physical unit family. Never present
        // e.g. ml rice as a viable candidate for a gram-based rice demand.
        suggestions[store] = match && match.available && match.sourcePriceCents !== null &&
          match.packAmount !== null && family(match.packUnit) === family(need.unit)
          ? { name: match.name, sku: match.id } : null
      }
      return { need, suggestions }
    })
  }, [needs, source])
  if (!coverage.length) return null
  const suggested = stores.map(store => coverage.filter(line => line.suggestions[store]).length)
  const paired = coverage.filter(line => line.suggestions.PLUS && line.suggestions.DekaMarkt).length
  const missing = coverage.filter(line => !line.suggestions.PLUS || !line.suggestions.DekaMarkt)
  const filtered = onlyMissing ? missing : coverage
  const shown = filtered.slice(0, showAll ? 200 : 12)
  function downloadMissingSourceCapture() {
    // This sheet contains the CURRENT local user's physical demand only.
    // A candidate is no price proof and no retailer rights are implied.
    const singleLine = (value: string) => value
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 180)
    const rows = [
      'SUPA · ontbrekende producten voor hetzelfde Planner-weekmandje',
      'Lokaal controleblad, GEEN echte winkelwaarneming, prijs of toestemming.',
      'Alleen zelf rechtmatig verkregen bronnen en originele SKU’s noteren.',
      '',
      ...missing.flatMap(({ need, suggestions }) => stores.flatMap(store =>
        suggestions[store] ? [] : [
          store + ' · ' + singleLine(need.label) + ' · nodig: ' +
          (need.amount === null ? 'onbekend' : need.amount + ' ' + need.unit) +
          ' · bron-SKU/pakprijs nog koppelen of vastleggen',
        ])),
      '',
      'Na daadwerkelijke bronopname: importeer in Supa Vergelijk en bevestig hele verpakkingen.',
    ]
    const url = URL.createObjectURL(new Blob([rows.join('\n')], {
      type: 'text/plain;charset=utf-8',
    }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'supa-ontbrekende-winkel-SKUs-voor-weekmand.txt'
      document.body.append(link)
      try { link.click() } finally { link.remove() }
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
  }
  return <section className="supa-planner-source-matches" aria-label="Voorlopige weekmand-productmatching">
    <h4>Weekmand tegenover de aangeleverde bron-SKU’s</h4>
    <p>{coverage.length} fysieke ingrediënten: PLUS {suggested[0]} mogelijke kandidaten,
      DekaMarkt {suggested[1]}. Voor {paired} ingrediënten is er voorlopig een
      kandidaat bij beide winkels.</p>
    <p><strong>Dit zijn onbevestigde naam- en verpakkingssuggesties.</strong> Een
      winkelprijs of besparing ontstaat pas nadat Vergelijk de originele SKU,
      benodigde hele verpakkingen, volledige mandjes en bronmomenten controleert.</p>
    <label><input type="checkbox" checked={onlyMissing}
      onChange={e => { setOnlyMissing(e.target.checked); setShowAll(false) }} />
      Alleen ontbrekende of onzekere bronmatches tonen</label>
    <div className="supa-planner-source-matches__table" role="table"
      aria-label="Voorlopige bronmatching voor hetzelfde fysieke weekmandje">
      <div className="supa-planner-source-matches__row" role="row">
        <strong role="columnheader">Fysieke behoefte</strong>
        <strong role="columnheader">PLUS</strong>
        <strong role="columnheader">DekaMarkt</strong>
      </div>
      {shown.map(({ need, suggestions }) => <div className="supa-planner-source-matches__row"
        role="row" key={need.id}>
        <span role="cell"><strong>{need.label}</strong>
          <small>{need.amount ?? 'Onbekend'} {need.unit}</small></span>
        {stores.map(store => <span role="cell" key={store}>
          {suggestions[store] ? <>Kandidaat: {suggestions[store]!.name}
            <small>SKU {suggestions[store]!.sku} · niet bevestigd</small></>
            : 'Geen eenduidige geprijsde kandidaat; handmatig koppelen'}
        </span>)}
      </div>)}
    </div>
    {missing.length > 0 && <button type="button" className="ghost-button"
      onClick={downloadMissingSourceCapture}>
      Download ontbrekende PLUS/Deka-productcontroles (TXT)
    </button>}
    {filtered.length > shown.length && <button type="button" className="ghost-button"
      onClick={() => setShowAll(true)}>Toon alle {filtered.length} ingrediënten</button>}
    <small>Een kandidaat uit een verouderde opname is geen actuele prijs.
      Open de bron in Vergelijk voor definitieve controle.</small>
  </section>
}
