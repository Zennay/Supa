import type { WeekMenuDownloadPort } from './downloadWeekMenuText.ts'

// Calendar export is explicitly initiated from the currently displayed,
// read-only offline week-menu preview. It never uploads a calendar or guesses
// which calendar week the owner intended.
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'] as const
const encoder = new TextEncoder()

function dateForDay(monday: Date, offset: number): string {
  const date = new Date(monday.getTime())
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Use civil UTC arithmetic only; do not move all-day meals across local DST. */
function mondayDate(value: string): Date | null {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) return null
  return date
}

function calendarText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// RFC 5545 physical lines must be <=75 UTF-8 octets. Fold on Unicode code
// point boundaries to avoid breaking Dutch accents or emoji in recipe titles.
function fold(value: string): string {
  let result = ''
  let length = 0
  for (const character of value) {
    const bytes = encoder.encode(character).length
    if (length + bytes > 75) {
      result += '\r\n '
      length = 1
    }
    result += character
    length += bytes
  }
  return result
}

export function preparedWeekCalendar(
  preview: string,
  monday: string,
): string | null {
  if (typeof preview !== 'string' || encoder.encode(preview).length > 16384 ||
      !preview.startsWith('SUPA · Weekmenu\n') ||
      !preview.endsWith('Receptschattingen en echte winkelprijzen zijn niet inbegrepen.')) return null
  const start = mondayDate(monday)
  if (!start) return null
  const entries: Array<{ offset: number; title: string }> = []
  const used = new Set<string>()
  for (const line of preview.split('\n')) {
    const match = /^(Ma|Di|Wo|Do|Vr|Za|Zo): (.+)$/.exec(line)
    if (!match) continue
    const [, day, title] = match
    // Do not import invisible direction controls or multiline content into a
    // person's calendar. The canonical preview generator already checks this.
    if (used.has(day) || title.length > 240 ||
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115f\u1160\u2800\u3164\uffa0]/u.test(title) ||
        !/[\p{L}\p{N}]/u.test(title)) return null
    used.add(day)
    entries.push({ offset: DAYS.indexOf(day as typeof DAYS[number]), title })
  }
  if (!entries.length || entries.length > 7) return null
  const stamp = dateForDay(start, 0) + 'T000000Z'
  const rows = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SUPA//Offline Weekmenu//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:SUPA Weekmenu',
  ]
  for (const { offset, title } of entries) {
    rows.push('BEGIN:VEVENT',
      'UID:supa-weekmenu-' + dateForDay(start, 0) + '-' + offset + '@local.invalid',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + dateForDay(start, offset),
      'DTEND;VALUE=DATE:' + dateForDay(start, offset + 1),
      'SUMMARY:' + calendarText(title),
      'DESCRIPTION:Eigen SUPA maaltijdplanning. Geen prijsopgave of winkelbesparing.',
      'TRANSP:TRANSPARENT',
      'END:VEVENT')
  }
  rows.push('END:VCALENDAR')
  return rows.map(fold).join('\r\n') + '\r\n'
}

/** Only the exact on-screen preview can be downloaded. No calendar/network API. */
export function downloadPreparedWeekCalendar(
  field: Pick<HTMLTextAreaElement, 'readOnly' | 'value'> | null,
  expectedText: string,
  monday: string,
  port: WeekMenuDownloadPort,
): boolean {
  let objectUrl: string | null = null
  try {
    if (!field?.readOnly || field.value !== expectedText) return false
    const ics = preparedWeekCalendar(expectedText, monday)
    if (!ics) return false
    const createdUrl = port.createObjectURL(ics)
    if (typeof createdUrl !== 'string' || !createdUrl.startsWith('blob:')) return false
    objectUrl = createdUrl
    if (!field.readOnly || field.value !== expectedText) return false
    port.triggerDownload(objectUrl, 'supa-weekmenu-' + monday + '.ics')
    return true
  } catch {
    return false
  } finally {
    if (objectUrl?.startsWith('blob:')) {
      try { port.scheduleRevoke(objectUrl) } catch { /* best effort cleanup */ }
    }
  }
}
