import { plan, recipes } from '../../data/mock'
import { euro } from '../../lib/money'

export function PlannerView() {
  return (
    <section className="screen">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Deze week</span>
          <h2>Plan eerst. Bespaar daarna.</h2>
        </div>
        <button className="ghost-button">+ Maaltijd</button>
      </div>

      <div className="day-grid">
        {plan.map((item) => {
          const recipe = recipes.find((candidate) => candidate.id === item.recipeId)!
          return (
            <article className="meal-card" key={item.day}>
              <span className="day">{item.day}</span>
              <div>
                <h3>{recipe.title}</h3>
                <p>{recipe.minutes} min · {euro.format(recipe.estimatedCost)} / recept</p>
              </div>
              <span className="arrow">›</span>
            </article>
          )
        })}
      </div>

      <div className="insight-card">
        <span className="eyebrow">Slim gecombineerd</span>
        <strong>2 ingrediënten worden deze week opnieuw gebruikt.</strong>
        <p>Later komt hier de echte combinatie- en pack-size logica; nu is dit alleen UI-mockdata.</p>
      </div>
    </section>
  )
}
