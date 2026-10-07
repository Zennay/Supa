import assert from 'node:assert/strict'
import test from 'node:test'

import viteConfig from '../vite.config.ts'

test('production build keeps browser sourcemaps disabled by policy', () => {
  assert.equal(
    viteConfig.build?.sourcemap,
    false,
    'production sourcemaps must stay explicitly disabled unless the release policy is intentionally changed',
  )
})
