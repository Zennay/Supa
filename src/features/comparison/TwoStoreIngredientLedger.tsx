import { useMemo, useState } from 'react'
import type { BasketComparison } from '../../domain/basketComparison.ts'
import type { BasketTraceLine, OneStoreBasket } from '../../domain/basket.ts'
import { unresolvedProductGuidance } from './unresolvedProductGuidance.ts'
import { privateUnitPrice } from './privateUnitPrice.ts'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
type Row = {
  id: string
  label: string
  plus?: BasketTraceLine
  deka?: BasketTraceLine
  deltaCents: number | null
}

function StoreCell({ line, store, onReview }: {
  line?: BasketTraceLine
  store: 'PLUS' | 'DekaMarkt'
  onReview: (store: 'PLUS' | 'DekaMarkt', ingredientId: string) => void
}) {
  if (!line || line.status === 'unresolved') return <div className="offline-ingredient-ledger__unknown">
    <strong>Onbekend</strong>
    <small>{unresolvedProductGuidance(line)}</small>
    {line && <button type="button" onClick={() => onReview(store, line.id)}>
      Koppel in {store}
    </button>}
  </div>
  return <div className="offline-ingredient-ledger__store">
    <strong>{euro.format(line.lineTotalCents / 100)}</strong>
    <span>{line.productName}</span>
    <small>{line.packs} × {euro.format(line.pricePerPackCents / 100)} per verpakking</small>
    <small>{line.pack.count > 1 ? line.pack.count + ' × ' : ''}
      {line.pack.amount} {line.pack.unit} per verpakking · {privateUnitPrice(line) ?? 'eenheidsprijs onbekend'}</small>
    <button type="button" onClick={() => onReview(store, line.id)}>Wijzig koppeling</button>
  </div>
}

/** Same planned physical ingredients in both stores, never a derived or synthetic price source. */
export function TwoStoreIngredientLedger({
  plus, deka, comparison, comparable, onReview,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  comparison: BasketComparison
  comparable: boolean
  onReview: (store: 'PLUS' | 'DekaMarkt', ingredientId: string) => void
}) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [sortImpact, setSortImpact] = useState(false)
  const rows = useMemo(() => {
    const fromPlus = new Map(plus.lines.map(line => [line.id, line] as const))
    const fromDeka = new Map(deka.lines.map(line => [line.id, line] as const))
    const deltaById = comparable && comparison.claimable
      ? new Map(comparison.lineDeltas.map(delta => [delta.id, delta.deltaCents] as const))
      : new Map<string, number>()
    const ids = new Set([...fromPlus.keys(), ...fromDeka.keys()])
    const records: Row[] = [...ids].map(id => ({
      id, plus: fromPlus.get(id), deka: fromDeka.get(id),
      label: fromPlus.get(id)?.ingredientLabel ?? fromDeka.get(id)?.ingredientLabel ?? 'Ingrediënt',
      deltaCents: deltaById.get(id) ?? null,
    }))
    if (sortImpact && comparable) {
      records.sort((a, b) => Math.abs(b.deltaCents ?? 0) - Math.abs(a.deltaCents ?? 0) ||
        a.label.localeCompare(b.label, 'nl-NL'))
    }
    return records
  }, [plus, deka, comparison, comparable, sortImpact])
  const missing = rows.filter(row => row.plus?.status !== 'matched' || row.deka?.status !== 'matched')
  const visible = onlyMissing ? missing : rows
  return <section className="offline-ingredient-ledger" aria-label="Alle ingrediënten naast elkaar">
    <div className="offline-ingredient-ledger__header">
      <div>
        <h4>Alle ingrediënten: PLUS naast DekaMarkt</h4>
        <p>{rows.length} geplande ingrediënten, {missing.length} met een ontbrekende winkelkoppeling.
          Per winkel zie je het gekozen product, het aantal volledige verpakkingen en de eenheidsprijs.</p>
      </div>
      <div className="offline-ingredient-ledger__controls">
        <label><input type="checkbox" checked={onlyMissing}
          onChange={event => setOnlyMissing(event.target.checked)} /> Alleen ontbrekende koppelingen</label>
        <label><input type="checkbox" checked={sortImpact} disabled={!comparable}
          onChange={event => setSortImpact(event.target.checked)} /> Grootste prijsverschil eerst</label>
      </div>
    </div>
    {!comparable && <p className="disclaimer" role="status">
      Geen prijsverschil per ingrediënt zolang een mand onvolledig is, de opnames verouderd zijn
      of de waarnemingstijden niet vergelijkbaar zijn. Bekende winkelregels blijven inzichtelijk,
      maar zijn geen complete prijsvergelijking.
    </p>}
    <div className="offline-ingredient-ledger__table" role="table" aria-label="Twee winkelmandjes per ingrediënt">
      <div className="offline-ingredient-ledger__row offline-ingredient-ledger__column-head" role="row">
        <strong role="columnheader">Weekmenu</strong>
        <strong role="columnheader">PLUS</strong>
        <strong role="columnheader">DekaMarkt</strong>
        <strong role="columnheader">Verschil</strong>
      </div>
      {visible.map(row => <div className="offline-ingredient-ledger__row" role="row" key={row.id}>
        <div className="offline-ingredient-ledger__need" role="cell">
          <strong>{row.label}</strong>
          <small>Benodigd: {row.plus?.requirement.amount ?? row.deka?.requirement.amount ?? '?'}
            {' '}{row.plus?.requirement.unit ?? row.deka?.requirement.unit ?? ''}</small>
        </div>
        <div role="cell"><StoreCell line={row.plus} store="PLUS" onReview={onReview} /></div>
        <div role="cell"><StoreCell line={row.deka} store="DekaMarkt" onReview={onReview} /></div>
        <div role="cell" className="offline-ingredient-ledger__delta">
          {comparable && row.deltaCents !== null
            ? row.deltaCents === 0 ? 'Gelijk'
              : <><strong>{euro.format(Math.abs(row.deltaCents) / 100)}</strong>
                <small>{row.deltaCents > 0 ? 'PLUS goedkoper' : 'DekaMarkt goedkoper'}</small></>
            : 'Niet vergelijkbaar'}
        </div>
      </div>)}
    </div>
    {visible.length === 0 && <p role="status">
      {rows.length === 0
        ? 'Je hebt nog geen berekenbare weekmenu-ingrediënten gekozen. Open Planner om maaltijden te plannen.'
        : onlyMissing && missing.length === 0
          ? 'Geen ontbrekende productkoppelingen: alle geplande ingrediënten zijn in beide winkels gekoppeld.'
          : 'Er zijn geen ingrediënten zichtbaar met deze filterinstelling.'}
    </p>}
    <small className="disclaimer">Alle bedragen zijn uitsluitend berekend uit jouw lokale bronopnames.
      Een lagere regelprijs bewijst geen daadwerkelijke besparing of retailerautorisatie.</small>
  </section>
}
