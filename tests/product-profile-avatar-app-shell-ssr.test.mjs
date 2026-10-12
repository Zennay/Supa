import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

// Product #596: exercise the REAL compiled App shell and avatar together.
// Other feature and basket modules are deterministic placeholders so this
// independent contract does not take ownership of planner/retailer code.
const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const { renderToStaticMarkup } = nodeRequire('react-dom/server')

function loadCompiledTsx(path, dependency) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: path.endsWith('App.tsx') ? 'App.tsx' : 'IdentityAvatar.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module,
    module.exports,
    dependency,
  )
  return module.exports
}

const { IdentityAvatar } = loadCompiledTsx(
  '../src/components/IdentityAvatar.tsx',
  nodeRequire,
)
const feature = (name) => () => React.createElement(
  'section', { 'data-test-feature': name }, name,
)
const prefs = () => ({
  budget: 35,
  activeDays: ['Ma'],
  recipeByDay: { Ma: 'demo-recipe' },
})
const viewDependencies = {
  './features/planner/PlannerView': { PlannerView: feature('planner') },
  './features/basket/BasketView': { BasketView: feature('basket') },
  './features/shopping-list/ShoppingListView': {
    ShoppingListView: feature('shopping-list'),
  },
  './features/observation/ObservationView': {
    ObservationView: feature('observation'),
  },
  './components/IdentityAvatar.tsx': { IdentityAvatar },
  './domain/basket': {
    buildOneStoreBasket: () => ({
      lines: [], totalCents: 0, unresolvedLineCount: 0,
    }),
  },
  './domain/basketComparison': { compareFullBaskets: () => ({}) },
  './domain/plannerPreferences': {
    defaultPlannerPreferences: prefs,
    parsePlannerPreferences: prefs,
    serializePlannerPreferences: () => '{}',
  },
  './data/m2Fixture': {
    m2InitialPlan: [{ day: 'Ma', recipeId: 'demo-recipe' }],
    m2Products: [],
    m2Recipes: [{ id: 'demo-recipe' }],
    m2Store: { id: 'demo-store', name: 'Demo' },
  },
  './data/m3ComparisonFixture': {
    m3BaselineProducts: [],
    m3CandidateProducts: [],
    m3BaselineStore: { id: 'plus', name: 'PLUS' },
    m3CandidateStore: { id: 'deka', name: 'DekaMarkt' },
  },
}

const { App } = loadCompiledTsx('../src/App.tsx', (name) =>
  Object.hasOwn(viewDependencies, name)
    ? viewDependencies[name]
    : nodeRequire(name),
)

function renderShell() {
  return renderToStaticMarkup(React.createElement(App))
}

test('product #596: real App header renders static avatar, not a phantom profile action', () => {
  const html = renderShell()
  const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(header, 'real App topbar is rendered')
  assert.match(header, /<strong>SUPA<\/strong>/)
  assert.match(header, /<span\b[^>]*class="avatar"[^>]*>ZE<\/span>/)
  assert.match(header, /role="img"/)
  assert.match(header, /aria-label="Demo-avatar"/)
  assert.match(header, /data-profile-action="none"/)
  assert.doesNotMatch(header, /<(?:button|a|input|select)\b/i)
  assert.doesNotMatch(header, /aria-label="Profiel"|aria-haspopup|aria-expanded|tabindex=/i)
})

test('product #596: real shell keeps all four functional non-submit navigation controls', () => {
  const html = renderShell()
  const nav = html.match(/<nav class="bottom-nav" aria-label="Hoofdnavigatie">([\s\S]*?)<\/nav>/)?.[1]
  assert.ok(nav, 'main navigation is accessible')
  const buttons = [...nav.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([tag]) => tag)
  assert.equal(buttons.length, 4)
  for (const button of buttons) assert.match(button, /\btype="button"/)
  assert.match(buttons[0], /aria-current="page"/)
  assert.match(buttons[0], />Planner<\/button>/)
  assert.match(buttons[1], />Mand<\/button>/)
  assert.match(buttons[2], />Lijst<\/button>/)
  assert.match(buttons[3], />Meten<\/button>/)
  assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1)
})

test('product #596: actual shell SSR remains deterministic and mounts planner content', () => {
  const first = renderShell()
  assert.equal(renderShell(), first)
  assert.match(first, /data-test-feature="planner"/)
  assert.doesNotMatch(first, /data-test-feature="basket"/)
  assert.equal((first.match(/aria-label="Demo-avatar"/g) ?? []).length, 1)
})
