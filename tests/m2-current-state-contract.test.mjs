import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const docUrl = new URL('../docs/M2_CORE_PLANNER_SLICE.md', import.meta.url)

test('M2 continuity doc keeps the closed milestone boundary explicit', async () => {
  const content = await readFile(docUrl, 'utf8')

  assert.match(content, /## Milestone status — closed/)
  assert.match(content, /M2 is technically closed on `main`/)
  assert.match(content, /rendered\s+Firefox\/geckodriver proof on the permanent VPS/)
  assert.match(content, /Do not reopen M2 for speculative feature work/)
  assert.match(content, /controlled fixture remains a\s+proof harness, not live-price evidence or a savings claim/)
  assert.match(content, /Current product proof\s+work belongs to M3/)
  assert.doesNotMatch(content, /Exit criteria still open/)
})
