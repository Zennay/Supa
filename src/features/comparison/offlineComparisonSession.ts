import { useState } from 'react'
import type { OfflinePriceSnapshots, OfflineRetailer } from '../../domain/offlineReviewedImport.ts'

/**
 * Private browser-memory-only user observations. Owned by App, not the
 * Vergelijk tab, so a Planner/Lijst navigation cannot discard the import.
 * No automatic localStorage, sessionStorage, sync API or retailer requests.
 */
export function useOfflineComparisonSession() {
  const [text, setText] = useState('')
  const [imported, setImported] = useState<OfflinePriceSnapshots | null>(null)
  const [stagedCaptures, setStagedCaptures] = useState<
    Partial<Record<OfflineRetailer, Record<string, unknown>>>
  >({})
  const [manualSelections, setManualSelections] = useState<{
    fingerprint: string
    products: Record<string, string>
  }>({ fingerprint: '', products: {} })
  const [importEpoch, setImportEpoch] = useState(0)
  return {
    text, setText, imported, setImported,
    stagedCaptures, setStagedCaptures,
    manualSelections, setManualSelections,
    importEpoch, setImportEpoch,
  }
}
export type OfflineComparisonSession = ReturnType<typeof useOfflineComparisonSession>
