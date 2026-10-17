import { useMemo, useState } from 'react'
import type { ManualLine } from '../../domain/manualStoreComparison.ts'
import type { PlannedMeal } from '../../domain/types.ts'
import { aggregatePlanIngredients, type RecipeWithIngredients } from '../../domain/basket.ts'
import {
  MANUAL_RETAILERS,
  calculateManualComparison,
  manualCompatibleUnits,
  manualQuoteKey,
  type ManualEntries,
  type ManualNeed,
  type ManualQuote,
  type ManualRetailer,
} from '../../domain/manualStoreComparison.ts'
import './manualStoreComparison.css'

const euros = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })
const UNIT_LABEL: Record<string, string> = {
  g: 'gram', kg: 'kg', ml: 'ml', l: 'liter', piece: 'stuks',
}
const tableHeader = 'ingredientId\twinkel\tproduct\tverpakking\teenheid\tprijs'
function safeTableCell(value: string) {
  return value.replace(/[\t\r\n]/gu, ' ').replace(/^[\s\uFEFF]*[=+@-]/u, "'")
}
function tabularData(needs: readonly ManualNeed[], entries: ManualEntries): string {
  return [
    tableHeader,
    ...needs.flatMap(need => MANUAL_RETAILERS.map(store => {
      const quote = entries[manualQuoteKey(store, need.ingredientId)]
      return [
        safeTableCell(need.id), store,
        safeTableCell(quote?.product ?? ''),
        safeTableCell(quote?.packAmount ?? ''),
        quote?.packUnit ?? need.unit,
        safeTableCell(quote?.price ?? ''),
      ].join('\t')
    })),
  ].join('\n')
}
function readPastedTable(text: string, needs: readonly ManualNeed[]): ManualEntries {
  const lines = text.trimEnd().replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== tableHeader || lines.length !== 1 + needs.length * 2) {
    throw new Error('De tabel heeft niet alle PLUS- en DekaMarkt-regels.')
  }
  const expected = new Map(needs.map(need => [need.id, need]))
  const entries: ManualEntries = Object.create(null) as ManualEntries
  const used = new Set<string>()
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    if (cells.length !== 6) throw new Error('Gebruik zes tabgescheiden kolommen.')
    const [id, shop, product, packAmount, unit, price] = cells
    if (!expected.has(id) || (shop !== 'PLUS' && shop !== 'DekaMarkt') ||
        !manualCompatibleUnits(expected.get(id)!.unit).includes(unit as ManualQuote['packUnit']) ||
        product.length > 160 || packAmount.length > 32 || price.length > 20) {
      throw new Error('De tabel bevat een onbekend product, winkel of eenheid.')
    }
    const key = manualQuoteKey(shop as ManualRetailer, id)
    if (used.has(key)) throw new Error('Dubbele productregel voor een winkel.')
    used.add(key)
    entries[key] = { product, packAmount, packUnit: unit as ManualQuote['packUnit'], price }
  }
  return entries
}

export function ManualStoreComparison({
  plan, recipes, activeDays,
}: {
  plan: PlannedMeal[]
  recipes: RecipeWithIngredients[]
  activeDays: string[]
}) {
  const needs = useMemo(() => {
    try { return aggregatePlanIngredients(plan, recipes, activeDays) }
    catch { return [] }
  }, [plan, recipes, activeDays])
  const [entries, setEntries] = useState<ManualEntries>({})
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [showTable, setShowTable] = useState(false)
  const summary = useMemo(() => {
    try { return needs.length ? calculateManualComparison(needs, entries) : null }
    catch { return null }
  }, [needs, entries])

  function setQuote(need: ManualLine, store: ManualRetailer, field: keyof ManualQuote, value: string) {
    const key = manualQuoteKey(store, need.id)
    setEntries(previous => {
      const quote = previous[key] ?? {
        product: '', packAmount: '', packUnit: need.requiredUnit, price: '',
      }
      return { ...previous, [key]: { ...quote, [field]: value } }
    })
  }
  function applyTable() {
    try {
      const imported = readPastedTable(importText, needs)
      setEntries(imported)
      setShowTable(false)
      setImportText('')
      setImportMessage('Tabel geladen op dit apparaat; controleer de berekende verpakkingenaantallen.')
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Tabel niet herkend.')
    }
  }
  const header = 'Eigen winkelprijzen vergelijken'
  return (
    <section className="manual-compare" aria-label={header}>
      <div className="manual-compare__heading">
        <span className="eyebrow">Jouw weekplanning · zelf ingevoerde prijzen</span>
        <h2>{header}</h2>
        <p>
          Vergelijk exact dezelfde geplande ingrediënten bij PLUS en DekaMarkt.
          Vul per winkel het <strong>gekozen product, de verpakkingsgrootte en de prijs</strong> in.
          Supa berekent hoeveel hele verpakkingen nodig zijn; er worden geen winkelprijzen verzonnen of opgehaald.
        </p>
        <p className="manual-compare__notice">
          Alleen privéberekening op basis van jouw invoer. Geen geverifieerde winkelprijzen,
          voorraad, productgelijkheid of bewezen besparing. Invoer wordt niet naar een server verzonden.
          Zonder volledige gegevens voor beide winkels tonen we geen totaal of prijsverschil.
        </p>
      </div>

      {!summary ? (
        <p role="status" className="attention-card">
          Kies eerst geldige maaltijden in je planner. Dan verschijnen hier de benodigde ingrediënten.
        </p>
      ) : (
        <>
          <div className="manual-compare__summary" role="status" aria-live="polite">
            <p><strong>{summary.complete} van {needs.length * 2}</strong> winkelregels ingevuld</p>
            <p>{summary.missing} ontbrekend · {summary.invalid} ongeldig of onvolledig</p>
            <div className="manual-compare__totals">
              {MANUAL_RETAILERS.map(shop => (
                <div key={shop}><span>{shop}</span><strong>
                  {summary.totals[shop] === null ? 'Nog niet compleet' : euros.format(summary.totals[shop]! / 100)}
                </strong></div>
              ))}
            </div>
            {summary.fullBasket && summary.deltaCents !== null ? (
              <p>
                {summary.cheaper === null
                  ? 'De door jou ingevulde volledige mandjes zijn even duur.'
                  : `Op basis van jouw ingevoerde producten is ${summary.cheaper} ${euros.format(Math.abs(summary.deltaCents) / 100)} goedkoper voor deze week.`}
                {' '}Dit is geen gecontroleerd besparingsbewijs.
              </p>
            ) : (
              <p>Vul alle regels voor beide winkels in om pas daarna een betrouwbaar <em>rekenkundig</em> prijsverschil te zien.</p>
            )}
          </div>
          <div className="manual-compare__actions">
            <button className="ghost-button" type="button" onClick={() => setShowTable(value => !value)}>
              {showTable ? 'Verberg Excel-tabel' : 'Tabel kopiëren of importeren'}
            </button>
            <button className="ghost-button" type="button" onClick={() => {
              setEntries({})
              setImportText('')
              setImportMessage('Alle handmatig ingevoerde prijzen zijn gewist.')
            }}>Wis prijzen</button>
          </div>
          {showTable && (
            <div className="manual-compare__table">
              <p>Kopieer de eerste tabel naar Excel of een spreadsheet, vul product, verpakking en prijs in en plak de volledige tabel terug. Gebruik tabgescheiden kolommen; eenheden en ingrediënten moeten overeenkomen.</p>
              <label>Huidige tabel
                <textarea readOnly rows={7} value={tabularData(needs, entries)}
                  onFocus={event => event.currentTarget.select()} />
              </label>
              <label>Ingevulde tabel terugplakken
                <textarea rows={7} value={importText}
                  onChange={event => setImportText(event.target.value)}
                  placeholder="Plak hier de complete tabgescheiden tabel." />
              </label>
              <button className="ghost-button" type="button" onClick={applyTable}>Tabel laden</button>
            </div>
          )}
          <p className="manual-compare__message" role="status">{importMessage}</p>
          <div className="manual-compare__rows">
            {summary.rows.map(row => (
              <article className="manual-compare__row" key={row.ingredientId}>
                <header>
                  <h3>{row.label}</h3>
                  <span>Benodigd: {row.requiredAmount ?? '?'} {UNIT_LABEL[row.requiredUnit] ?? row.requiredUnit}</span>
                </header>
                <div className="manual-compare__pair">
                  {MANUAL_RETAILERS.map(shop => {
                    const quote = entries[manualQuoteKey(shop, row.ingredientId)]
                    const state = row.quotes[shop]
                    return (
                      <fieldset key={shop} className="manual-compare__store">
                        <legend>{shop}</legend>
                        <label>Gekozen product
                          <input type="text" maxLength={160} autoComplete="off"
                            value={quote?.product ?? ''} placeholder="Naam op het prijskaartje"
                            onChange={event => setQuote(row, shop, 'product', event.target.value)} />
                        </label>
                        <div className="manual-compare__fields">
                          <label>Inhoud per verpakking
                            <input type="text" inputMode="decimal" maxLength={32} placeholder="bijv. 500"
                              value={quote?.packAmount ?? ''}
                              onChange={event => setQuote(row, shop, 'packAmount', event.target.value)} />
                          </label>
                          <label>Eenheid
                            <select value={quote?.packUnit ?? row.requiredUnit}
                              onChange={event => setQuote(row, shop, 'packUnit', event.target.value)}>
                              {manualCompatibleUnits(row.requiredUnit).map(unit => (
                                <option key={unit} value={unit}>{UNIT_LABEL[unit]}</option>
                              ))}
                            </select>
                          </label>
                          <label>Prijs per verpakking (€)
                            <input type="text" inputMode="decimal" maxLength={20} placeholder="bijv. 1,79"
                              value={quote?.price ?? ''}
                              onChange={event => setQuote(row, shop, 'price', event.target.value)} />
                          </label>
                        </div>
                        <p className="manual-compare__row-result" aria-live="polite">
                          {state.state === 'complete'
                            ? `${state.packs} × verpakking = ${euros.format(state.lineCents! / 100)}`
                            : state.state === 'invalid'
                              ? 'Controleer product, verpakking, eenheid en prijs.'
                              : 'Nog geen prijsberekening.'}
                          {state.state === 'complete' && state.unitPriceCents !== null &&
                            ` · ${euros.format(state.unitPriceCents / 100)} per ${row.requiredUnit === 'g' || row.requiredUnit === 'kg' ? 'kg' : 'liter'}`}
                        </p>
                      </fieldset>
                    )
                  })}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
