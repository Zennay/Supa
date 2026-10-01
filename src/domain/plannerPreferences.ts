export type PlannerPreferences = {
  budget: number
  activeDays: string[]
}

function fallbackPreferences(
  fallbackActiveDays: string[],
  fallbackBudget: number,
): PlannerPreferences {
  return {
    budget: fallbackBudget,
    activeDays: [...fallbackActiveDays],
  }
}

export function parsePlannerPreferences(
  raw: string | null,
  fallbackActiveDays: string[],
  fallbackBudget = 35,
): PlannerPreferences {
  if (!raw) return fallbackPreferences(fallbackActiveDays, fallbackBudget)

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return fallbackPreferences(fallbackActiveDays, fallbackBudget)
    }

    const candidate = parsed as {
      budget?: unknown
      activeDays?: unknown
    }

    const budget =
      typeof candidate.budget === 'number' &&
      Number.isFinite(candidate.budget) &&
      candidate.budget > 0
        ? candidate.budget
        : fallbackBudget

    const activeDays = Array.isArray(candidate.activeDays)
      ? Array.from(
          new Set(
            candidate.activeDays.filter(
              (day): day is string =>
                typeof day === 'string' && fallbackActiveDays.includes(day),
            ),
          ),
        )
      : [...fallbackActiveDays]

    return { budget, activeDays }
  } catch {
    return fallbackPreferences(fallbackActiveDays, fallbackBudget)
  }
}

export function serializePlannerPreferences(
  preferences: PlannerPreferences,
): string {
  return JSON.stringify(preferences)
}
