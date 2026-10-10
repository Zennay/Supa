import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const plannerViewSource = await readFile(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url),
  'utf8',
)

function metaDescription(html) {
  const tag = html.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i)?.[0] ?? ''
  return tag.match(/content=["']([^"']*)["']/i)?.[1] ?? ''
}

const unsupportedSavingsClaim = /goedkoper|goedkoopste|bespaar|besparing|voordeel/i

test('public metadata explains the complete closed loop without claiming proven savings', () => {
  const description = metaDescription(indexHtml)

  assert.match(description, /plan je week/i)
  assert.match(description, /boodschappenlijst/i)
  assert.match(description, /vergelijk volledige boodschappenmanden/i)
  assert.match(description, /onzekerheid/i)
  assert.doesNotMatch(description, unsupportedSavingsClaim)
})

test('public Planner copy stays neutral until observed savings evidence exists', () => {
  assert.ok(plannerViewSource.includes('Plan eerst. Vergelijk daarna.'))
  assert.doesNotMatch(plannerViewSource, unsupportedSavingsClaim)
})
