import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Vite keeps the React plugin wired into the production config', async () => {
  const config = await readFile('vite.config.ts', 'utf8')

  assert.match(
    config,
    /import\s+react\s+from\s+['"]@vitejs\/plugin-react['"]/,
    'vite.config.ts must keep the canonical @vitejs/plugin-react import',
  )

  const pluginList = config.match(/plugins\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
  assert.match(
    pluginList,
    /\breact\s*\(\s*\)/,
    'the exported Vite config must invoke react() in its plugins list',
  )

  const reactPluginCalls = pluginList.match(/\breact\s*\(\s*\)/g) ?? []
  assert.equal(
    reactPluginCalls.length,
    1,
    'the Vite plugins list must contain exactly one React plugin invocation',
  )
})
