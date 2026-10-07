import assert from 'node:assert/strict'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

test('Vite preview fails closed instead of silently changing ports', () => {
  assert.equal(
    viteConfig.preview?.strictPort,
    true,
    'preview.strictPort must stay enabled so browser proof cannot drift to another port',
  )
})
