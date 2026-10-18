import { useState } from 'react'
import type { OfflinePriceSnapshots, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/**
 * Private browser-memory-only user observations. Owned by App, not the
 * Vergelijk tab, so a Planner/Lijst navigation cannot discard the import.
 * No automatic localStorage, sessionStorage, sync API or retailer requests.
 */
export function useOfflineComparisonSession() {
  const [selectedStore, setSelectedStore] = useState<OfflineRetailer>('PLUS')
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [stagedCaptures, setStagedCaptures] = useState<
    Partial<Record<OfflineRetailer, Record<string, unknown>>>
  >({})
  const [manualSelections, setManualSelections] = useState<{
    fingerprint: string
    products: Record<string, string>
  }>({ fingerprint: '', products: {} })
  // Volatile checkbox memory shared by Vergelijk and Lijst. No persistence
  // unless the existing private checklist's explicit opt-in is enabled.
  const [tripMemory, setTripMemory] = useState<
    Partial<Record<OfflineRetailer, { identity: string; done: string[] }>>
  >({})
  const [importEpoch, setImportEpoch] = useState(0)
  return {
    selectedStore, setSelectedStore, text, setText, imported, setImported,
    stagedCaptures, setStagedCaptures,
    manualSelections, setManualSelections,
    importEpoch, setImportEpoch, tripMemory, setTripMemory,
  }
}
export type OfflineComparisonSession = ReturnType<typeof useOfflineComparisonSession>
