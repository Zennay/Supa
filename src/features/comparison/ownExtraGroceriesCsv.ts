import { literalCsv } from '../../privateBasketComparisonCsv.ts'

export type OwnExtraGrocery = Readonly<{
  id: string
  name: string
  quantity: number
  unit: 'g' | 'ml' | 'piece'
  done: boolean
}>

/** Personal extra groceries only: unknown store, unknown price, no merged savings. */
export function exportOwnExtraGroceriesCsv(items: readonly OwnExtraGrocery[]): string {
  if (items.length === 0 || items.length > 100) throw new Error('Geen extra boodschappen voor CSV.')
  const row = (fields: readonly unknown[]) => fields.map(value => literalCsv(value)).join(';')
  const csv = [
    row(['Artikel', 'Hoeveelheid', 'Eenheid', 'Afgevinkt', 'Winkel', 'Prijs']),
    ...items.map(item => row([
      item.name, String(item.quantity), item.unit === 'piece' ? 'stuks' : item.unit,
      item.done ? 'ja' : 'nee', 'Niet gekoppeld', 'Onbekend',
    ])),
  ].join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).length > 256_000) throw new Error('Extra lijst is te groot voor CSV.')
  return csv
}
