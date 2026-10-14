import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Independent quality regression for #529; no workflow/owner source edits.
// The permanent M1 job is path-selected: hosted CI alone cannot prove these
// trusted retailer adapters get the required permanent source validation.
const workflow = await readFile('.github/workflows/m1-data-capture.yml', 'utf8')
const pullRequestPathBlock = /^on:\s*\n {2}pull_request:\s*\n {4}paths:\s*\n((?: {6}- [^\n]+\n)+)/m.exec(workflow)
assert.ok(pullRequestPathBlock, 'M1 must retain explicit pull_request.paths')
const paths = new Set(
  pullRequestPathBlock[1].trimEnd().split('\n').map((line) => {
    const entry = line.slice('      - '.length).trim()
    return entry.startsWith('"') ? JSON.parse(entry) : entry
  }),
)

const reviewedPairs = [
  ['PLUS product-detail', 'src/data/plusRenderedProduct.ts', 'tests/plus-rendered-product.test.mjs'],
  ['DekaMarkt product-detail', 'src/data/dekaMarktSsrProduct.ts', 'tests/dekamarkt-ssr-product.test.mjs'],
  ['PLUS listings', 'src/data/plusRenderedListings.ts', 'tests/plus-rendered-listings.test.mjs'],
  ['DekaMarkt listings', 'src/data/dekaMarktSsrListings.ts', 'tests/dekamarkt-ssr-listings.test.mjs'],
]

for (const [scope, adapter, regression] of reviewedPairs) {
  test(`QA #529: permanent M1 PR filter covers ${scope} adapter and regression`, () => {
    assert.ok(paths.has(adapter), `M1 missing required reviewed source path: ${adapter}`)
    assert.ok(paths.has(regression), `M1 missing required focused test path: ${regression}`)
  })
}

test('QA #529: edits to the adapter path contract itself retrigger M1', () => {
  assert.ok(
    paths.has('tests/qa-m1-reviewed-retailer-path-contract.test.mjs'),
    'M1 must run when its newly introduced path-coverage regression changes',
  )
})

test('QA #529 control: path analysis is scoped to the actual pull request path list', () => {
  assert.ok(paths.has('src/data/ingestion.ts'))
  assert.ok(paths.has('.github/workflows/m1-data-capture.yml'))
  assert.ok(!paths.has('workflow_dispatch:'))
})
