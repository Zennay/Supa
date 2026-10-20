import { euro as exactEuro } from '../../lib/money.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { manualTripCoverage, privateManualShoppingTripText } from './privateManualShoppingTrip.ts'
import { privateManualPartialComparisonText } from './privateManualPartialComparison.ts'
import { readPrivateManualSession, savePrivateManualSession, clearPrivateManualSession } from './privateManualCompareSession.ts'
import './manualStoreComparison.css'

const UNIT_LABEL: Record<string, string> = {
  g: 'gram', kg: 'kg', ml: 'ml', l: 'liter', piece: 'stuks',
}
const tableHeader = 'ingredientId\twinkel\tproduct\tverpakking\teenheid\tmultipackAantal\tprijs'
const legacyTableHeader = 'ingredientId\twinkel\tproduct\tverpakking\teenheid\tprijs'
const boundTableHeader = 'ingredientId\twinkel\tbenodigdAantal\tbenodigdEenheid\tproduct\tverpakking\teenheid\tmultipackAantal\tprijs'
function safeTableCell(value: string) {
  // The plain TSV route must guard the same invisible-prefix and NFKC
  // spreadsheet formula cases as the existing private CSV exports.
  const flat = value.replace(/[\t\r\n]/gu, ' ')
  const formula = /^[\p{White_Space}\p{Cf}\p{Mn}\p{Mc}\p{Me}]*[=+@-]/u
  return formula.test(flat.normalize('NFKC')) ? "'" + flat : flat
}
function tabularData(
  needs: readonly ManualNeed[], entries: ManualEntries, stores: readonly ManualRetailer[] = MANUAL_RETAILERS,
): string {
  return [
    boundTableHeader,
    ...needs.flatMap(need => stores.map(store => {
      const quote = entries[manualQuoteKey(store, need.id)]
      return [
        safeTableCell(need.id), store,
        need.amount === null ? '' : String(need.amount), need.unit,
        safeTableCell(quote?.product ?? ''),
        safeTableCell(quote?.packAmount ?? ''),
        quote?.packUnit ?? '',
        safeTableCell(quote?.packCount ?? ''),
        safeTableCell(quote?.price ?? ''),
      ].join('\t')
    })),
  ].join('\n')
}
function readPastedTable(text: string, needs: readonly ManualNeed[]): {
  entries: ManualEntries; legacyWithoutPackCount: boolean; boundToDemand: boolean
  partialStore: ManualRetailer | null
} {
  // Bound pasted content like a local file before splitting it into cells.
  // Excel and other spreadsheets may prefix a valid UTF-8 TSV with a BOM.
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 128000) {
    throw new Error('Het invulblad is te groot (maximaal 128 kB).')
  }
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const lines = normalized.replace(/\n+$/u, '').split('\n')
  const legacyWithoutPackCount = lines[0] === legacyTableHeader
  const boundToDemand = lines[0] === boundTableHeader
  const fullSheet = lines.length === 1 + needs.length * 2
  // A sparse single-store sheet may contain only the products already
  // physically found. Remaining Planner ingredients remain unpriced.
  const partialSheet = boundToDemand && lines.length >= 2 &&
    lines.length <= 1 + needs.length
  if ((!legacyWithoutPackCount && !boundToDemand && lines[0] !== tableHeader) ||
      (!fullSheet && !partialSheet)) {
    throw new Error('Gebruik een volledig PLUS/Deka-blad of een negenkoloms deelblad voor één winkel met minstens één productregel.')
  }
  const expected = new Map(needs.map(need => [need.id, need]))
  const entries: ManualEntries = Object.create(null) as ManualEntries
  const used = new Set<string>()
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    if (cells.length !== (boundToDemand ? 9 : legacyWithoutPackCount ? 6 : 7)) {
      throw new Error('Gebruik uitsluitend de oorspronkelijke Supa-kolommen; geen regels samenvoegen.')
    }
    // Older six-column Supa exports had no multi-pack observation.
    // Restore their actual product, unit and price, but NEVER infer count=1.
    const [id, shop, product, packAmount, unit, packCount, price] = boundToDemand
      ? [cells[0], cells[1], cells[4], cells[5], cells[6], cells[7], cells[8]]
      : legacyWithoutPackCount
        ? [cells[0], cells[1], cells[2], cells[3], cells[4], '', cells[5]]
        : cells
    if (boundToDemand && (
      !expected.has(id) ||
      cells[2] !== (expected.get(id)!.amount === null ? '' : String(expected.get(id)!.amount)) ||
      cells[3] !== expected.get(id)!.unit
    )) {
      throw new Error('Planner-behoefte of eenheid is gewijzigd sinds dit invulblad. Exporteer een nieuw blad.')
    }
    if (!expected.has(id) || (shop !== 'PLUS' && shop !== 'DekaMarkt') ||
        (unit !== '' && !manualCompatibleUnits(expected.get(id)!.unit).includes(unit as Exclude<ManualQuote['packUnit'], ''>)) ||
        product.length > 160 || packAmount.length > 32 || price.length > 20 ||
        (packCount !== '' && !/^(?:[1-9]\d{0,2}|1000)$/.test(packCount))) {
      throw new Error('De tabel bevat een onbekend product, winkel of eenheid.')
    }
    const key = manualQuoteKey(shop as ManualRetailer, id)
    if (used.has(key)) throw new Error('Dubbele productregel voor een winkel.')
    used.add(key)
    entries[key] = { product, packAmount, packUnit: unit as ManualQuote['packUnit'], packCount, price }
  }
  const stores = new Set(Object.keys(entries).map(key => JSON.parse(key)[0] as ManualRetailer))
  if (partialSheet && stores.size !== 1) {
    throw new Error('Een los winkelblad mag maar één winkel bevatten; geen PLUS/Deka-regels mengen.')
  }
  return { entries, legacyWithoutPackCount, boundToDemand,
    partialStore: partialSheet ? [...stores][0] : null }
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
  // Keep unsaved work when the user switches between Planner and Vergelijk.
  // This is RAM only, scoped to this browser tab; no device storage consent is implied.
  const [initialSession] = useState(readPrivateManualSession)
  const [entries, setEntries] = useState<ManualEntries>(() => initialSession?.entries ?? {})
  const [entriesDemandSignature, setEntriesDemandSignature] = useState<string | null>(
    () => initialSession?.demandSignature ?? null,
  )
  const [recordedNeeds, setRecordedNeeds] = useState<readonly ManualNeed[]>(
    () => initialSession?.recordedNeeds ?? [],
  )
  useEffect(() => {
    if (Object.keys(entries).length === 0) {
      clearPrivateManualSession()
    } else {
      savePrivateManualSession({ entries, demandSignature: entriesDemandSignature, recordedNeeds })
    }
  }, [entries, entriesDemandSignature, recordedNeeds])
  const [importText, setImportText] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [showTable, setShowTable] = useState(false)
  const editRevision = useRef(0)
  const latestDemand = useRef(needs)
  latestDemand.current = needs
  const currentDemandSignature = JSON.stringify(
    needs.map(need => [need.id, need.label, need.amount, need.unit]),
  )
  const staleEntries = Object.keys(entries).length > 0 &&
    entriesDemandSignature !== null && entriesDemandSignature !== currentDemandSignature
  const activeEntries: ManualEntries = staleEntries ? {} : entries
  const summary = useMemo(() => {
    try { return needs.length ? calculateManualComparison(needs, activeEntries) : null }
    catch { return null }
  }, [needs, activeEntries])
  const tripCoverage = useMemo(() => summary ? manualTripCoverage(summary) : [], [summary])

  function setQuote(need: ManualLine, store: ManualRetailer, field: keyof ManualQuote, value: string) {
    if (staleEntries) {
      setImportMessage('De Planner is veranderd. Bewaar eerst je oude invulblad en begin daarna opnieuw.')
      return
    }
    setEntriesDemandSignature(currentDemandSignature)
    setRecordedNeeds(needs.map(row => ({ ...row })))
    const key = manualQuoteKey(store, need.ingredientId)
    editRevision.current += 1
    setEntries(previous => {
      const quote = previous[key] ?? {
        product: '', packAmount: '', packUnit: '', packCount: '', price: '',
      }
      return { ...previous, [key]: { ...quote, [field]: value } }
    })
  }
  // Portable personal report from this complete current calculation only.
  // This is a standalone unverified calculator, not a retailer receipt,
  // canonical source import or basis for public savings claims.
  function downloadMyCalculatedComparison() {
    if (!summary?.fullBasket || summary.deltaCents === null ||
        summary.totals.PLUS === null || summary.totals.DekaMarkt === null) return
    try {
      const clean = (text: string): string =>
        text.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ').trim().slice(0, 160)
      const rows = [
        'SUPA · alleen mijn eigen handmatig berekende twee-winkelmandje',
        'NIET onafhankelijk geverifieerd: geen bronrechten, originele SKU, opnamebewijs of besparingsclaim.',
        'Dezelfde Planner-vraag, maar productgelijkwaardigheid en gedeelde SKU-verpakkingen zijn onbekend.',
        '',
      ]
      for (const row of summary.rows) {
        const plus = row.quotes.PLUS
        const deka = row.quotes.DekaMarkt
        if (plus.state !== 'complete' || deka.state !== 'complete' ||
            plus.lineCents === null || deka.lineCents === null)
          throw new Error('Eén of meer prijsregels zijn veranderd. Controleer de volledige mandjes.')
        rows.push(clean(row.label) + ' · benodigd ' + row.requiredAmount + ' ' + row.requiredUnit)
        for (const store of MANUAL_RETAILERS) {
          const quote = entries[manualQuoteKey(store, row.ingredientId)]
          const line = row.quotes[store]
          if (!quote || !line.packs || line.lineCents === null || !quote.packCount)
            throw new Error('Het ingevoerde product of multipack is niet compleet.')
          rows.push(store + ': ' + clean(quote.product) + ' · ' + line.packs +
            ' hele multipack(s), elk ' + quote.packCount + ' × ' + quote.packAmount +
            ' ' + quote.packUnit + ' · ' + exactEuro.formatCents(line.lineCents))
        }
        rows.push('Rekenkundig regelverschil (Deka minus PLUS): ' +
          exactEuro.formatCents(deka.lineCents - plus.lineCents))
        if (plus.unitPriceCents !== null && deka.unitPriceCents !== null) {
          const unitLabel = row.requiredUnit === 'piece' ? 'stuk' :
            row.requiredUnit === 'g' || row.requiredUnit === 'kg' ? 'kg' : 'liter'
          rows.push('Afgeronde eenheidsprijzen per ' + unitLabel + ': PLUS ' +
            exactEuro.formatCents(plus.unitPriceCents) + ' / DekaMarkt ' +
            exactEuro.formatCents(deka.unitPriceCents) +
            '; verschil (Deka minus PLUS): ' +
            exactEuro.formatCents(deka.unitPriceCents - plus.unitPriceCents))
        } else {
          rows.push('Eenheidsprijs: onbekend (geen schatting).')
        }
        rows.push('Mandkosten volgen uitsluitend de werkelijk te kopen hele multipacks.', '')
      }
      rows.push('PLUS eigen ingevuld totaal: ' + exactEuro.formatCents(summary.totals.PLUS),
        'DekaMarkt eigen ingevuld totaal: ' + exactEuro.formatCents(summary.totals.DekaMarkt),
        'Rekenkundig mandverschil (Deka minus PLUS): ' + exactEuro.formatCents(
          summary.totals.DekaMarkt - summary.totals.PLUS),
        '', 'Alleen op dit apparaat gemaakt. Controleer echte winkelproductgelijkheid en bronmomenten apart.')
      const content = rows.join('\\n') + '\\n'
      if (new TextEncoder().encode(content).length > 128000)
        throw new Error('De persoonlijke berekening is te groot om lokaal te exporteren.')
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-ongeverifieerde-plus-deka-vergelijking.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setImportMessage('Volledige persoonlijke rekenvergelijking lokaal bewaard. Geen onafhankelijk geverifieerde winkelprijzen.')
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message :
        'Kon de persoonlijke winkelvergelijking niet lokaal bewaren.')
    }
  }
  function downloadPartialComparison() {
    if (!summary || staleEntries) return
    try {
      const content = privateManualPartialComparisonText(summary, entries)
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-mijn-gedeeltelijke-plus-deka-vergelijking.txt'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setImportMessage('Eigen gedeeltelijke PLUS/Deka-regelvergelijking bewaard. Ontbrekende prijzen blijven onbekend.')
    } catch {
      setImportMessage('Kon de gedeeltelijke privévergelijking niet bewaren.')
    }
  }
  function downloadOwnStoreTrip(store: ManualRetailer) {
    if (!summary) return
    try {
      const content = privateManualShoppingTripText(summary, entries, store)
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = `supa-mijn-ongeverifieerde-${store === 'PLUS' ? 'plus' : 'dekamarkt'}-boodschappen.txt`
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setImportMessage(`${store}-boodschappenlijst lokaal bewaard inclusief ontbrekende prijzen. Geen compleet mandtotaal.`)
    } catch {
      setImportMessage('De persoonlijke boodschappenlijst kon niet worden opgeslagen; controleer de huidige invoer.')
    }
  }
  function downloadTableFile(store?: ManualRetailer, onlyEntered = false) {
    if (!(staleEntries ? recordedNeeds : needs).length) return
    try {
      const sourceNeeds = staleEntries ? recordedNeeds : needs
      const includedNeeds = store && onlyEntered ? sourceNeeds.filter(need => {
        const row = entries[manualQuoteKey(store, need.id)]
        return !!row && (row.product.trim() !== '' || row.packAmount.trim() !== '' ||
          row.packUnit !== '' || (row.packCount ?? '').trim() !== '' || row.price.trim() !== '')
      }) : sourceNeeds
      if (!includedNeeds.length) {
        setImportMessage(`Nog geen ingevulde ${store ?? 'winkel'}-regels om als deelblad te bewaren.`)
        return
      }
      const content = tabularData(includedNeeds, entries, store ? [store] : MANUAL_RETAILERS) + '\n'
      if (new TextEncoder().encode(content).length > 128000) {
        setImportMessage('Het huidige invulblad is te groot om lokaal te bewaren.')
        return
      }
      const url = URL.createObjectURL(new Blob([content], {
        type: 'text/tab-separated-values;charset=utf-8',
      }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = store ? `supa-mijn-${store === 'PLUS' ? 'plus' : 'dekamarkt'}-${onlyEntered ? 'deelblad' : 'invulblad'}.tsv` : 'supa-mijn-plus-deka-invulblad.tsv'
        document.body.append(link)
        try { link.click() } finally { link.remove() }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setImportMessage('Eigen invulblad lokaal bewaard, ook als prijzen nog ontbreken. Geen geverifieerde brondata.')
    } catch {
      setImportMessage('Kon het eigen invulblad niet lokaal bewaren.')
    }
  }
  function restoreTable(text: string) {
    try {
      const imported = readPastedTable(text, needs)
      if (!imported.boundToDemand &&
          !window.confirm('Dit oudere Supa-blad bevat geen exacte Planner-hoeveelheden. Controleer of het bij de huidige week hoort. Toch laden?')) {
        setImportMessage('Oud invulblad niet geladen; huidige invoer behouden.')
        return
      }
      // A sparse one-store sheet changes only its present ingredient rows,
      // never an unobserved item and never another shop. Different Planner
      // demand still quarantines both previously entered shops.
      const nextEntries: ManualEntries = imported.partialStore
        ? { ...(staleEntries ? {} : entries), ...imported.entries }
        : imported.entries
      const replacedExisting = Object.entries(imported.entries).some(([key, value]) =>
        entries[key] && JSON.stringify(entries[key]) !== JSON.stringify(value))
      if ((staleEntries || replacedExisting) &&
          !window.confirm(imported.partialStore
            ? `Het eigen ${imported.partialStore}-blad wordt ingelezen. ${staleEntries
                ? 'Alle prijzen van de vorige Planner-week vervallen.'
                : 'Alleen deze winkel wordt vervangen; de andere winkel blijft behouden.'} Doorgaan?`
            : 'Dit invulblad vervangt bestaande PLUS- en DekaMarkt-invoer. Doorgaan?')) {
        setImportMessage('Annuleren: je eerdere winkelproductinvoer is ongewijzigd.')
        return
      }
      editRevision.current += 1
      setEntries(nextEntries)
      setEntriesDemandSignature(currentDemandSignature)
      setRecordedNeeds(needs.map(row => ({ ...row })))
      setShowTable(false)
      setImportText('')
      setImportMessage(imported.legacyWithoutPackCount
        ? 'Oude zeskoloms Supa-tabel geladen. Producten, eenheden en prijzen zijn bewaard. ' +
          'Controleer opnieuw of de oude hoeveelheid de inhoud per eenheid of de totale multipack inhield. ' +
          'Vul bij iedere winkelregel het echte multipack-aantal in; pas daarna ' +
          'kan een volledig rekenkundig mandverschil verschijnen.'
        : imported.boundToDemand
          ? imported.partialStore
            ? `${imported.partialStore} voor de huidige Planner geladen. ${staleEntries ? 'Vorige Planner-prijzen vervallen.' : 'Andere winkel behouden.'} Controleer de eigen prijzen.`
            : 'Invulblad voor exact deze Planner-vraag geladen; controleer de eigen product- en winkelprijzen.'
          : 'Oud zevenkolomsblad geladen zonder Planner-behoeftecontrole. Controleer de actuele week en winkelprijzen.')
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Tabel niet herkend.')
    }
  }
  function applyTable() { restoreTable(importText) }
  async function loadTableFile(file: File) {
    const revision = editRevision.current
    const originalDemand = needs
    if (!/\.(?:tsv|txt)$/iu.test(file.name) || file.size <= 0 || file.size > 128000) {
      setImportMessage('Kies een lokaal .tsv- of .txt-invulblad van maximaal 128 kB.')
      return
    }
    try {
      const contents = await file.text()
      if (revision !== editRevision.current || originalDemand !== latestDemand.current) {
        setImportMessage('Planner of winkelinvoer is intussen gewijzigd. Kies het bestand opnieuw; niets vervangen.')
        return
      }
      restoreTable(contents)
    } catch {
      setImportMessage('Kon dit lokale invulblad niet lezen; bestaande invoer behouden.')
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
          Vul per winkel het <strong>gekozen product, de inhoud per eenheid, het aantal eenheden in de multipack en de prijs van de hele multipack</strong> in.
          Supa berekent hoeveel hele multipacks nodig zijn; er worden geen winkelprijzen verzonnen of opgehaald.
          Verschillende ingrediënten kunnen dezelfde echte winkel-SKU delen, maar deze losse rekenhulp kent geen
          geverifieerde SKU-identiteiten en kan gedeelde verpakkingen dus niet samenvoegen. Gebruik de eigen
          bronimport hierboven voor het volledige fysieke mandje.
        </p>
        <p className="manual-compare__notice">
          Alleen privéberekening op basis van jouw invoer. Geen geverifieerde winkelprijzen,
          voorraad, productgelijkheid of bewezen besparing. Invoer wordt niet naar een server verzonden.
          Zonder volledige gegevens voor beide winkels tonen we geen totaal of prijsverschil.
          Conceptinvoer blijft tijdelijk in het geheugen van dit tabblad tijdens navigeren;
          sluit je het tabblad, dan is die invoer weg tenzij je zelf een TSV-bestand downloadt.
        </p>
      </div>

          {staleEntries && (
            <div className="manual-compare__notice" role="alert">
              <strong>Je Planner-behoefte is veranderd.</strong> Oude eigen winkelprijzen en
              hele-verpakkingsberekeningen tellen niet meer mee. Bewaar het oorspronkelijke
              invulblad, of bevestig dat je opnieuw wilt beginnen voor deze Planner-week.
              <div className="manual-compare__actions">
                <button type="button" className="ghost-button" onClick={() => downloadTableFile()}>
                  Bewaar vorige invoer als oorspronkelijk invulblad (.tsv)
                </button>
                <button type="button" className="ghost-button" onClick={() => {
                  if (!window.confirm('De vorige winkelproducten en prijzen worden uit deze rekenhulp verwijderd. Nieuw beginnen?')) return
                  editRevision.current += 1
                  setEntries({})
                  setEntriesDemandSignature(null)
                  setRecordedNeeds([])
                  setImportText('')
                  setImportMessage('Oude eigen prijzen vrijgegeven; voer nieuwe Planner-prijzen in.')
                }}>Wis oude prijzen en begin opnieuw</button>
              </div>
            </div>
          )}
      {!summary ? (
        <p role="status" className="attention-card">
          Kies eerst geldige maaltijden in je planner. Dan verschijnen hier de benodigde ingrediënten.
          Eventuele oude eigen winkelinvoer blijft alleen in dit browsertabblad beschikbaar tot je deze wist.
        </p>
      ) : (
        <>
          <div className="manual-compare__summary" role="status" aria-live="polite">
            <p><strong>{summary.complete} van {needs.length * 2}</strong> winkelregels ingevuld</p>
            <p>{summary.missing} ontbrekend · {summary.invalid} ongeldig of onvolledig</p>
            <div className="manual-compare__coverage" aria-label="Eigen bronprijsdekking per winkel">
              {tripCoverage.map(coverage => (
                <p key={coverage.store}><strong>{coverage.store}:</strong>{' '}
                  {coverage.known}/{needs.length} regels met eigen ingevulde prijzen;{' '}
                  {coverage.unresolved} nog controleren.{' '}
                  {coverage.known > 0 && <>Deelbedrag bekende regels: {' '}
                    {exactEuro.formatCents(coverage.knownSubtotalCents)} (geen mandtotaal).</>}
                </p>
              ))}
            </div>
            <div className="manual-compare__totals">
              {MANUAL_RETAILERS.map(shop => (
                <div key={shop}><span>{shop}</span><strong>
                  {(() => {
                    const storeCoverage = tripCoverage.find(value => value.store === shop)
                    return storeCoverage && storeCoverage.unresolved === 0 && storeCoverage.known === needs.length
                      ? exactEuro.formatCents(storeCoverage.knownSubtotalCents)
                      : 'Nog niet compleet'
                  })()}
                </strong>
                <small>{tripCoverage.find(value => value.store === shop)?.unresolved === 0
                  ? 'Volledig zelf berekend; winkelprijzen/producten niet gecontroleerd.'
                  : 'Onbekende producten ontbreken in het totaal.'}</small></div>
              ))}
            </div>
            {summary.fullBasket && summary.deltaCents !== null ? (
              <p>
                {summary.cheaper === null
                  ? 'De door jou ingevulde volledige mandjes zijn even duur.'
                  : `Op basis van jouw ingevoerde producten is ${summary.cheaper} ${exactEuro.formatCents(Math.abs(summary.deltaCents))} goedkoper voor deze week.`}
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
            <button className="ghost-button" type="button"
              disabled={!summary.fullBasket}
              onClick={downloadMyCalculatedComparison}>
              Download mijn complete berekening (TXT)
            </button>
            <button className="ghost-button" type="button" disabled={staleEntries}
              onClick={downloadPartialComparison}>
              Download gedeeltelijke PLUS/Deka-vergelijking (TXT, ook met ontbrekende prijzen)
            </button>
            {MANUAL_RETAILERS.map(store => (
              <button className="ghost-button" type="button" key={store}
                disabled={staleEntries}
                onClick={() => downloadOwnStoreTrip(store)}>
                {store}: eigen boodschappen + ontbrekende prijzen (TXT)
              </button>
            ))}
            <button className="ghost-button" type="button" onClick={() => {
              editRevision.current += 1
              setEntries({})
              setEntriesDemandSignature(null)
              setRecordedNeeds([])
              setImportText('')
              setImportMessage('Alle handmatig ingevoerde prijzen zijn gewist.')
            }}>Wis prijzen</button>
          </div>
          {showTable && (
            <div className="manual-compare__table">
              <p>Dit negenkolomsinvulblad bewaart ook de originele hoeveelheid en eenheid per Planner-ingrediënt. Wijzig die twee kolommen niet: Supa weigert oude bladen voor een andere Planner-vraag. Vul uitsluitend winkelproduct, verpakking, multipack en eigen prijs in. Plak of laad daarna het volledige of één los PLUS/Deka-blad terug. Een enkel winkelblad vult uitsluitend de opgegeven ingrediënten voor die winkel in; ontbrekende regels blijven ongewijzigd en onbekende prijzen worden niet geschat. Oude zes- en zevenkolomsbladen vragen een extra controle, omdat ze niet aan een Planner-hoeveelheid zijn gebonden.</p>
              <label>Huidige tabel
                <textarea readOnly rows={7} value={tabularData(staleEntries ? recordedNeeds : needs, entries)}
                  onFocus={event => event.currentTarget.select()} />
              </label>
              <label>Ingevulde tabel terugplakken
                <textarea rows={7} value={importText}
                  onChange={event => setImportText(event.target.value)}
                  placeholder="Plak hier de complete tabgescheiden tabel." />
              </label>
              <button className="ghost-button" type="button" onClick={applyTable}>Geplakte tabel laden</button>
              <button className="ghost-button" type="button" onClick={() => downloadTableFile()}>
                Bewaar beide winkels (.tsv), ook onvolledig
              </button>
              {MANUAL_RETAILERS.map(store => (
                <div className="manual-compare__store-actions" key={store}>
                  <button className="ghost-button" type="button"
                    onClick={() => downloadTableFile(store)}>
                    Bewaar {store} met alle regels (.tsv)
                  </button>
                  <button className="ghost-button" type="button"
                    onClick={() => downloadTableFile(store, true)}>
                    Bewaar alleen ingevulde {store}-regels (.tsv)
                  </button>
                </div>
              ))}
              <label>Of kies eerder bewaard lokaal invulblad (.tsv of .txt, maximaal 128 kB)
                <input type="file" accept=".tsv,.txt,text/tab-separated-values,text/plain"
                  onChange={event => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) void loadTableFile(file)
                  }} />
              </label>
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
                    const quote = activeEntries[manualQuoteKey(shop, row.ingredientId)]
                    const state = row.quotes[shop]
                    return (
                      <fieldset key={shop} className="manual-compare__store" disabled={staleEntries}>
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
                          <label>Werkelijke verpakkingseenheid
                            <select value={quote?.packUnit ?? ''}
                              onChange={event => setQuote(row, shop, 'packUnit', event.target.value)}>
                              <option value="">Selecteer eenheid uit het winkelproduct</option>
                              {manualCompatibleUnits(row.requiredUnit).map(unit => (
                                <option key={unit} value={unit}>{UNIT_LABEL[unit]}</option>
                              ))}
                            </select>
                          </label>
                          <label>Eenheden per geprijsde multipack
                            <input type="number" inputMode="numeric" min="1" max="1000" step="1"
                              placeholder="Bijv. 3 voor 3 × 200 g"
                              value={quote?.packCount ?? ''}
                              onChange={event => setQuote(row, shop, 'packCount', event.target.value)} />
                          </label>
                          <label>Prijs voor de hele multipack (€)
                            <input type="text" inputMode="decimal" maxLength={20} placeholder="bijv. 1,79"
                              value={quote?.price ?? ''}
                              onChange={event => setQuote(row, shop, 'price', event.target.value)} />
                          </label>
                        </div>
                        <p className="manual-compare__row-result" aria-live="polite">
                          {state.state === 'complete'
                            ? `${state.packs} hele multipack(s) nodig · per multipack ${quote?.packCount} × ` +
                              `${quote?.packAmount} ${UNIT_LABEL[quote?.packUnit ?? ''] ?? quote?.packUnit} ` +
                              `· te kopen totaal ${exactEuro.formatCents(state.lineCents!)}`
                            : state.state === 'invalid'
                              ? 'Controleer product, verpakking, eenheid en prijs.'
                              : 'Nog geen prijsberekening.'}
                          {state.state === 'complete' && state.unitPriceCents !== null &&
                            ` · ${exactEuro.formatCents(state.unitPriceCents)} per ${row.requiredUnit === 'piece' ? 'stuk' : row.requiredUnit === 'g' || row.requiredUnit === 'kg' ? 'kg' : 'liter'}`}
                        </p>
                      </fieldset>
                    )
                  })}
                </div>
                {row.quotes.PLUS.unitPriceCents !== null &&
                  row.quotes.DekaMarkt.unitPriceCents !== null && (
                  <p className="manual-compare__row-result">
                    <strong>Afgeronde eenheidsprijzen per {row.requiredUnit === 'piece'
                      ? 'stuk' : row.requiredUnit === 'g' || row.requiredUnit === 'kg' ? 'kg' : 'liter'}:</strong>{' '}
                    PLUS {exactEuro.formatCents(row.quotes.PLUS.unitPriceCents)} · DekaMarkt{' '}
                    {exactEuro.formatCents(row.quotes.DekaMarkt.unitPriceCents)}.{' '}
                    {row.quotes.PLUS.unitPriceCents === row.quotes.DekaMarkt.unitPriceCents
                      ? 'Op centen afgerond gelijk.'
                      : `${row.quotes.PLUS.unitPriceCents < row.quotes.DekaMarkt.unitPriceCents
                        ? 'PLUS' : 'DekaMarkt'} heeft een ${exactEuro.formatCents(Math.abs(
                        row.quotes.PLUS.unitPriceCents - row.quotes.DekaMarkt.unitPriceCents
                      ))} lagere afgeronde eenheidsprijs.`}{' '}
                    Dit is alleen een vergelijking van jouw ingevoerde verpakkingen; de
                    werkelijke mandkosten blijven gebaseerd op hele multipacks.
                  </p>
                )}
                {row.quotes.PLUS.state === 'complete' &&
                  row.quotes.DekaMarkt.state === 'complete' &&
                  row.quotes.PLUS.lineCents !== null &&
                  row.quotes.DekaMarkt.lineCents !== null && (
                  <p className="manual-compare__row-result" role="status">
                    <strong>Rekenkundig verschil voor dit ingrediënt:</strong>{' '}
                    {row.quotes.PLUS.lineCents === row.quotes.DekaMarkt.lineCents
                      ? 'beide zelf ingevoerde winkelregels kosten evenveel.'
                      : (row.quotes.PLUS.lineCents > row.quotes.DekaMarkt.lineCents
                        ? 'DekaMarkt ' : 'PLUS ') +
                        exactEuro.formatCents(Math.abs(
                          row.quotes.PLUS.lineCents - row.quotes.DekaMarkt.lineCents
                        )) + ' lager dan de andere winkelregel.'}
                    {' '}Controleer zelf of de gekozen winkelproducten werkelijk gelijkwaardig zijn;
                    dit is geen onafhankelijk geverifieerd winkelprijs- of besparingsbewijs.
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
