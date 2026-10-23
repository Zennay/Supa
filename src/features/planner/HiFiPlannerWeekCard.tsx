import type { PlannedMeal } from '../../domain/types'
import { FigmaImage } from '../../components/FigmaImage'
import './hifiPlannerWeek.css'

export const weekdayNames: Record<string, string> = {
  Ma: 'Maandag', Di: 'Dinsdag', Wo: 'Woensdag', Do: 'Donderdag',
  Vr: 'Vrijdag', Za: 'Zaterdag', Zo: 'Zondag',
}
const weekdayIndexes: Record<string, number> = {
  Ma: 0, Di: 1, Wo: 2, Do: 3, Vr: 4, Za: 5, Zo: 6,
}

/** Local calendar date of a planner weekday in the current Monday-based week. */
export function plannerWeekDate(day: string, today = new Date()) {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + (weekdayIndexes[day] ?? 0))
  return date
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
  dayImages = {},
}: {
  plannedMeals: PlannedMeal[]
  activeDays: string[]
  onToggleDay: (day: string) => void
  /** Original Figma photo of the recipe planned on a day, when one exists. */
  dayImages?: Record<string, string>
}) {
  const today = new Date()
  // Figma marks the first open day as the place to add the next meal.
  const nextOpenDay = plannedMeals.find(({ day }) => !activeDays.includes(day))?.day

  return (
    <section className="hifi-planner-week-card" aria-labelledby="hifi-week-planning-title" data-figma-node="3359:4900">
      <div className="hifi-planner-week-heading">
        <h3 id="hifi-week-planning-title">Weekplanning</h3>
        <p>Vul je planning aan en kies op welke dagen je kookt.</p>
      </div>
      <div className="hifi-planner-week-days" aria-label="Dagen in je weekplanning">
        {plannedMeals.map(({ day }) => {
          const active = activeDays.includes(day)
          const date = plannerWeekDate(day, today)
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
              <span className={active && dayImages[day]
                ? 'hifi-planner-day-number with-photo'
                : day === nextOpenDay ? 'hifi-planner-day-number next-open' : 'hifi-planner-day-number'}>
                {active && dayImages[day] && <FigmaImage asset={dayImages[day]} alt="" />}
                <span>{day === nextOpenDay ? '+' : date.getDate()}</span>
              </span>
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
