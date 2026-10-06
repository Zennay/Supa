import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/features/basket/BasketView.tsx', import.meta.url),
  'utf8',
)

test('basket trace exposes an accessible list container', () => {
  assert.match(
    source,
    /className="list-card" role="list" aria-label="Mandcontrole"/,
  )
})

test('every rendered basket trace row exposes listitem semantics', () => {
  const rowMap = source.match(
    /\{basketLines\.map\(\(line\) => \([\s\S]*?\)\)\}/,
  )

  assert.ok(rowMap, 'basket trace map must remain present')
  assert.match(rowMap[0], /role="listitem"/)
  assert.match(
    rowMap[0],
    /key=\{line\.id\}[\s\S]*?role="listitem"/,
    'listitem semantics must stay on each keyed trace row',
  )
})
