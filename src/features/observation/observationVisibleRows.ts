import { observationLineCollectionComplete, type StoreObservation } from '../../domain/m3ObservationSheet.ts'

export type ObservationVisibleRow = {
  line: StoreObservation['lines'][number]
  /** Physical index in the original evidence sheet, never the filtered position. */
  lineIndex: number
}

/**
 * View-only filter. Keep canonical row indices so editing the second visible
 * row can never overwrite the wrong ingredient in an 11+11 field sheet.
 */
export function observationVisibleRows(
  observation: StoreObservation,
  onlyOpen: boolean,
): ObservationVisibleRow[] {
  const rows: ObservationVisibleRow[] = []
  for (let lineIndex = 0; lineIndex < observation.lines.length; lineIndex += 1) {
    const line = observation.lines[lineIndex]
    if (onlyOpen && observationLineCollectionComplete(line)) continue
    rows.push({ line, lineIndex })
  }
  return rows
}
