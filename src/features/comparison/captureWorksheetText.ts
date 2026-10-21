/**
 * Preserve the identity of human-reviewed Planner labels in offline worksheets.
 * Never silently replace line breaks, invisible formatting controls, outer
 * whitespace, or overlong labels with a different-looking ingredient name.
 * ZWJ/ZWNJ remain valid for emoji and Indic shaping.
 */
const forbiddenControls = /[\p{Cc}\p{Zl}\p{Zp}]/u
const forbiddenFormatting = /[\p{Cf}]/u

export function captureWorksheetText(raw: string, maxLength = 180): string {
  const withoutJoiners = typeof raw === 'string' ? raw.replace(/[\u200C\u200D]/gu, '') : ''
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxLength ||
      raw !== raw.trim() || forbiddenControls.test(raw) ||
      forbiddenFormatting.test(withoutJoiners)) {
    throw new Error(
      'Een originele Planner- of receptregel bevat een regeleinde, verborgen opmaakteken, buitenste spaties of is te lang. Corrigeer de originele tekst voordat je het opnameblad maakt.',
    )
  }
  return raw
}

export function captureWorksheetHtml(raw: string, maxLength = 180): string {
  return captureWorksheetText(raw, maxLength)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
