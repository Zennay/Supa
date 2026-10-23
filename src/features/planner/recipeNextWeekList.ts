import { sumDecimalDemandUnits } from '../../domain/decimalPackArithmetic.ts'
import type { MatchUnit } from '../../domain/matching.ts'
import type { RecipeShoppingChange } from './recipeShoppingChange.ts'

export type NextWeekPhysicalItem = Readonly<{
  id: string
  label: string
  amount: number
  unit: 'g' | 'ml' | 'piece'
}>

function labelForPrint(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, 180)
}

/**
 * An entirely unpriced checklist for a PROPOSED recipe switch.
 * Derive it from the same complete physical demand used for both blank
 * retailer capture sheets, not from the shopping delta or old SKU matches.
 */
export function nextWeekPhysicalItems(preview: RecipeShoppingChange): readonly NextWeekPhysicalItem[] {
  if (preview.status !== 'ready' || !Array.isArray(preview.nextNeeds) ||
      preview.nextNeeds.length > 200) {
    throw new Error('Controleer eerst het voorgestelde fysieke weekmandje.')
  }
  const ids = new Set<string>()
  return preview.nextNeeds.map((need) => {
    if (!need || typeof need.id !== 'string' || !need.id.trim() ||
        typeof need.label !== 'string' || !labelForPrint(need.label) ||
        typeof need.amount !== 'number' || !Number.isFinite(need.amount) ||
        need.amount <= 0 || ids.has(need.id)) {
      throw new Error('De nieuwe weeklijst bevat een onbekend of dubbel ingrediënt.')
    }
    ids.add(need.id)
    const unit = need.unit === 'kg' || need.unit === 'g' ? 'g'
      : need.unit === 'l' || need.unit === 'ml' ? 'ml'
      : need.unit === 'piece' ? 'piece' : null
    if (unit === null) throw new Error('De weeklijst bevat een niet-herkende maateenheid.')
    const amount = sumDecimalDemandUnits(
      [{ amount: need.amount, unit: need.unit as MatchUnit }], unit)
    if (amount === null || !Number.isFinite(amount) || amount <= 0 ||
        (unit === 'piece' && !Number.isSafeInteger(amount))) {
      throw new Error('Controleer de hoeveelheden en gedeeltelijke stuks in Recepten.')
    }
    return { id: need.id, label: labelForPrint(need.label), amount, unit }
  })
}

export function nextWeekPhysicalListText(preview: RecipeShoppingChange, day: string): string {
  const items = nextWeekPhysicalItems(preview)
  const rows = [
    'Supa · volledige VOORGESTELDE weekboodschappenlijst',
    'Alternatief recept bekeken voor ' + labelForPrint(day),
    'Concept: je planning en boodschappenlijst zijn nog niet aangepast.',
    'Ongeprijsde fysieke hoeveelheden, geen winkel-SKU, prijs of besparingsclaim.',
    '',
    ...(items.length ? items.map(item =>
      '[ ] ' + item.label + ' — ' + String(item.amount).replace('.', ',') +
      ' ' + (item.unit === 'piece' ? 'stuks' : item.unit))
      : ['Geen fysieke ingrediënten voor deze week.']),
    '',
    'Kies het recept eerst om je planning aan te passen.',
    'Controleer daarna de oorspronkelijke PLUS/Deka-bronnen en volledige mandjes in Vergelijk.',
  ]
  const output = rows.join('\n') + '\n'
  if (new TextEncoder().encode(output).length > 100_000)
    throw new Error('De voorgestelde weeklijst is te groot om lokaal te downloaden.')
  return output
}


/** Spreadsheet-friendly, supplier-neutral export of a PROPOSED week.
 * This is NOT a retailer capture, approved SKU match or price quote.
 * Quote all cells and keep leading formula characters literal on import.
 */
export function nextWeekPhysicalListCsv(preview: RecipeShoppingChange, day: string): string {
  const items = nextWeekPhysicalItems(preview)
  const safeCell = (raw: string): string => {
    const plain = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim()
    // Normalize only for formula detection; preserve the actual written label.
    const normalized = plain.normalize('NFKC')
    const literal = /^[\s\p{M}]*(?:[=+\-@])/u.test(normalized) ? "'" + plain : plain
    return '"' + literal.replaceAll('"', '""') + '"'
  }
  const proposal = 'VOORSTEL voor ' + labelForPrint(day) + '; nog niet ingepland'
  const rows = [
    ['Ingredient-ID', 'Ingredient', 'Hoeveelheid', 'Eenheid', 'Planning', 'Winkelprijs'],
    ...items.map(item => [
      item.id, item.label, String(item.amount).replace('.', ','),
      item.unit === 'piece' ? 'stuks' : item.unit, proposal, 'Onbekend',
    ]),
  ]
  const body = rows.map(row => row.map(safeCell).join(';')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(body).length > 100_000)
    throw new Error('Het voorgestelde weekmandje is te groot voor een CSV-export.')
  return '\uFEFF' + body
}
