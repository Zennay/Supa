import { storeLogos } from './figmaAssets'

export const supermarkets = [
  { id: 'jumbo', name: 'Jumbo', logo: storeLogos.jumbo },
  { id: 'dirk', name: 'Dirk', logo: storeLogos.dirk },
  { id: 'ah', name: 'Albert Heijn', logo: storeLogos.ah },
  { id: 'lidl', name: 'Lidl', logo: storeLogos.lidl },
  { id: 'plus', name: 'PLUS', logo: storeLogos.plus },
  { id: 'vomar', name: 'Vomar', logo: storeLogos.vomar },
  { id: 'aldi', name: 'Aldi', logo: storeLogos.aldi },
  { id: 'hoogvliet', name: 'Hoogvliet', logo: storeLogos.hoogvliet },
] as const

export const storesStorageKey = 'supa:selected-supermarkets:v1'

/** The supermarkets chosen on Home (Jumbo and Dirk by default, as in the design). */
export function readSelectedStores(): string[] {
  const fallback = ['jumbo', 'dirk']
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(storesStorageKey)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    const known = new Set<string>(supermarkets.map(store => store.id))
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && known.has(id)) : fallback
  } catch { return fallback }
}
