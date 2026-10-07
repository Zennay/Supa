import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cssUrl = new URL('../src/features/observation/ObservationView.css', import.meta.url)

test('observation rows contain long ingredient copy on narrow cards', async () => {
  const css = await readFile(cssUrl, 'utf8')

  assert.match(
    css,
    /\.observation-line summary > div\s*{\s*display:\s*grid;\s*gap:\s*3px;\s*min-width:\s*0;\s*overflow-wrap:\s*anywhere;/,
  )
  assert.match(
    css,
    /\.line-state\s*{\s*flex:\s*0\s+0\s+auto;/,
  )
})
