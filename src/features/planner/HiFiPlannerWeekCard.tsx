import type { PlannedMeal } from '../../domain/types'
import './hifiPlannerWeek.css'

const weekdayNames: Record<string, string> = {
  Ma: 'Maandag', Di: 'Dinsdag', Wo: 'Woensdag', Do: 'Donderdag',
  Vr: 'Vrijdag', Za: 'Zaterdag', Zo: 'Zondag',
}
const weekdayIndexes: Record<string, number> = {
  Ma: 0, Di: 1, Wo: 2, Do: 3, Vr: 4, Za: 5, Zo: 6,
}

/**
 * The clickable week strip follows Figma Planner 3359:4900 rather than
 * reproducing the prototype's fixed 19–23 date or invented recipe photos.
 * Dates and active states come from the real local week and persisted plan.
 */
export function HiFiPlannerWeekCard({
  plannedMeals,
  activeDays,
  onToggleDay,
}: {
  plannedMeals: PlannedMeal[]
  activeDays: string[]
  onToggleDay: (day: string) => void
}) {
  const today = new Date()
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))

  return (
    <section className="hifi-planner-week-card" aria-labelledby="hifi-week-planning-title" data-figma-node="3359:4900">
      <div className="hifi-planner-week-heading">
        <h3 id="hifi-week-planning-title">Weekplanning</h3>
        <p>Vul je planning aan en kies op welke dagen je kookt.</p>
      </div>
      <div className="hifi-planner-week-days" aria-label="Dagen in je weekplanning">
        {plannedMeals.map(({ day }) => {
          const active = activeDays.includes(day)
          const date = new Date(monday)
          date.setDate(monday.getDate() + (weekdayIndexes[day] ?? 0))
          return (
            <button
              key={day}
              type="button"
              className={active ? 'hifi-planner-day selected' : 'hifi-planner-day'}
              aria-label={`${weekdayNames[day] ?? day} ${date.getDate()} ${active ? 'uit planning halen' : 'aan planning toevoegen'}`}
              aria-pressed={active}
              onClick={() => onToggleDay(day)}
            >
              <span className="hifi-planner-day-label">{day.slice(0, 1)}</span>
              <span className="hifi-planner-day-number">{date.getDate()}</span>
            </button>
          )
        })}
      </div>
      <p className="hifi-planner-week-count" aria-live="polite">
        {plannedMeals.filter(({ day }) => activeDays.includes(day)).length} van {plannedMeals.length} dagen geselecteerd
      </p>
    </section>
  )
}
