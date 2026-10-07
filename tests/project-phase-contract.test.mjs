import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('README keeps the current M3 proof gate and anti-scope-creep boundary explicit', async () => {
  const readme = await readFile('README.md', 'utf8')

  assert.match(readme, /M3 — Full-basket comparison & savings proof/i)
  assert.match(readme, /same-demand \*\*PLUS \+ DekaMarkt\*\*/i)
  assert.match(readme, /within 24 hours/i)
  assert.match(readme, /one shared price context/i)
  assert.match(readme, /issue #78/i)
  assert.match(
    readme,
    /Until that field run exposes a concrete failure, do not add more M3 collector features/i,
  )
  assert.match(
    readme,
    /Better, same, worse and unknown are all valid M3 outcomes/i,
  )
  assert.match(
    readme,
    /One observed week must not be generalized into a public savings claim/i,
  )
  assert.match(
    readme,
    /Production automated retailer-data reuse remains separately permission-gated/i,
  )
})
