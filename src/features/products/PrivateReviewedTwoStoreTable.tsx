import type { BasketTraceLine } from '../../domain/basket.ts'
import { compareFullBaskets } from '../../domain/basketComparison.ts'
import { privateUnitPrice } from '../comparison/privateUnitPrice.ts'
import { freshReviewedBaskets, type PrivateReviewedBaskets } from '../comparison/privateReviewedBasketBridge.ts'

type Matched = Extract<BasketTraceLine, { status: 'matched' }>
type OwnStore = 'PLUS' | 'DekaMarkt'
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

/** Both sides are the exact SAME human-reviewed physical weekly demand.
 * No independent source authorization, live pricing or retail claim is implied.
 */
export function PrivateReviewedTwoStoreTable({ reviewed, search, onOpenComparison, onOpenList }: {
  reviewed: PrivateReviewedBaskets
  search: string
  onOpenComparison: () => void
  onOpenList: (store: OwnStore) => void
}) {
  const fresh = freshReviewedBaskets(reviewed, reviewed.planKey, Date.now())
  const plus = fresh?.stores.PLUS
  const deka = fresh?.stores.DekaMarkt
  const comparable = !!plus && !!deka &&
    Math.abs(plus.capturedMs - deka.capturedMs) <= 86_400_000 &&
    compareFullBaskets({ baseline: plus.basket, candidate: deka.basket }).claimable
  if (!comparable || !plus || !deka) {
    const missing = (['PLUS', 'DekaMarkt'] as const).filter(store => !fresh?.stores[store])
    const gap = !!plus && !!deka && Math.abs(plus.capturedMs - deka.capturedMs) > 86_400_000
    return <section className="private-reviewed-products__paired" aria-label="Winkelvergelijking van eigen artikelen">
      <h3>Vergelijk PLUS met DekaMarkt</h3>
      <div className="private-reviewed-products__source-coverage">
        {(['PLUS', 'DekaMarkt'] as const).map(shop => {
          const capture = fresh?.stores[shop]
          return <article key={shop}>
            <h4>{shop}</h4>
            {capture ? <>
              <strong>{money.format(capture.basket.totalCents / 100)}</strong>
              <small>{capture.basket.lines.length} oorspronkelijke, gecontroleerde SKU-regels</small>
              <time dateTime={capture.observedAt}>{capture.observedAt}</time>
              <button type="button" onClick={() => onOpenList(shop)}>
                Bekijk mijn {shop}-boodschappenlijst
              </button>
            </> : <>
              <strong>Prijs onbekend</strong>
              <small>Geen volledige, actuele en door jou gecontroleerde eigen opname.</small>
            </>}
          </article>
        })}
      </div>
      <p role="status">{gap
        ? 'Beide eigen winkelmandjes bestaan, maar de waarnemingen liggen meer dan 24 uur uiteen. Herzie de oudere opname; er is nog geen geldig prijsverschil.'
        : missing.length > 0
          ? missing.join(' en ') + ' heeft nog geen volledig bruikbare eigen prijsopname. Vul de brongegevens aan voordat Supa een prijsverschil toont.'
          : 'Het bestaande bronpaar is nog niet betrouwbaar vergelijkbaar voor hetzelfde fysieke weekmandje. Controleer de productkoppelingen opnieuw.'}</p>
      <button type="button" onClick={onOpenComparison}>Open bronimport en productmatching</button>
      <small>Geen kassagarantie of onafhankelijk bewezen besparing. Een onbekende prijs is niet nul.</small>
    </section>
  }
  const dekaById = new Map(deka.basket.lines.filter((line): line is Matched =>
    line.status === 'matched').map(line => [line.id, line]))
  const rows = plus.basket.lines.flatMap(line => {
    const alternate = dekaById.get(line.id)
    if (line.status !== 'matched' || !alternate) return []
    if (search && ![line.ingredientLabel, line.productId, line.productName,
      alternate.productId, alternate.productName].some(value =>
        value.toLocaleLowerCase('nl').includes(search))) return []
    return [{ plus: line, deka: alternate }]
  })
  const delta = deka.basket.totalCents - plus.basket.totalCents
  const cheapest: OwnStore = delta >= 0 ? 'PLUS' : 'DekaMarkt'
  const leader = delta === 0 ? 'Beide mandjes zijn even duur.'
    : (delta > 0 ? 'PLUS' : 'DekaMarkt') + ' is ' +
      money.format(Math.abs(delta) / 100) + ' goedkoper voor alle hele verpakkingen.'
  const product = (line: Matched, store: string) => <div className="private-reviewed-products__paired-option">
    <strong>{store}</strong>
    <span>{line.productName}</span>
    <small>Originele SKU {line.productId}</small>
    <span>{line.packs} × {line.pack.count} × {line.pack.amount} {line.pack.unit}</span>
    <small>{money.format(line.pricePerPackCents / 100)} per pak · {privateUnitPrice(line) ?? 'eenheidsprijs onbekend'}</small>
    <strong>{money.format(line.lineTotalCents / 100)} voor deze week</strong>
  </div>
  return <section className="private-reviewed-products__paired" aria-label="Mijn exacte twee-winkelprijsvergelijking">
    <h3>Zelfde weekmandje · twee winkels</h3>
    <p>PLUS: {money.format(plus.basket.totalCents / 100)} · DekaMarkt: {' '}
      {money.format(deka.basket.totalCents / 100)}</p>
    <strong role="status">{leader}</strong>
    <small>Jouw gecontroleerde PLUS-bron: {plus.observedAt}. DekaMarkt-bron: {deka.observedAt}.
      Geen kassagarantie of onafhankelijk bewezen besparing; oorspronkelijke producten en
      prijzen kunnen veranderen.</small>
    <div className="private-reviewed-products__paired-rows">
      {rows.map(({ plus: first, deka: second }) => <article key={first.id}>
        <h4>{first.ingredientLabel} · {first.requirement.amount} {first.requirement.unit}</h4>
        <div className="private-reviewed-products__paired-options">
          {product(first, 'PLUS')}{product(second, 'DekaMarkt')}
        </div>
        <p>{first.lineTotalCents === second.lineTotalCents
          ? 'Zelfde regelbedrag voor jouw hoeveelheid.'
          : (first.lineTotalCents < second.lineTotalCents ? 'PLUS' : 'DekaMarkt') + ' is ' +
            money.format(Math.abs(first.lineTotalCents - second.lineTotalCents) / 100) +
            ' voordeliger voor dit ingrediënt.'}</p>
      </article>)}
      {!rows.length && <p>Geen vergelijkbare artikelen passen bij je zoekopdracht.</p>}
    </div>
    <button type="button" onClick={() => onOpenList(cheapest)}>Open het goedkoopste volledige winkelmandje ({cheapest}) in Lijst</button>
  </section>
}
