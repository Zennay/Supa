import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')

function metaDescription(html) {
  const tag = html.match(/<meta\s+[\s\S]*?name=["']description["'][\s\S]*?>/i)?.[0] ?? ''
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
}

test('public metadata describes the M3 product without claiming proven savings', () => {
  const description = metaDescription(indexHtml)

  assert.match(description, /plan je week/i)
  assert.match(description, /vergelijk boodschappenmanden/i)
  assert.match(description, /onzekerheid/i)
  assert.doesNotMatch(description, /goedkoper|bespaar|besparing|voordeel/i)
})
