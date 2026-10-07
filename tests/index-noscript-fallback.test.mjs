import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(
  new URL('../index.html', import.meta.url),
  'utf8',
)

test('app shell provides one useful Dutch fallback when JavaScript is unavailable', () => {
  const noscriptBlocks = indexHtml.match(/<noscript>[\s\S]*?<\/noscript>/gi) || []

  assert.equal(noscriptBlocks.length, 1)

  const fallback = noscriptBlocks[0]
    .replace(/<\/?noscript>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  assert.match(fallback, /SUPA/)
  assert.match(fallback, /JavaScript/i)
  assert.match(fallback, /schakel/i)
  assert.match(fallback, /laad de pagina opnieuw/i)
})

test('no-JavaScript fallback does not replace the React bootstrap contract', () => {
  assert.match(indexHtml, /<div id="root"><\/div>/)
  assert.match(indexHtml, /<script type="module" src="\/src\/main\.tsx"><\/script>/)
})
