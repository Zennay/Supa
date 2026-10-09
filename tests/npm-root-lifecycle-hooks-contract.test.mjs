import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)
const blockedInstallHooks = Object.freeze([
  'preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly',
  'prepare', 'prepack', 'postpack',
])

function forbiddenLifecycleHooks(manifest) {
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return []
  return blockedInstallHooks.filter((name) => Object.hasOwn(scripts, name))
}

test('root manifest does not define npm install or packaging lifecycle hooks', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.deepEqual(forbiddenLifecycleHooks(manifest), [],
    'root lifecycle hooks can execute implicitly during install/pack/release')
})

test('npm lifecycle guard rejects implicit execution even when scripts are empty', () => {
  for (const hook of blockedInstallHooks) {
    assert.deepEqual(forbiddenLifecycleHooks({ scripts: { [hook]: '' } }), [hook])
    assert.deepEqual(forbiddenLifecycleHooks({ scripts: { build: 'vite build', [hook]: 'node task.js' } }), [hook])
  }
})

test('npm lifecycle guard preserves explicit dev, build and test commands', () => {
  assert.deepEqual(forbiddenLifecycleHooks({
    scripts: { dev: 'vite', test: 'node --test', build: 'tsc -b && vite build' },
  }), [])
  assert.deepEqual(forbiddenLifecycleHooks({}), [])
})
