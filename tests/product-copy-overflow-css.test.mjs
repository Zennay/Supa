import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cssUrl = new URL('../src/styles.css', import.meta.url)

test('shared product surfaces contain long store and grocery copy on narrow layouts', async () => {
  const css = await readFile(cssUrl, 'utf8')

  assert.match(
    css,
    /\.trace-row > div,\s*\.shopping-row > span:last-child,\s*\.comparison-totals > div\s*{\s*min-width:\s*0;/,
  )
  assert.match(
    css,
    /\.section-heading h2,[\s\S]*?\.shopping-row strong,[\s\S]*?\.comparison-card > strong,[\s\S]*?\.comparison-totals span\s*{\s*overflow-wrap:\s*anywhere;/,
  )
})
