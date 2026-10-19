import { useState } from 'react'

type ReceiptLine = {
  ingredient: string
  ingredientId: string
  PLUS: { sourceProductId: string; sourceProductName: string; totalWholePackagesCents: number }
  DekaMarkt: { sourceProductId: string; sourceProductName: string; totalWholePackagesCents: number }
  dekaMinusPlusCents: number
}
type SavedReceipt = {
  generatedAt: string
  plusObservedAt: string
  dekaObservedAt: string
  plusCents: number
  dekaCents: number
  differenceCents: number
  cheapest: 'PLUS' | 'DekaMarkt' | null
  lines: ReceiptLine[]
}
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function textValue(value: unknown, max = 250): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
}
function cents(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0
}
function extractProduct(value: unknown): ReceiptLine['PLUS'] | null {
  if (!record(value) || !record(value.package) ||
      !textValue(value.sourceProductId, 120) || !textValue(value.sourceProductName) ||
      !cents(value.pricePerPackageCents) || !cents(value.totalWholePackagesCents) ||
      !Number.isSafeInteger(value.packagesNeeded) ||
      typeof value.packagesNeeded !== 'number' || value.packagesNeeded <= 0 ||
      !Number.isSafeInteger(value.package.count) ||
      typeof value.package.count !== 'number' || value.package.count <= 0 ||
      typeof value.package.amount !== 'number' ||
      !Number.isFinite(value.package.amount) || value.package.amount <= 0 ||
      !['g', 'kg', 'ml', 'l', 'piece'].includes(String(value.package.unit)) ||
      value.pricePerPackageCents * value.packagesNeeded !== value.totalWholePackagesCents) {
    return null
  }
  return {
    sourceProductId: value.sourceProductId,
    sourceProductName: value.sourceProductName,
    totalWholePackagesCents: value.totalWholePackagesCents,
  }
}

/** A stored report is a read-only document, NEVER a replacement source capture.
 * Recompute the arithmetical totals before displaying; this does not verify
 * retailer provenance, original human review or freshness of a local file.
 */
export function readPrivateReceipt(raw: string): SavedReceipt | null {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 512_000) return null
  try {
    const root: unknown = JSON.parse(raw)
    if (!record(root) || root.kind !== 'supa-private-derived-two-store-week-report' ||
        root.schemaVersion !== 1 || root.currency !== 'EUR' ||
        root.publicSavingsClaimEligible !== false ||
        root.verifiedRetailerObservations !== false || root.sourceImportable !== false ||
        !textValue(root.generatedAt, 80) ||
        !record(root.stores) || !record(root.stores.PLUS) || !record(root.stores.DekaMarkt) ||
        !textValue(root.stores.PLUS.observedAt, 80) ||
        !textValue(root.stores.DekaMarkt.observedAt, 80) ||
        !cents(root.stores.PLUS.totalWholePackagesCents) ||
        !cents(root.stores.DekaMarkt.totalWholePackagesCents) ||
        !record(root.wholeBasket) || root.wholeBasket.samePhysicalDemand !== true ||
        root.wholeBasket.observedWithin24Hours !== true ||
        !cents(root.wholeBasket.absoluteDifferenceCents) ||
        !Array.isArray(root.products) || root.products.length > 200) return null

    const plusCents = root.stores.PLUS.totalWholePackagesCents
    const dekaCents = root.stores.DekaMarkt.totalWholePackagesCents
    if (root.wholeBasket.absoluteDifferenceCents !== Math.abs(dekaCents - plusCents) ||
        root.wholeBasket.cheapestStore !== (plusCents === dekaCents ? null :
          plusCents < dekaCents ? 'PLUS' : 'DekaMarkt')) return null
    const lines: ReceiptLine[] = []
    const ids = new Set<string>()
    let plusTotal = 0
    let dekaTotal = 0
    for (const item of root.products) {
      if (!record(item) || !record(item.demand) ||
          !textValue(item.ingredientId, 120) || !textValue(item.ingredient) ||
          ids.has(item.ingredientId) ||
          typeof item.demand.amount !== 'number' ||
          !Number.isFinite(item.demand.amount) || item.demand.amount <= 0 ||
          !['g', 'kg', 'ml', 'l', 'piece'].includes(String(item.demand.unit))) return null
      const plus = extractProduct(item.PLUS)
      const deka = extractProduct(item.DekaMarkt)
      if (!plus || !deka || !Number.isSafeInteger(item.dekaMinusPlusCents) ||
          item.dekaMinusPlusCents !== deka.totalWholePackagesCents - plus.totalWholePackagesCents) return null
      plusTotal += plus.totalWholePackagesCents
      dekaTotal += deka.totalWholePackagesCents
      if (!Number.isSafeInteger(plusTotal) || !Number.isSafeInteger(dekaTotal)) return null
      ids.add(item.ingredientId)
      lines.push({
        ingredientId: item.ingredientId,
        ingredient: item.ingredient,
        PLUS: plus,
        DekaMarkt: deka,
        dekaMinusPlusCents: item.dekaMinusPlusCents as number,
      })
    }
    if (plusTotal !== plusCents || dekaTotal !== dekaCents) return null
    return {
      generatedAt: root.generatedAt,
      plusObservedAt: root.stores.PLUS.observedAt,
      dekaObservedAt: root.stores.DekaMarkt.observedAt,
      plusCents, dekaCents,
      differenceCents: root.wholeBasket.absoluteDifferenceCents,
      cheapest: root.wholeBasket.cheapestStore as SavedReceipt['cheapest'],
      lines,
    }
  } catch { return null }
}

/** Explicit local document viewer: never restores the exported figures as an
 * approved basket, price candidate or a new capture date in Supa.
 */
export function PrivateOwnReceiptViewer() {
  const [saved, setSaved] = useState<SavedReceipt | null>(null)
  const [message, setMessage] = useState('')
  async function openFile(file: File | undefined) {
    setSaved(null)
    setMessage('')
    if (!file) return
    if (!file.size || file.size > 512_000) {
      setMessage('Bestand geweigerd: alleen een volledig lokaal Supa-rapport tot 512 kB.')
      return
    }
    try {
      const parsed = readPrivateReceipt(await file.text())
      if (!parsed) throw Error('Ongeldig of veranderd rapport')
      setSaved(parsed)
      setMessage('Privérapport lokaal geopend; dit is een historisch document, geen actuele winkelprijs.')
    } catch {
      setMessage('Dit is geen volledig, rekenkundig consistent Supa-privérapport. Er is niets ingelezen als winkelbron.')
    }
  }

  return <details className="own-store-planner__archive">
    <summary>Open een eerder opgeslagen eigen prijsrapport (JSON)</summary>
    <p>Alleen op dit apparaat lezen. Het bestand wordt niet geüpload, bevestigt geen actuele winkelprijzen
      en wordt nooit als nieuwe PLUS- of DekaMarkt-bron gebruikt.</p>
    <label>Mijn eigen Supa-rapport kiezen
      <input type="file" accept=".json,application/json"
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void openFile(file)
        }} />
    </label>
    {message && <p role="status">{message}</p>}
    {saved && <div className="own-store-planner__archive-content">
      <p><strong>Historisch, niet opnieuw geverifieerd rapport</strong> · aangemaakt {saved.generatedAt}</p>
      <p>Origineel opgenomen: PLUS {saved.plusObservedAt} · DekaMarkt {saved.dekaObservedAt}</p>
      <p><strong>PLUS {euro.format(saved.plusCents / 100)} · DekaMarkt {euro.format(saved.dekaCents / 100)}</strong></p>
      <p>{saved.cheapest === null ? 'In dit opgeslagen rapport waren de mandjes even duur.' :
        'In dit opgeslagen rapport was ' + saved.cheapest + ' ' +
        euro.format(saved.differenceCents / 100) + ' goedkoper voor hetzelfde fysieke mandje.'}</p>
      <div className="own-store-planner__scroll" role="region" aria-label="Historische productprijzen" tabIndex={0}>
        <table><thead><tr><th>Ingrediënt</th><th>PLUS</th><th>DekaMarkt</th><th>Historisch verschil</th></tr></thead>
          <tbody>{saved.lines.map(item => <tr key={item.ingredientId}>
            <th scope="row">{item.ingredient}</th>
            <td>{item.PLUS.sourceProductName} · {item.PLUS.sourceProductId} · {euro.format(item.PLUS.totalWholePackagesCents / 100)}</td>
            <td>{item.DekaMarkt.sourceProductName} · {item.DekaMarkt.sourceProductId} · {euro.format(item.DekaMarkt.totalWholePackagesCents / 100)}</td>
            <td>{item.dekaMinusPlusCents === 0 ? 'Gelijk' :
              euro.format(Math.abs(item.dekaMinusPlusCents) / 100) +
              (item.dekaMinusPlusCents > 0 ? ' goedkoper bij PLUS' : ' goedkoper bij DekaMarkt')}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" className="ghost-button" onClick={() => {
        setSaved(null)
        setMessage('Het ingelezen historische rapport is uit dit scherm gewist.')
      }}>Sluit en wis het geopende rapport</button>
    </div>}
  </details>
}
