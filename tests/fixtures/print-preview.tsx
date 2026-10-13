import React from 'react'
import { createRoot } from 'react-dom/client'
import { buildOneStoreBasket } from '../../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../../src/data/m2Fixture.ts'
import { PrintableShoppingChecklist } from '../../src/features/shopping-list/PrintableShoppingChecklist.tsx'
import '../../src/styles.css'

// This stand-alone path is only served by Vite in the isolated browser test.
// All inputs come from the deterministic M2 example: never real observations.
const basket = buildOneStoreBasket({
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
  products: m2Products.filter((product) => product.id !== 'chicken-400'),
})

createRoot(document.getElementById('print-preview-root')!).render(
  <main className="app-shell" data-synthetic-print-fixture="true">
    <header className="topbar">SUPA · testomgeving</header>
    <div className="content">
      <section className="screen">
        <div className="section-heading">
          <h1>Alleen lokaal testen — geen winkelevidence</h1>
        </div>
        <div className="attention-card">Schermhulp (mag niet op papier verschijnen)</div>
        <div className="list-card">Schermkaart (mag niet op papier verschijnen)</div>
        <PrintableShoppingChecklist basket={basket} />
      </section>
    </div>
    <nav className="bottom-nav">Testnavigatie (mag niet op papier verschijnen)</nav>
  </main>,
)
