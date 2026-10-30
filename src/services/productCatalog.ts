import { useSyncExternalStore } from 'react'
import { fetchApiProducts, type ApiProduct } from './productApi'

/**
 * Where the product list comes from. Without `VITE_API_URL` the app keeps the
 * built-in demo products (nothing changes). With it, products come from the
 * scraper API; if the API is down or returns nothing usable the demo products
 * stay, so the screens never go empty.
 */
export type CatalogState = { source: 'demo' | 'api'; products: ApiProduct[]; loadedAt: string | null }

let state: CatalogState = { source: 'demo', products: [], loadedAt: null }
const listeners = new Set<() => void>()
let started = false

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || ''

export function loadCatalog() {
  if (started || !apiUrl) return
  started = true
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  fetchApiProducts(apiUrl, controller.signal)
    .then(products => {
      if (products.length === 0) return
      state = { source: 'api', products, loadedAt: new Date().toISOString() }
      listeners.forEach(listener => listener())
    })
    .catch(() => { /* keep demo products */ })
    .finally(() => window.clearTimeout(timeout))
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => state,
    () => state,
  )
}
