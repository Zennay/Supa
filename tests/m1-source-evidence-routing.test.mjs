import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL(
  '../.github/workflows/m1-data-capture.yml',
  import.meta.url,
)

test('M1 VPS validation watches the complete source-evidence parser graph', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  for (const path of [
    'src/data/plusRenderedProduct.ts',
    'src/data/plusRenderedListings.ts',
    'src/data/dekaMarktSsrProduct.ts',
    'src/data/dekaMarktSsrListings.ts',
    'tests/plus-rendered-product.test.mjs',
    'tests/plus-rendered-listings.test.mjs',
    'tests/dekamarkt-ssr-product.test.mjs',
    'tests/dekamarkt-ssr-listings.test.mjs',
    'tests/source-evidence-integer-integrity.test.mjs',
    'tests/m1-source-evidence-routing.test.mjs',
    'fixtures/m1/**',
  ]) {
    assert.ok(
      workflow.includes(`- "${path}"`),
      `M1 workflow must trigger for ${path}`,
    )
  }

  assert.ok(workflow.includes('runs-on: self-hosted'))
  assert.ok(workflow.includes('test "$(hostname -s)" = "vps-bb300bba"'))
  assert.ok(workflow.includes('run: npm test'))
  assert.ok(workflow.includes('run: npm run m1:matching-benchmark'))
})
