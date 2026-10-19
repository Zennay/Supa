import { useState } from 'react'
import type { OfflinePriceSnapshots, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/**
 * Private browser-memory-only user observations. Owned by App, not the
 * Vergelijk tab, so a Planner/Lijst navigation cannot discard the import.
 * No automatic localStorage, sessionStorage, sync API or retailer requests.
 */
export function useOfflineComparisonSession() {
  const [selectedStore, setSelectedStore] = useState<OfflineRetailer>('PLUS')
  // One-use navigation intent from a missing Lijst line to its matching editor.
  // Contains IDs only; no price, source observation or persisted customer data.
  const [reviewTarget, setReviewTarget] = useState<{
    store: OfflineRetailer; ingredientId: string
  } | null>(null)
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [stagedCaptures, setStagedCaptures] = useState<
    Partial<Record<OfflineRetailer, Record<string, unknown>>>
  >({})
  const [manualSelections, setManualSelections] = useState<{
    fingerprint: string
    products: Record<string, string>
  }>({ fingerprint: '', products: {} })
  const [stagedManual, setStagedManual] = useState<Record<
    OfflineRetailer, { fingerprint: string; products: Record<string, string> }
  >>({
    PLUS: { fingerprint: '', products: {} },
    DekaMarkt: { fingerprint: '', products: {} },
  })
  // Volatile user-picked extra products, explicitly excluded from priced meal baskets.
  const [extraProductIds, setExtraProductIds] = useState<Record<OfflineRetailer, string[]>>({
    PLUS: [], DekaMarkt: [],
  })
  const [extraDoneIds, setExtraDoneIds] = useState<Record<OfflineRetailer, string[]>>({
    PLUS: [], DekaMarkt: [],
  })
  // Quantity of independently selected loose products (1–99 whole packs).
  // Never participates in the canonical same-demand two-store comparison.
  const [extraQuantities, setExtraQuantities] = useState<
    Record<OfflineRetailer, Record<string, number>>
  >({ PLUS: {}, DekaMarkt: {} })
  // Volatile checkbox memory shared by Vergelijk and Lijst. No persistence
  // unless the existing private checklist's explicit opt-in is enabled.
  const [tripMemory, setTripMemory] = useState<
    Partial<Record<OfflineRetailer, { identity: string; done: string[] }>>
  >({})
  const [importEpoch, setImportEpoch] = useState(0)
  return {
    selectedStore, setSelectedStore, reviewTarget, setReviewTarget,
    text, setText, imported, setImported,
    stagedCaptures, setStagedCaptures,
    manualSelections, setManualSelections, stagedManual, setStagedManual,
    importEpoch, setImportEpoch, tripMemory, setTripMemory,
    extraProductIds, setExtraProductIds, extraDoneIds, setExtraDoneIds,
    extraQuantities, setExtraQuantities,
  }
}
export type OfflineComparisonSession = ReturnType<typeof useOfflineComparisonSession>
