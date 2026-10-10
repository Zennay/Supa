import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cssUrl = new URL('../src/features/observation/ObservationView.css', import.meta.url)

test('observation card headings contain long store names beside progress', async () => {
  const css = await readFile(cssUrl, 'utf8')

  assert.match(
    css,
    /\.observation-card-heading > div\s*{\s*min-width:\s*0;/,
  )
  assert.match(
    css,
    /\.observation-card-heading h3\s*{\s*overflow-wrap:\s*anywhere;/,
  )
  assert.match(
    css,
    /\.observation-count\s*{\s*flex:\s*0\s+0\s+auto;\s*min-width:\s*48px;/,
  )
})

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

test('overflow repair leaves existing touch and readability contracts intact', async () => {
  const css = await readFile(cssUrl, 'utf8')
  assert.match(css, /\\.observation-line summary\\s*\\{[^}]*min-height:\\s*44px;/s)
  assert.match(css, /\\.observation-line summary > div\\s*\\{[^}]*min-width:\\s*0;[^}]*overflow-wrap:\\s*anywhere;/s)
  assert.match(css, /\\.observation-card-heading h3\\s*\\{[^}]*overflow-wrap:\\s*anywhere;/s)
  assert.match(css, /\\.observation-count\\s*\\{[^}]*flex:\\s*0\\s+0\\s+auto;/s)
  assert.match(css, /\\.line-state\\s*\\{[^}]*flex:\\s*0\\s+0\\s+auto;/s)
})
