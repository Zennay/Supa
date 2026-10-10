import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const template = readFileSync(
  new URL('../.github/pull_request_template.md', import.meta.url),
  'utf8',
)

test('PR handoff records base, exact head and current-main compatibility', () => {
  assert.match(template, /^Exact base SHA:\s*$/m)
  assert.match(template, /^Exact head SHA:\s*$/m)
  assert.match(template, /^Current `main` SHA at landing check:\s*$/m)
  assert.match(
    template,
    /^Branch relation to current `main` \(`ahead \/ behind`\):\s*$/m,
  )
  assert.match(
    template,
    /I rechecked current `main` after validation\./,
  )
  assert.match(
    template,
    /replayed\/rebased the isolated change onto current `main` and reran required exact-head validation/,
  )
})
