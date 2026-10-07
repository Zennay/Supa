import assert from 'node:assert/strict'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

test('production build keeps source maps explicitly disabled', () => {
  assert.equal(
    viteConfig.build?.sourcemap,
    false,
    'production source maps must stay disabled instead of relying on a bundler default',
  )
})
