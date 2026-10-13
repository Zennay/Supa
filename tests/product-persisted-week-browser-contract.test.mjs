import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const browserScript = new URL('./product-persisted-week-browser-e2e.mjs', import.meta.url)
const workflow = new URL('../.github/workflows/product-persisted-week-vps.yml', import.meta.url)

test('isolated persistent-week Firefox scenario parses on hosted Node without a VPS', () => {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(browserScript)], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
})

test('Firefox scenario includes reload, empty week and explicit no-live-savings boundaries', async () => {
  const source = await readFile(browserScript, 'utf8')

  assert.match(source, /checks\.push\('persisted-reload-restores-checklist'\)/)
  assert.match(source, /checks\.push\('budget-only-preserves-checklist'\)/)
  assert.match(source, /checks\.push\('recipe-change-invalidates-old-checks'\)/)
  assert.match(source, /checks\.push\('intentionally-empty-week-persists-without-phantom-groceries'\)/)
  assert.match(source, /geen live-besparingsclaim/)
  assert.match(source, /realSavingsClaimEligible: false/)
  assert.match(source, /retailerDataObserved: false/)

  // Script-argument values cannot be interpolated by Node outside of WebDriver.
  assert.equal(source.includes('${arguments[0]}'), false)
})

test('dedicated browser job never promotes permission, release or external retailer access', async () => {
  const source = await readFile(workflow, 'utf8')
  assert.match(source, /runs-on:\s*self-hosted/)
  assert.match(source, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/)
  assert.match(source, /PRODUCT_WEEK_BASE_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(source, /PRODUCT_WEEK_WEBDRIVER_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(source, /node tests\/product-persisted-week-browser-e2e\.mjs/)
  assert.match(source, /kill "\$preview_pid" "\$driver_pid"/)
  assert.doesNotMatch(source, /\bdeploy\b|\brelease\b|curl\s+https?:\/\//i)
})
