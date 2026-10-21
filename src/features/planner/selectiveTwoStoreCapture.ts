import { makeBlankPlannerCaptureCsv, type CaptureStore } from '../comparison/plannerPriceCaptureSheet.ts'
import { readablePlannerDemandAmount, type PlannerCaptureGuideNeed } from '../comparison/plannerPriceCaptureGuide.ts'

export type MissingStoreNeeds = Readonly<Record<CaptureStore, readonly PlannerCaptureGuideNeed[]>>
const shops: readonly CaptureStore[] = ['PLUS', 'DekaMarkt']

function validate(needs: MissingStoreNeeds): number {
  const all = [...needs.PLUS, ...needs.DekaMarkt]
  if (all.length < 1 || all.length > 400) {
    throw new Error('Kies maximaal 400 ontbrekende winkelproductregels.')
  }
  const keys = new Set<string>()
  for (const store of shops) {
    if (!Array.isArray(needs[store]) || needs[store].length > 200) {
      throw new Error('Maximaal 200 originele ingrediënten per winkel.')
    }
    for (const item of needs[store]) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() ||
          typeof item.label !== 'string' || !item.label.trim() ||
          typeof item.unit !== 'string' || item.unit.length > 30 ||
          (item.amount !== null && (typeof item.amount !== 'number' ||
            !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 1_000_000))) {
        throw new Error('Eén of meer fysieke Planner-behoeften zijn onduidelijk.')
      }
      const key = JSON.stringify([store, item.id])
      if (keys.has(key)) throw new Error('Dubbele ingredientbehoefte binnen één winkel.')
      keys.add(key)
    }
  }
  return all.length
}

/**
 * EXACTLY the current 9-column retailer importer schema, using the canonical
 * blank-sheet producer. Unlike the ordinary same-demand sheet, the two stores
 * may need different numbers of missing SKUs. Never fill source facts.
 */
export function selectiveTwoStoreCaptureCsv(
  needs: MissingStoreNeeds, delimiter: ',' | ';' = ',',
): string {
  validate(needs)
  let header = ''
  const rows: string[] = []
  for (const store of shops) {
    if (!needs[store].length) continue
    const output = makeBlankPlannerCaptureCsv(needs[store], [store], delimiter)
      .trimEnd().split('\r\n')
    if (!header) header = output[0]
    else if (output[0] !== header) throw new Error('Winkelblad-schema is gewijzigd.')
    rows.push(...output.slice(1))
  }
  if (!header || !rows.length) throw new Error('Geen openstaande winkelproducten.')
  const csv = [header, ...rows].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256000) {
    throw new Error('Het gecombineerde bronblad past niet in de lokale importer.')
  }
  return csv
}

export function selectiveTwoStoreCaptureGuide(needs: MissingStoreNeeds): string {
  validate(needs)
  // Source workbook is the authoritative row-numbering contract.
  selectiveTwoStoreCaptureCsv(needs)
  const clean = (value: string) => value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 160)
  let row = 2
  const output = [
    'SUPA · alleen ontbrekende PLUS en DekaMarkt bronproducten',
    'Eigen privé-registratie; GEEN actuele winkelprijzen, retailerrechten of besparingsbewijs.',
    'Alleen echt geobserveerde originele SKU, naam, verpakking, prijs in eurocenten,',
    'beschikbaarheid en bronmoment (ISO met UTC-offset) mogen in het CSV-blad.',
    'Niet gevonden blijft leeg. De voorgestelde ingrediënteenheid is GEEN bewezen verpakking.',
    'Gebruik altijd het echte oorspronkelijke bronmoment van de nieuwe waarneming.',
    'Alleen echt gelijktijdig waargenomen SKU’s mogen bij één eerder bronmoment worden gevoegd.',
    'Later geobserveerde producten vereisen een complete nieuwe winkelopname.',
    'Kopieer nooit een oud bronmoment naar nieuwe winkelprijzen.',
    '',
  ]
  for (const store of shops) {
    output.push(store + ' · ' + needs[store].length + ' ontbrekende bronproducten')
    if (!needs[store].length) output.push('Niets opnieuw opnemen voor deze winkel.')
    for (const item of needs[store]) {
      const physical = readablePlannerDemandAmount(item.amount)
      const amount = physical === 'hoeveelheid nog controleren'
        ? physical : physical + ' ' + clean(item.unit)
      output.push('CSV rij ' + row++ + ' · ' + clean(item.label) +
        ' · Planner-behoefte ' + amount)
    }
    output.push('')
  }
  output.push('Importeer de ingevulde CSV in Supa Vergelijk en bevestig zelf elke originele SKU.',
    'Ook na import blijft prijsverschil onbekend tot beide actuele hele mandjes gecontroleerd zijn.')
  const text = output.join('\n') + '\n'
  if (new TextEncoder().encode(text).length > 120000) {
    throw new Error('De gecombineerde meeneemlijst is te groot.')
  }
  return text
}
