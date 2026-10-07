import assert from 'node:assert/strict'
import test from 'node:test'

import { requireAppRoot } from '../src/lib/appRoot.ts'

test('requireAppRoot returns the provided canonical root element', () => {
  const root = { id: 'root' }

  assert.equal(requireAppRoot(root), root)
})

test('requireAppRoot fails explicitly when the canonical root is missing', () => {
  assert.throws(
    () => requireAppRoot(null),
    /SUPA app root #root is missing/,
  )
})
