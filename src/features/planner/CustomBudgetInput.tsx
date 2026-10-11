import { useEffect, useState, type FormEvent } from 'react'
import {
  customWeekBudgetLabel,
  parseCustomWeekBudget,
} from '../../domain/customPlannerBudget.ts'
import './customBudget.css'

type CustomBudgetInputProps = {
  budget: number
  onBudgetChange: (budget: number) => void
}

/** Explicit commit so unfinished typing never changes the current week. */
export function CustomBudgetInput({ budget, onBudgetChange }: CustomBudgetInputProps) {
  const [draft, setDraft] = useState(() => customWeekBudgetLabel(budget))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(customWeekBudgetLabel(budget))
    setInvalid(false)
  }, [budget])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = parseCustomWeekBudget(draft)
    if (next === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onBudgetChange(next)
  }

  return (
    <form className="custom-budget-form" onSubmit={submit}>
      <label htmlFor="planner-custom-budget">Eigen weekbudget (€)</label>
      <div className="custom-budget-controls">
        <input
          id="planner-custom-budget"
          name="weekbudget"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={8}
          placeholder="bijv. 27,50"
          value={draft}
          aria-invalid={invalid}
          aria-describedby="planner-custom-budget-hint"
          onChange={(event) => {
            setDraft(event.target.value)
            if (invalid) setInvalid(false)
          }}
        />
        <button type="submit" className="ghost-button">Instellen</button>
      </div>
      <small id="planner-custom-budget-hint">
        Vul €0,01 tot €1.000,00 in. Gebruik een komma of punt.
      </small>
      {invalid && (
        <p role="alert" className="custom-budget-error">
          Vul een geldig bedrag in hele centen in (bijvoorbeeld 27,50).
        </p>
      )}
    </form>
  )
}
