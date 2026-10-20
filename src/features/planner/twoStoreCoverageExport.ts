import { literalCsv } from '../../privateBasketComparisonCsv.ts'

export type CoverageExportLine = Readonly<{
  ingredientId: string
  ingredient: string
  demand: string
  plusStatus: string
  plusObservedAt: string
  dekaStatus: string
  dekaObservedAt: string
}>

function checked(rows: readonly CoverageExportLine[]): CoverageExportLine[] {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
    throw new Error('Selecteer eerst maximaal 200 fysieke weekingrediënten.')
  }
  return rows.map(row => {
    if (!row || ![row.ingredientId, row.ingredient, row.demand,
      row.plusStatus, row.plusObservedAt, row.dekaStatus, row.dekaObservedAt]
      .every(value => typeof value === 'string' && value.length <= 500)) {
      throw new Error('Deze controlelijst bevat een ongeldige regel.')
    }
    return row
  })
}

/** Only work-status facts, never a retailer price, licensed source or public claim. */
export function privateTwoStoreCoverageCsv(rows: readonly CoverageExportLine[]): string {
  const known = checked(rows)
  const line = (values: readonly string[]) => values.map(value => literalCsv(value)).join(';')
  const header = ['Origineel ingrediënt-ID', 'Ingrediënt', 'Fysieke behoefte',
    'PLUS controle', 'PLUS bronmoment', 'DekaMarkt controle', 'DekaMarkt bronmoment',
    'Financiële vergelijking']
  const output = '\ufeff' + [line(header),
    ...known.map(item => line([item.ingredientId, item.ingredient, item.demand,
      item.plusStatus, item.plusObservedAt, item.dekaStatus, item.dekaObservedAt,
      'Niet in dit controleblad: bekijk geprijsde mandjes in Supa']))].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(output).length > 256_000) {
    throw new Error('De broncontrolelijst is te groot voor lokale CSV-export.')
  }
  return output
}

/** A text-only counterpart for mobiles without file download support. */
export function privateTwoStoreCoverageText(rows: readonly CoverageExportLine[]): string {
  const clean = (value: string) =>
    value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
  const known = checked(rows)
  const output = [
    'Supa · mijn persoonlijke weekmand: PLUS en DekaMarkt',
    'Broncontroles voor dezelfde fysieke ingrediënten, niet onafhankelijk geverifieerd.',
    'Geen fictieve prijs of publieke besparingsclaim.',
    '',
    ...known.flatMap(row => [
      clean(row.ingredient) + ' · ' + clean(row.demand) +
        ' (ingrediënt ' + clean(row.ingredientId) + ')',
      '  PLUS: ' + clean(row.plusStatus) +
        (row.plusObservedAt ? ' · ' + clean(row.plusObservedAt) : ''),
      '  DekaMarkt: ' + clean(row.dekaStatus) +
        (row.dekaObservedAt ? ' · ' + clean(row.dekaObservedAt) : ''),
    ]),
    '',
    'Vul alleen werkelijk waargenomen productcodes, fysieke verpakkingen en prijzen in Vergelijk in.',
    'Een prijsverschil is onbekend zonder twee volledige actuele winkelmandjes.',
    '',
  ].join('\n')
  if (new TextEncoder().encode(output).length > 120_000) {
    throw new Error('De mobiele broncontrolelijst is te groot.')
  }
  return output
}
