import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { observationPriceCents } from '../src/features/observation/observationCollectionUi.ts'

// Execute the REAL TSX component's onFocus/onChange/onBlur closures under a
// minimal deterministic hook scheduler. No browser, network or retailer access.
// Unlike a regex or pure-parser check, this observes state and callback writes.
const require = createRequire(import.meta.url)
const jsx = require('react/jsx-runtime')

function componentHarness(fileName, exportName, dependencies = {}) {
  const source = readFileSync(
    new URL('../src/features/observation/' + fileName, import.meta.url), 'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName, reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [], fileName + ' must type-transpile')
  const slots = []
  let cursor = 0
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!Object.hasOwn(slots, index)) slots[index] = initial
      return [slots[index], next => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }]
    },
    useId() { return ':qa-price-' + cursor + ':' },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, (name) => {
      if (name === 'react') return hooks
      if (name === 'react/jsx-runtime') return jsx
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error('Unexpected source import in actual field: ' + name)
    },
  )
  const Component = module.exports[exportName]
  assert.equal(typeof Component, 'function')

  function find(root, predicate) {
    if (Array.isArray(root)) {
      for (const child of root) {
        const match = find(child, predicate)
        if (match) return match
      }
      return null
    }
    if (typeof root !== 'object' || root === null) return null
    if (predicate(root)) return root
    return find(root.props?.children, predicate)
  }

  return {
    exports: module.exports,
    render(props) {
      cursor = 0
      const root = Component(props)
      const input = find(root, node => node.type === 'input')
      assert.ok(input, fileName + ' must render an actual input')
      const status = find(root, node => node.props?.role === 'status')
      return { input: input.props, status: status?.props ?? null }
    },
  }
}

const CONFIG = [
  {
    title: 'PLUS pack price',
    file: 'ObservationPriceInput.tsx',
    name: 'ObservationPriceInput',
    initial: 249,
    initialText: '2,49',
    property: 'priceCents',
    change: 'onPriceChange',
    invalid: ['2,', '2,499', '1e3', '-1'],
    valid: ['3,49', 349],
    clear: true,
  },
  {
    title: 'DekaMarkt pack quantity',
    file: 'ObservationPackAmountInput.tsx',
    name: 'ObservationPackAmountInput',
    initial: 0.75,
    initialText: '0,75',
    property: 'amount',
    change: 'onAmountChange',
    invalid: ['2,', '1e3', '0', '-1'],
    valid: ['1,25', 1.25],
    clear: true,
  },
  {
    title: 'PLUS item count',
    file: 'ObservationPackCountInput.tsx',
    name: 'ObservationPackCountInput',
    initial: 2,
    initialText: '2',
    property: 'count',
    change: 'onCountChange',
    invalid: ['2,9', '1e2', '0', '-1', ''],
    valid: ['3', 3],
    clear: false,
  },
]

for (const config of CONFIG) {
  test('QA independent live ' + config.title +
    ': invalid blur never overwrites a human M3 measurement', () => {
    const updates = []
    const props = {
      [config.property]: config.initial,
      label: config.title + ' · gemeten verpakking',
      [config.change](value) {
        updates.push(value)
        props[config.property] = value
      },
    }
    const extras = config.file === 'ObservationPriceInput.tsx'
      ? { './observationCollectionUi.ts': { observationPriceCents } } : {}
    const harness = componentHarness(config.file, config.name, extras)
    let screen = harness.render(props)
    assert.equal(screen.input.value, config.initialText)
    assert.equal(screen.input['aria-invalid'], false)
    assert.equal(screen.status, null)

    for (const typed of config.invalid) {
      screen.input.onFocus()
      screen = harness.render(props)
      assert.equal(screen.input.value, config.initialText)
      screen.input.onChange({ target: { value: typed } })
      screen = harness.render(props)
      assert.equal(screen.input.value, typed)
      if (typed !== '') assert.equal(screen.input['aria-invalid'], true)
      screen.input.onBlur({ currentTarget: { value: typed } })
      screen = harness.render(props)
      assert.equal(props[config.property], config.initial, typed)
      assert.deepEqual(updates, [], typed + ' must not trigger canonical autosave')
      assert.equal(screen.input.value, config.initialText,
        'after rejected blur show previously saved human observation')
      assert.equal(screen.input['aria-invalid'], true)
      assert.ok(screen.status && screen.input['aria-describedby'],
        'screen reader gets non-destructive input error')
      assert.match(String(screen.status.children).replaceAll(',', ' '), /Ongeldige invoer is niet opgeslagen/)
    }

    screen.input.onFocus()
    screen = harness.render(props)
    assert.equal(screen.input['aria-invalid'], false)
    screen.input.onChange({ target: { value: config.valid[0] } })
    screen = harness.render(props)
    assert.equal(screen.input.value, config.valid[0])
    screen.input.onBlur({ currentTarget: { value: config.valid[0] } })
    screen = harness.render(props)
    assert.deepEqual(updates, [config.valid[1]], 'valid blur persists exactly once')
    assert.equal(props[config.property], config.valid[1])
    assert.equal(screen.input['aria-invalid'], false)

    // Reblurring an unchanged value must not cause a redundant storage write.
    screen.input.onFocus()
    screen = harness.render(props)
    screen.input.onBlur({ currentTarget: { value: screen.input.value } })
    assert.deepEqual(updates, [config.valid[1]])

    if (config.clear) {
      screen = harness.render(props)
      screen.input.onFocus()
      screen = harness.render(props)
      screen.input.onChange({ target: { value: '' } })
      screen = harness.render(props)
      screen.input.onBlur({ currentTarget: { value: '' } })
      screen = harness.render(props)
      assert.deepEqual(updates, [config.valid[1], null],
        'only an intentionally blank price/amount clears saved evidence')
      assert.equal(screen.input.value, '')
    }
  })
}

test('QA M3: 10,000 exact cent amounts round-trip edit display to canonical integer cents', () => {
  const harness = componentHarness(
    'ObservationPriceInput.tsx', 'ObservationPriceInput',
    { './observationCollectionUi.ts': { observationPriceCents } },
  )
  const { observationEditablePriceText, observationPriceEditDecision } = harness.exports
  for (let cents = 0; cents < 10_000; cents++) {
    const display = observationEditablePriceText(cents)
    assert.deepEqual(observationPriceEditDecision(display), { kind: 'accept', value: cents },
      'lossless Dutch euro-cent representation for ' + cents)
    assert.deepEqual(observationPriceEditDecision(display.replace(',', '.')),
      { kind: 'accept', value: cents })
  }
  for (const cents of [100_001, 9_999_999, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(
      observationPriceEditDecision(observationEditablePriceText(cents)),
      { kind: 'accept', value: cents },
      'safe integer upper bound must never silently round cents',
    )
  }
})
