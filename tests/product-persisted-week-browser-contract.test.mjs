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


test('real browser evidence only records localhost URLs, exact GitHub SHAs and fixture screenshots', async () => {
  const source = await readFile(browserScript, 'utf8')
  assert.match(source, /assert\.equal\(url\.hostname, '127\.0\.0\.1'/)
  assert.match(source, /assert\.equal\(url\.protocol, 'http:'/)
  assert.match(source, /assert\.match\(value \?\? '', \/\^\[a-f0-9\]\{40\}\$\/i/)
  assert.match(source, /githubRunId: process\.env\.GITHUB_RUN_ID/)
  assert.match(source, /githubRunAttempt: process\.env\.GITHUB_RUN_ATTEMPT/)
  assert.match(source, /checks\.push\('corrupt-planner-and-checklist-recover-safely'\)/)
  assert.match(source, /checks\.push\('explicit-reset-restores-week-budget-and-clears-stale-checks'\)/)
  assert.match(source, /assert\.deepEqual\(afterResetRows, canonicalDefaultShoppingRows/)
  assert.match(source, /checks\.push\('rendered-basket-list-line-count-agrees'\)/)

  for (const name of [
    'planner-changed.png',
    'basket-controlled-demo.png',
    'shopping-item-checked.png',
    'shopping-reloaded.png',
    'shopping-empty-week.png',
    'shopping-recovered-default.png',
    'shopping-explicit-reset.png',
    'shopping-reset-desktop.png',
    'shopping-reset-mobile.png',
  ]) {
    assert.ok(source.includes(`await screenshot(sessionId, '${name}')`), name)
    assert.ok(source.includes(`'${name}'`), name)
  }
  assert.match(source, /retailerDataObserved: false/)
  assert.match(source, /realSavingsClaimEligible: false/)
})

test('independent hosted browser job uses only localhost and no deployment privilege', async () => {
  const source = await readFile(
    new URL('../.github/workflows/product-persisted-week-hosted-browser.yml', import.meta.url),
    'utf8',
  )
  assert.match(source, /runs-on: ubuntu-latest/)
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/)
  assert.match(source, /command -v firefox/)
  assert.match(source, /command -v geckodriver/)
  assert.match(source, /PRODUCT_WEEK_HEAD_SHA:/)
  assert.match(source, /PRODUCT_WEEK_BASE_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(source, /PRODUCT_WEEK_WEBDRIVER_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(source, /node tests\/product-persisted-week-browser-e2e\.mjs/)
  assert.doesNotMatch(source, /\bdeploy\b|\brelease\b|curl\s+https?:\/\//i)
})


test('permanent Firefox runner denies fork PR jobs before self-hosted runner assignment (#365)', async () => {
  const source = await readFile(workflow, 'utf8')
  assert.match(source, /on:\s*\n\s*pull_request:/)
  assert.match(source, /\n\s*workflow_dispatch:/)
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/)
  assert.match(source, /persist-credentials:\s*false/)

  const jobStart = source.indexOf('  rendered-persisted-week:')
  const runnerStart = source.indexOf('    runs-on: self-hosted', jobStart)
  const stepsStart = source.indexOf('    steps:', jobStart)
  assert.ok(jobStart >= 0 && runnerStart > jobStart && stepsStart > runnerStart)

  const jobAdmission = source.slice(jobStart, runnerStart)
  const expected =
    "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"
  assert.ok(jobAdmission.includes(expected), 'same-repo/fork guard must be at JOB level before runs-on')
  assert.equal(jobAdmission.match(/\n\s*if:/g)?.length, 1)
  assert.doesNotMatch(jobAdmission, /pull_request_target/)
  assert.match(source, /timeout-minutes:\s*15/)
  assert.match(source, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
})

test('permanent Firefox fork boundary preserves trusted manual dispatch and no fork checkout loophole', async () => {
  const source = await readFile(workflow, 'utf8')
  const jobs = source.slice(source.indexOf('jobs:'))
  const head = jobs.slice(0, jobs.indexOf('    steps:'))
  assert.match(head, /github.event_name != 'pull_request' \|\| github.event.pull_request.head.repo.full_name == github.repository/)
  assert.match(source, /workflow_dispatch:/)
  assert.match(source, /runs-on: self-hosted/)
  assert.doesNotMatch(source, /pull_request_target/)
})


test('archived Firefox image evidence binds every PNG to byte length, dimensions and SHA-256', async () => {
  const source = await readFile(browserScript, 'utf8')
  assert.match(source, /createHash\('sha256'\)\.update\(png\)\.digest\('hex'\)/)
  assert.match(source, /png\.subarray\(0, 8\)\.toString\('hex'\)/)
  assert.match(source, /89504e470d0a1a0a/)
  assert.match(source, /png\.readUInt32BE\(16\)/)
  assert.match(source, /png\.readUInt32BE\(20\)/)
  assert.match(source, /screenshotIntegrity\.push\(/)
  assert.match(source, /assert\.equal\(screenshotIntegrity\.length, 9/)
  assert.match(source, /screenshotIntegrity,\n/)
  assert.match(source, /retailerDataObserved: false/)
  assert.match(source, /realSavingsClaimEligible: false/)
})


test('rendered planner and one-store basket disclose identical Dutch money and uncertainty', async () => {
  const source = await readFile(browserScript, 'utf8')
  assert.match(source, /checks\.push\('planner-basket-same-euro-and-uncertainty'\)/)
  assert.match(source, /checks\.push\('budget-only-keeps-basket-euros-unchanged'\)/)
  assert.match(source, /assert\.equal\(basketFinancial\.cost, originalPlannerCost\.knownCost/)
  assert.match(source, /assert\.equal\(basketFinancial\.disclosure,/)
  assert.match(source, /originalPlannerCost\.knownCost\.startsWith\('min\.'\)/)
  assert.match(source, /assert\.equal\(afterBudgetOnlyCost\.value, originalPlannerCost\.knownCost/)
  assert.match(source, /assert\.equal\(sameBasketCost, basketFinancial\.cost/)
  assert.match(source, /assert\.equal\(afterBudgetOnlyCost\.budgetMax, '30'\)/)
  assert.match(source, /realSavingsClaimEligible: false/)
})


test('rendered desktop/mobile viewport changes preserve the physical basket and nav contract', async () => {
  const source = await readFile(browserScript, 'utf8')
  assert.match(source, /checks\.push\('desktop-centered-shell-navigation-and-groceries'\)/)
  assert.match(source, /checks\.push\('mobile-viewport-return-preserves-exact-groceries'\)/)
  assert.match(source, /width: 960, height: 760/)
  assert.match(source, /width: 430, height: 932/)
  assert.match(source, /desktop\.scrollWidth <= desktop\.viewportClientWidth \+ 2/)
  assert.match(source, /mobile\.scrollWidth <= mobile\.viewportClientWidth \+ 2/)
  assert.match(source, /assert\.deepEqual\(mobile\.rows, canonicalDefaultShoppingRows/)
  assert.match(source, /desktop\.shellLeft - \(desktop\.viewportClientWidth - desktop\.shellWidth\)/)
  assert.match(source, /mobile\.navLeft - \(mobile\.viewportClientWidth - mobile\.navWidth\)/)
  assert.match(source, /assert\.equal\(desktop\.checkedRows, 0\)/)
  assert.match(source, /assert\.equal\(mobile\.checkedRows, 0\)/)
})
