import assert from 'node:assert/strict'
import test from 'node:test'

import { requireAppRoot } from '../src/lib/appRoot.ts'

test('requireAppRoot returns the canonical root element', () => {
  const root = { id: 'root' }
  const requestedIds = []
  const documentLike = {
    getElementById(id) {
      requestedIds.push(id)
      return root
    },
  }

  assert.equal(requireAppRoot(documentLike), root)
  assert.deepEqual(requestedIds, ['root'])
})

test('requireAppRoot fails explicitly when the canonical root is missing', () => {
  const documentLike = {
    getElementById() {
      return null
    },
  }

  assert.throws(
    () => requireAppRoot(documentLike),
    /SUPA app root #root is missing/,
  )
})
