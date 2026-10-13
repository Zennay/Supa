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


/**
 * Multi-page print stress fixture. No network or retailer observations:
 * deterministic M2 example lines get new synthetic identities only.
 */
const isMultiPage = new URLSearchParams(window.location.search).get('long') === '1'
const fixtureBasket = isMultiPage
  ? {
      ...basket,
      lines: Array.from({ length: 88 }, (_, index) => {
        const original = basket.lines[index % basket.lines.length]
        const label = `Proefregel${String(index + 1).padStart(3, '0')}` +
          (index === 41 ? 'L'.repeat(165) + 'EINDEPRODUCT' : '')
        if (!original) throw new Error('Synthetische printbron ontbreekt')
        return original.status === 'matched'
          ? { ...original, id: label, productName: label }
          : { ...original, id: label, ingredientLabel: label }
      }),
    }
  : basket

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
        <aside className="screen-only-canary" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>SCHERMALLEEN_WILLEKEURIGE_SECTIE_GEEN_PAPIER</aside>
        <div className="diagnostic-canary" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>SCHERMALLEEN_GEVOELIGE_DIAGNOSTIEK_GEEN_PAPIER</div>
        {isMultiPage && (
          <section className="screen-only-scroll-stress" style={{ height: 16000 }}>
            SCHERMALLEEN_ZESTIENDUIZEND_PX_GEEN_EXTRA_PAGINAS
          </section>
        )}
        <PrintableShoppingChecklist basket={fixtureBasket} />
      </section>
    </div>
    <nav className="bottom-nav">Testnavigatie (mag niet op papier verschijnen)</nav>
  </main>,
)
