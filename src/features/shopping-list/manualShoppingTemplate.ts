import type { UnpricedShoppingNote } from './ManualShoppingNotes.tsx'
import { privateNoteDuplicateKey } from './manualShoppingNoteIdentity.ts'

export const PRIVATE_SHOPPING_TEMPLATE_KEY = 'supa:private-shopping-template:v1'
export const PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES = 32768
export type PrivateShoppingTemplateItem = Pick<UnpricedShoppingNote, 'label' | 'store'>
export type PrivateShoppingTemplate = {
  schema: 'supa-private-shopping-template-v1'
  name: string
  items: PrivateShoppingTemplateItem[]
}
const stores = new Set(['Algemeen', 'PLUS', 'DekaMarkt'])
const safeText = (value: string) => value
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/\s+/gu, ' ').trim()

/** User-entered, unpriced repeat-shopping template. No ticks, prices, IDs or retailer evidence. */
export function readPrivateShoppingTemplate(input: unknown): PrivateShoppingTemplate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Ongeldig privéboodschappensjabloon.')
  const record = input as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'items,name,schema' ||
      record.schema !== 'supa-private-shopping-template-v1' ||
      typeof record.name !== 'string' || !record.name || record.name.length > 60 ||
      safeText(record.name) !== record.name ||
      !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 100)
    throw Error('Onbekende sjabloonversie of ongeldige titel/lijst.')
  const seen = new Set<string>()
  const items = record.items.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Ongeldig sjabloonartikel.')
    const row = value as Record<string, unknown>
    if (Object.keys(row).sort().join(',') !== 'label,store' ||
        typeof row.label !== 'string' || !row.label || row.label.length > 140 ||
        safeText(row.label) !== row.label || typeof row.store !== 'string' ||
        !stores.has(row.store)) throw Error('Ongeldige omschrijving of winkel in sjabloon.')
    const store = row.store as PrivateShoppingTemplateItem['store']
    const identity = privateNoteDuplicateKey(store, row.label)
    if (seen.has(identity)) throw Error('Dubbel artikel in sjabloon.')
    seen.add(identity)
    return { store, label: row.label }
  })
  return { schema: 'supa-private-shopping-template-v1', name: record.name, items }
}

export function makePrivateShoppingTemplate(name: string, notes: readonly UnpricedShoppingNote[]): string {
  const title = safeText(name)
  const items = notes.map(({ label, store }) => ({ label, store }))
  const template = readPrivateShoppingTemplate({ schema: 'supa-private-shopping-template-v1', name: title, items })
  const json = JSON.stringify(template)
  if (new TextEncoder().encode(json).length > PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES)
    throw Error('Sjabloon is groter dan 32 kB.')
  return json
}

export function parsePrivateShoppingTemplate(raw: string): PrivateShoppingTemplate {
  if (new TextEncoder().encode(raw).length > PRIVATE_SHOPPING_TEMPLATE_MAX_BYTES)
    throw Error('Bewaard sjabloon is groter dan 32 kB.')
  return readPrivateShoppingTemplate(JSON.parse(raw))
}
