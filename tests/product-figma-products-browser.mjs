import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Real browser acceptance of the Figma 3064:3125 Producten route.
// Example prices are demo-only; this test must not request any retailer.
await mkdir('artifacts/product-ui', { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:4174')
  await page.getByRole('button', { name: 'Producten', exact: true }).click()
  await page.locator('[data-figma-node="3064:3125"]').waitFor()
  assert.equal(await page.locator('.hifi-product-card').count(), 4)
  assert.match(await page.locator('.hifi-demo-note').innerText(), /prijzen en aanbiedingen zijn niet actueel/)
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))))
  assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), true)
  await page.screenshot({ path: 'artifacts/product-ui/products-440.png', fullPage: true })

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const unitFilter = page.getByLabel('Filter producten op eenheid')
  await unitFilter.selectOption('l')
  assert.equal(await page.locator('.hifi-product-card').count(), 3)
  await page.getByRole('button', { name: 'Sorteer voorbeeldproducten op laagste prijs per kg of liter' }).click()
  assert.equal(await page.locator('.hifi-product-card h3').first().innerText(), 'Coca Cola Regular 1,5 liter fles')
  assert.equal(await page.locator('.hifi-product-sort').getAttribute('aria-pressed'), 'true')

  await page.getByRole('button', { name: 'Favoriet: Coca Cola Regular 1,5 liter fles' }).click()
  await page.getByRole('checkbox', { name: 'Alleen favorieten' }).check()
  assert.equal(await page.locator('.hifi-product-card').count(), 1)
  await page.getByRole('button', { name: 'Wis filters' }).click()
  assert.equal(await page.locator('.hifi-product-card').count(), 4)
  await page.getByRole('button', { name: 'Voeg toe: Coca Cola Regular 1,5 liter fles' }).click()
  await page.getByRole('button', { name: 'Lijst', exact: true }).click()
  assert.match(await page.locator('.hifi-demo-list').innerText(), /Coca Cola Regular/)
  assert.match(await page.locator('.hifi-demo-list').innerText(), /Demolijst · geen actuele prijzen/)

  await page.getByRole('button', { name: 'Producten', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 800 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: 'artifacts/product-ui/products-320.png', fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile('artifacts/product-ui/result.json', JSON.stringify({
    status: 'passed',
    checks: [
      'Figma Products route and four demo cards',
      'all original local assets load',
      'L/kg unit filter',
      'numeric comparable unit sort',
      'favorite-only filter + reset',
      'demo list isolation',
      '320px overflow',
      'no browser exceptions',
    ],
  }, null, 2))
} finally {
  await browser.close()
}
