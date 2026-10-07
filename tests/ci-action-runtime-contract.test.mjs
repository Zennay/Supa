import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

const expectedPins = [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
]

test('hosted CI keeps GitHub-maintained actions on reviewed Node 24 runtime releases', () => {
  for (const pin of expectedPins) {
    assert.equal(
      workflow.split(pin).length - 1,
      1,
      `expected exactly one immutable hosted-CI action pin: ${pin}`,
    )
  }

  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d+/)
  assert.doesNotMatch(
    workflow,
    /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/,
  )
  assert.doesNotMatch(
    workflow,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/,
  )
})

test('action runtime maintenance preserves project Node and credential boundaries', () => {
  assert.match(workflow, /persist-credentials:\s*false/)
  assert.match(workflow, /node-version:\s*22\b/)
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/)
})
