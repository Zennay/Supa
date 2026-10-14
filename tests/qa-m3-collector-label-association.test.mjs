import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent M3 collector QA: inspect the *actual TSX label tree* rather than
// searching the entire rendered page for a label followed by a field name.
// A page-wide regex can pass when labels have been swapped between controls.
const collectorSource = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)

function attribute(node, name, file) {
  const value = node.attributes?.properties?.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText(file) === name,
  )?.initializer
  return value && ts.isStringLiteral(value) ? value.text : null
}

function labelControls(source) {
  const file = ts.createSourceFile(
    'ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )
  assert.equal(file.parseDiagnostics.length, 0, 'collector TSX must parse')
  const result = []

  function scan(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'label') {
      const fields = []
      const texts = []
      const hints = []

      function inside(child) {
        if (ts.isJsxText(child)) texts.push(child.getText(file).trim())
        if (ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) {
          const kind = attribute(child, 'data-observation-study-field', file) !== null
            ? 'study'
            : attribute(child, 'data-observation-store-field', file) !== null
              ? 'store'
              : null
          if (kind) {
            fields.push({
              kind,
              key: attribute(child, 'data-observation-' + kind + '-field', file),
              tag: child.tagName.getText(file),
              type: attribute(child, 'type', file),
              autoComplete: attribute(child, 'autoComplete', file),
            })
          }
          if (child.tagName.getText(file) === 'small' &&
              attribute(child, 'className', file) === 'observation-field-hint') {
            hints.push(child.parent.getText(file))
          }
        }
        ts.forEachChild(child, inside)
      }

      node.children.forEach(inside)
      result.push({
        fields,
        label: texts.filter(Boolean).join(' ').replace(/\s+/g, ' '),
        hints,
      })
    }
    ts.forEachChild(node, scan)
  }

  scan(file)
  return result
}

function singleFieldLabel(labels, kind, key, expectedName) {
  const matches = labels.filter((label) =>
    label.fields.some((field) => field.kind === kind && field.key === key),
  )
  assert.equal(matches.length, 1, kind + '/' + key + ' has exactly one owning label')
  assert.equal(matches[0].fields.length, 1, kind + '/' + key + ' does not nest other fields')
  assert.ok(
    matches[0].label.startsWith(expectedName),
    kind + '/' + key + ' must be labelled "' + expectedName + '", got "' + matches[0].label + '"',
  )
  return matches[0]
}

test('actual M3 collector keeps each Dutch study label attached to its own canonical control', () => {
  const labels = labelControls(collectorSource)
  for (const [key, name] of [
    ['studyId', 'Metingcode'],
    ['participantKey', 'Anonieme deelnemerscode'],
    ['population', 'Doelgroep'],
    ['region', 'Gebied'],
    ['priceContext', 'Hoe zijn de prijzen gemeten?'],
    ['weekStart', 'Startdatum van je planweek'],
  ]) {
    singleFieldLabel(labels, 'study', key, name)
  }

  const context = singleFieldLabel(labels, 'study', 'priceContext', 'Hoe zijn de prijzen gemeten?')
  assert.equal(context.fields[0].tag, 'select')
  const week = singleFieldLabel(labels, 'study', 'weekStart', 'Startdatum van je planweek')
  assert.equal(week.fields[0].type, 'date')
})

test('both store sections use one semantically correct label per canonical field', () => {
  const labels = labelControls(collectorSource)
  for (const [key, name] of [
    ['name', 'Winkelnaam'],
    ['id', 'Vestigingscode'],
    ['evidenceId', 'Code van deze winkelmeting'],
    ['observedAt', 'Geobserveerd op'],
    ['provenanceNote', 'Hoe heb je de prijzen vastgelegd?'],
  ]) {
    singleFieldLabel(labels, 'store', key, name)
  }
  const observed = singleFieldLabel(labels, 'store', 'observedAt', 'Geobserveerd op')
  assert.equal(observed.fields[0].type, 'datetime-local')
})

test('privacy warnings belong to participant and source-note fields, not unrelated controls', () => {
  const labels = labelControls(collectorSource)
  const person = singleFieldLabel(labels, 'study', 'participantKey', 'Anonieme deelnemerscode')
  assert.equal(person.fields[0].autoComplete, 'off')
  assert.equal(person.hints.length, 1)
  assert.match(person.hints[0], /geen naam of e-mailadres/)
  const source = singleFieldLabel(labels, 'store', 'provenanceNote', 'Hoe heb je de prijzen vastgelegd?')
  assert.equal(source.hints.length, 1)
  assert.match(source.hints[0], /geen persoonsgegevens/)
  for (const label of labels) {
    if (label !== person && label !== source) assert.equal(label.hints.length, 0)
  }
})

test('independent JSX ownership check catches swapped labels that page-wide regex misses', () => {
  const swapped = labelControls(
    'const Example = () => <>' +
    '<label>Vestigingscode<input data-observation-store-field="evidenceId" /></label>' +
    '<label>Code van deze winkelmeting<input data-observation-store-field="id" /></label>' +
    '</>',
  )
  assert.throws(
    () => singleFieldLabel(swapped, 'store', 'id', 'Vestigingscode'),
    /must be labelled/,
  )
  assert.throws(
    () => singleFieldLabel(swapped, 'store', 'evidenceId', 'Code van deze winkelmeting'),
    /must be labelled/,
  )
})
