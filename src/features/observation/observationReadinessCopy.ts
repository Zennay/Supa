/**
 * Translate canonical M3 readiness findings only at the presentation boundary.
 *
 * Do not rewrite observationSheetReadiness, ignore any issue, or infer that a
 * filled form has become verified price evidence. All entries still render.
 */
const FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['Study ID', 'Metingcode'],
  ['Participant key', 'Anonieme deelnemerscode'],
  ['Week start', 'Startdatum van de meetweek'],
  ['Populatie', 'Doelgroep'],
  ['Regio', 'Gebied'],
  ['Prijscontext', 'Manier van prijsmeten'],
]

export function readableObservationIssue(issue: string): string {
  if (typeof issue !== 'string') return 'Controleer deze meting.'
  let visible = issue
  for (const [internal, label] of FIELD_LABELS) {
    if (visible.startsWith(internal + ' ontbreekt.')) {
      visible = label + visible.slice(internal.length)
      break
    }
  }
  return visible
    .replace(/Winkel A\b/g, 'PLUS')
    .replace(/Winkel B\b/g, 'DekaMarkt')
    .replace(/evidence ID/gi, 'code van de winkelmeting')
    .replace(/provenance-notitie/gi, 'toelichting op de prijsbron')
}
