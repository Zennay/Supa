import type { ComparedOwnLine } from './ownStoreBudgetComparison.ts'
import type { OwnStore } from '../comparison/privateReviewedBasketBridge.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** A readable drilldown of the same canonically confirmed basket lines. */
export function PlannerOwnProductDeltas({ lines, onChooseLine }: {
  lines: ComparedOwnLine[]
  onChooseLine: (ingredientId: string, store: OwnStore) => void
}) {
  if (!lines.length) return null
  return <details className="own-store-planner__details">
    <summary>Bekijk {lines.length} productprijzen, verpakkingen en regelverschillen</summary>
    <p>Per ingrediënt het originele, persoonlijk gecontroleerde winkelproduct. Eenheidsprijzen
      zijn indicatief per kg, liter of stuk; de vergelijking rekent met hele verpakkingen.</p>
    <div className="own-store-planner__scroll" role="region" aria-label="Eigen productprijzen per winkel" tabIndex={0}>
      <table>
        <thead><tr><th scope="col">Ingrediënt</th><th scope="col">PLUS</th>
          <th scope="col">DekaMarkt</th><th scope="col">Verschil</th></tr></thead>
        <tbody>{lines.map(item => <tr key={item.id}>
          <th scope="row">{item.ingredientLabel}</th>
          {([item.plus, item.deka] as const).map((line, index) => <td key={index}>
            <strong>{euro.format(line.lineTotalCents / 100)}</strong>
            <small>{line.packs} × {line.productName} · SKU {line.productId}</small>
            <small>{line.pack.amount} {line.pack.unit} × {line.pack.count} per pak · {euro.format(line.pricePerPackCents / 100)} per pak</small>
            <small>{privateUnitPrice(line) ?? 'Eenheidsprijs onbekend'}</small>
          </td>)}
          <td><strong>{item.deltaCents === 0 ? 'Gelijk' : euro.format(Math.abs(item.deltaCents) / 100)}</strong>
            <small>{item.deltaCents > 0 ? 'PLUS lager' : item.deltaCents < 0 ? 'DekaMarkt lager' : 'Geen verschil'}</small>
            <div className="own-store-planner__line-actions" aria-label={'Kies winkel voor ' + item.ingredientLabel}>
              <button type="button" onClick={() => onChooseLine(item.id, 'PLUS')}>Kies PLUS</button>
              <button type="button" onClick={() => onChooseLine(item.id, 'DekaMarkt')}>Kies DekaMarkt</button>
            </div>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>
}
