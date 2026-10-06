import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const architecture = await readFile('docs/ARCHITECTURE.md', 'utf8')

test('architecture notes stay aligned with the current M3 executable state', () => {
  assert.match(architecture, /closed the bounded M1 data-feasibility gate/)
  assert.match(architecture, /M2 planner-to-basket vertical slice/)
  assert.match(architecture, /repository is now in M3/i)
  assert.match(architecture, /observation collection/)
  assert.match(architecture, /source-specific normalization\/adapters/)
  assert.match(architecture, /Production automated retailer-data reuse[^\n]+permission-gated/)

  assert.doesNotMatch(architecture, /currently supplies mock fixtures\. It will become/)
  assert.doesNotMatch(architecture, /gated by M1\/M2 evidence/)
})
