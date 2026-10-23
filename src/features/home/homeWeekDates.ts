/** The Figma Home strip shows Sunday through Thursday, but its 19–23
 * numbers belong to an old prototype week. Supply actual upcoming local dates.
 * The weekly planner itself remains weekday-based until dated plans exist. */
export const homeWeekdays = [
  { label: 'Z', plannerDay: 'Zo', fullName: 'Zondag' },
  { label: 'M', plannerDay: 'Ma', fullName: 'Maandag' },
  { label: 'D', plannerDay: 'Di', fullName: 'Dinsdag' },
  { label: 'W', plannerDay: 'Wo', fullName: 'Woensdag' },
  { label: 'D', plannerDay: 'Do', fullName: 'Donderdag' },
] as const

export function upcomingHomeWeek(now: Date = new Date()) {
  const upcomingSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  upcomingSunday.setDate(upcomingSunday.getDate() + ((7 - upcomingSunday.getDay()) % 7))

  return homeWeekdays.map((day, offset) => {
    const at = new Date(upcomingSunday)
    at.setDate(upcomingSunday.getDate() + offset)
    return { ...day, date: at.getDate(), month: at.getMonth(), year: at.getFullYear() }
  })
}
