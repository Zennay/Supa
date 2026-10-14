import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'ShoppingListCopyButton.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function mountedSnapshot(openedText, currentText) {
  let nextState
  // The current component binds opened text to a snapshot revision. Mount
  // the same shape that a real explicit click creates, not a legacy string.
  const initialState = openedText === null
    ? null
    : { text: openedText, revision: 0 }
  const reactHooks = {
    useId: () => 'shopping-copy-test',
    useRef: (initial) => ({ current: initial }),
    useState: () => [initialState, (update) => {
      nextState = typeof update === 'function' ? update(initialState) : update
    }],
  }
  const loaded = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    loaded, loaded.exports,
    (name) => {
      if (name === 'react') return reactHooks
      if (name === './shoppingListCopyText') {
        return { buildShoppingListCopyText: () => currentText }
      }
      if (name === './selectShoppingCopyText') {
        return { selectShoppingCopyText: () => true }
      }
      if (name.endsWith('.css')) return {}
      return require(name)
    },
  )
  const tree = loaded.exports.ShoppingListCopyButton({
    basket: {}, doneLineIds: [],
  })
  return {
    html: renderToStaticMarkup(tree),
    button: tree.props.children[0],
    getNextState: () => nextState,
  }
}

test('changed planner basket never silently opens new private shopping copy', () => {
  const old = mountedSnapshot('Boodschappenlijst oud', 'Boodschappenlijst nieuw')
  assert.match(old.html, /aria-expanded="false"/)
  assert.doesNotMatch(old.html, /<textarea|Selecteer alle tekst|Boodschappenlijst nieuw/)
  const same = mountedSnapshot('Boodschappenlijst nieuw', 'Boodschappenlijst nieuw')
  assert.match(same.html, /aria-expanded="true"/)
  assert.match(same.html, /<textarea[^>]*readOnly|<textarea/)
  assert.match(same.html, /Selecteer alle tekst/)
  assert.match(same.html, /Boodschappenlijst nieuw/)
})

test('user-initiated open and close bind the exact current copy text', () => {
  const initial = mountedSnapshot(null, 'Boodschappenlijst vandaag')
  initial.button.props.onClick()
  assert.deepEqual(initial.getNextState(), { text: 'Boodschappenlijst vandaag', revision: 0 })
  const opened = mountedSnapshot('Boodschappenlijst vandaag', 'Boodschappenlijst vandaag')
  opened.button.props.onClick()
  assert.equal(opened.getNextState(), null)
})

test('invalid copy cannot be selected or expanded even if stale export was open', () => {
  const invalid = mountedSnapshot('vorige lijst', null)
  assert.match(invalid.html, /disabled/)
  assert.match(invalid.html, /nog niet veilig worden gekopieerd/)
  assert.doesNotMatch(invalid.html, /<textarea|Selecteer alle tekst/)
  invalid.button.props.onClick()
  assert.equal(invalid.getNextState(), undefined)
})
