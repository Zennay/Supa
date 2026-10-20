import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const baseUrl = process.env.PRODUCT_WEEK_BASE_URL ?? 'http://127.0.0.1:4179'
const driverUrl = process.env.PRODUCT_WEEK_WEBDRIVER_URL ?? 'http://127.0.0.1:4457'
const artifactDirectory = process.env.PRODUCT_WEEK_ARTIFACT_DIR ?? 'artifacts/product-week-browser'
const screenshotIntegrity = []

for (const [label, raw] of [['app', baseUrl], ['webdriver', driverUrl]]) {
  const url = new URL(raw)
  assert.equal(url.protocol, 'http:', `${label} must use isolated HTTP`)
  assert.equal(url.hostname, '127.0.0.1', `${label} must be localhost-only`)
  assert.ok(url.port, `${label} must use an explicit isolated local port`)
  assert.equal(url.username, '', `${label} must not contain credentials`)
  assert.equal(url.password, '', `${label} must not contain credentials`)
  assert.equal(url.search, '', `${label} must not contain query parameters`)
  assert.equal(url.hash, '', `${label} must not contain fragments`)
  assert.equal(url.pathname, '/', `${label} must target only the local origin`)
}

if (process.env.GITHUB_ACTIONS === 'true') {
  for (const [label, value] of [
    ['checkout SHA', process.env.GITHUB_SHA],
    ['PR/source SHA', process.env.PRODUCT_WEEK_HEAD_SHA],
  ]) {
    assert.match(value ?? '', /^[a-f0-9]{40}$/i, `${label} must identify an exact git commit`)
  }
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/, 'GitHub run id required')
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/, 'GitHub attempt required')
}

async function request(endpoint, init = {}) {
  const response = await fetch(driverUrl + endpoint, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await response.json()
  if (!response.ok || body.value?.error) {
    throw new Error(`WebDriver ${endpoint}: ${body.value?.error ?? response.status}`)
  }
  return body.value
}

async function script(sessionId, code, args = []) {
  return request(`/session/${sessionId}/execute/sync`, {
    method: 'POST',
    body: JSON.stringify({ script: code, args }),
  })
}

async function screenshot(sessionId, name) {
  const encoded = await request(`/session/${sessionId}/screenshot`)
  assert.equal(typeof encoded, 'string', 'Firefox screenshot must be base64')
  assert.match(encoded, /^[a-zA-Z0-9+/]+={0,2}$/, 'Firefox screenshot encoding is malformed')
  const png = Buffer.from(encoded, 'base64')
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
    'Firefox screenshot must be a PNG image')
  assert.ok(png.byteLength >= 24, 'PNG must contain image dimensions')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  assert.ok(width > 0 && width <= 10000 && height > 0 && height <= 10000,
    'Screenshot dimensions must be reasonable')
  await writeFile(`${artifactDirectory}/${name}`, png, { mode: 0o600 })
  screenshotIntegrity.push({
    filename: name,
    width,
    height,
    bytes: png.byteLength,
    sha256: createHash('sha256').update(png).digest('hex'),
  })
}

async function until(sessionId, code, expectedDescription) {
  for (let tries = 0; tries < 80; tries++) {
    const value = await script(sessionId, code)
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Expected UI state not reached: ${expectedDescription}`)
}

async function changeRecipe(sessionId, day, recipeId) {
  assert.equal(await script(sessionId, `
    const field = document.getElementById(arguments[0])
    if (!field) return false
    field.value = arguments[1]
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return field.value === arguments[1]
  `, [`recipe-${day}`, recipeId]), true)
}

async function clickButton(sessionId, selector, expected) {
  const result = await script(sessionId, `
    const found = [...document.querySelectorAll(arguments[0])]
      .find((button) => button.textContent?.trim() === arguments[1])
    if (!found) return false
    found.click()
    return true
  `, [selector, expected])
  assert.equal(result, true, `Cannot find button "${expected}" in ${selector}`)
}

async function nav(sessionId, target) {
  await clickButton(sessionId, 'nav.bottom-nav button', target)
  await until(sessionId, `
    return [...document.querySelectorAll('nav.bottom-nav button')]
      .some((button) => button.textContent?.trim() === ${JSON.stringify(target)} &&
        button.getAttribute('aria-current') === 'page')
  `, `navigation to ${target}`)
}

await mkdir(artifactDirectory, { recursive: true })

const capabilities = {
  capabilities: {
    alwaysMatch: {
      browserName: 'firefox',
      acceptInsecureCerts: false,
      'moz:firefoxOptions': { args: ['-headless', '--width=430', '--height=932'] },
    },
  },
}
const created = await request('/session', { method: 'POST', body: JSON.stringify(capabilities) })
const sessionId = created?.sessionId
assert.ok(sessionId, 'Firefox did not return a WebDriver session ID')
const checks = []

try {
  await request(`/session/${sessionId}/url`, {
    method: 'POST',
    body: JSON.stringify({ url: baseUrl }),
  })
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("4 maaltijden actief")',
    'initial four-meal week',
  )
  checks.push('initial-planner-render')

  await changeRecipe(sessionId, 'Di', 'pasta')
  await changeRecipe(sessionId, 'Do', 'teriyaki')
  for (const day of ['Ma', 'Wo']) {
    assert.equal(await script(sessionId, `
      const button = document.querySelector('[aria-label="${day} uit planning halen"]')
      if (!button) return false
      button.click()
      return true
    `), true)
  }
  await script(sessionId, `
    const budget = document.querySelectorAll('.budget-options button')[2]
    if (!budget) return false
    budget.click()
    return true
  `)
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("2 maaltijden actief")',
    'updated two-meal week',
  )
  const stored = await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    if (!raw) return null
    const p = JSON.parse(raw)
    return p.budget === 40 &&
      p.activeDays.length === 2 && p.activeDays.includes('Di') && p.activeDays.includes('Do') &&
      p.recipeByDay.Di === 'pasta' && p.recipeByDay.Do === 'teriyaki'
  `, 'saved 2-day/40 euro preferences')
  assert.equal(stored, true)
  const originalPlannerCost = await script(sessionId, `
    const summary = document.querySelector('.budget-summary strong')
    const status = document.querySelector('.budget-heading .budget-status')
    const progress = document.querySelector('.budget-progress')
    return summary && status && progress ? {
      knownCost: summary.textContent.trim(),
      budgetStatus: status.textContent.trim(),
      amount: progress.getAttribute('aria-valuenow'),
      max: progress.getAttribute('aria-valuemax'),
      label: progress.getAttribute('aria-label'),
    } : null
  `)
  assert.ok(originalPlannerCost, 'planner budget disclosure missing after saved week')
  assert.equal(originalPlannerCost.max, '40')
  assert.match(originalPlannerCost.knownCost, /€\s*[0-9]/)
  if (originalPlannerCost.knownCost.startsWith('min.')) {
    assert.match(originalPlannerCost.budgetStatus, /mandregels? open/)
    assert.equal(originalPlannerCost.label, 'Bekend minimum van het weekbudget')
  } else {
    assert.equal(originalPlannerCost.label, 'Gepland deel van het weekbudget')
  }
  checks.push('edited-planner-saved')
  await screenshot(sessionId, 'planner-changed.png')

  await nav(sessionId, 'Mand')
  await until(sessionId,
    'return document.querySelector(".comparison-card")?.textContent.includes("geen live-besparingsclaim")',
    'controlled fixture comparison disclaimer',
  )
  const basketLineCount = await script(sessionId,
    'return document.querySelectorAll(".list-card .trace-row").length')
  assert.ok(basketLineCount > 0)
  const basketFinancial = await script(sessionId, `
    const total = document.querySelector('.hero-total > strong')
    const container = document.querySelector('.hero-total')
    return total && container ? {
      cost: total.textContent.trim(),
      disclosure: container.dataset.basketTotalState,
    } : null
  `)
  assert.ok(basketFinancial, 'full basket financial disclosure missing')
  assert.equal(basketFinancial.cost, originalPlannerCost.knownCost,
    'planner and basket must display the identical euro amount, not different estimates')
  assert.equal(basketFinancial.disclosure,
    originalPlannerCost.knownCost.startsWith('min.') ? 'minimum' : 'complete',
    'planner and basket must describe any partial cost with the same honesty')
  checks.push('planner-basket-same-euro-and-uncertainty')
  checks.push('basket-price-claim-boundary')
  await screenshot(sessionId, 'basket-controlled-demo.png')

  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'populated checklist',
  )
  const shoppingLineCount = await script(sessionId,
    'return document.querySelectorAll("button.shopping-row").length')
  assert.equal(shoppingLineCount, basketLineCount,
    'real basket and shopping list must have the same physical ingredient rows')
  checks.push('rendered-basket-list-line-count-agrees')
  const row = await script(sessionId, `
    const line = document.querySelector('button.shopping-row')
    line.click()
    return line.textContent
  `)
  assert.equal(typeof row, 'string')
  await until(sessionId, `
    const line = document.querySelector('button.shopping-row')
    const raw = localStorage.getItem('supa:shopping-list-progress:v1')
    if (!line || !raw) return false
    return line.classList.contains('checked') && JSON.parse(raw).doneLineIds.length === 1
  `, 'saved checked item')
  checks.push('checklist-saved')
  await screenshot(sessionId, 'shopping-item-checked.png')

  await request(`/session/${sessionId}/refresh`, { method: 'POST', body: '{}' })
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("2 maaltijden actief")',
    'restored two-meal week',
  )
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelector("button.shopping-row")?.classList.contains("checked")',
    'restored checked item',
  )
  checks.push('persisted-reload-restores-checklist')
  await screenshot(sessionId, 'shopping-reloaded.png')

  await nav(sessionId, 'Planner')
  assert.equal(await script(sessionId, `
    const budget = document.querySelectorAll('.budget-options button')[0]
    if (!budget) return false
    budget.click()
    return true
  `), true)
  await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    return raw && JSON.parse(raw).budget === 30
  `, 'budget-only edit saved')
  const afterBudgetOnlyCost = await script(sessionId, `
    return {
      value: document.querySelector('.budget-summary strong')?.textContent.trim(),
      budgetMax: document.querySelector('.budget-progress')?.getAttribute('aria-valuemax'),
      budgetStatus: document.querySelector('.budget-heading .budget-status')?.textContent.trim(),
    }
  `)
  assert.equal(afterBudgetOnlyCost.value, originalPlannerCost.knownCost,
    'budget-only preference must not change the physical grocery cost')
  assert.equal(afterBudgetOnlyCost.budgetMax, '30')
  await nav(sessionId, 'Mand')
  const sameBasketCost = await script(sessionId,
    'return document.querySelector(".hero-total > strong")?.textContent.trim()')
  assert.equal(sameBasketCost, basketFinancial.cost,
    'budget-only edit must not change the real rendered basket calculation')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelector("button.shopping-row")?.classList.contains("checked")',
    'budget-only change kept checked item',
  )
  checks.push('budget-only-preserves-checklist')
  checks.push('budget-only-keeps-basket-euros-unchanged')

  await nav(sessionId, 'Planner')
  await changeRecipe(sessionId, 'Di', 'tikka')
  await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    return raw && JSON.parse(raw).recipeByDay.Di === 'tikka'
  `, 'new recipe persisted')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'new recipe checklist ready',
  )
  const anyChecked = await script(sessionId,
    'return !!document.querySelector("button.shopping-row.checked")')
  assert.equal(anyChecked, false, 'stale checked state leaked into a different physical basket')
  checks.push('recipe-change-invalidates-old-checks')


  // Explicitly empty planning is a valid user choice; never resurrect old groceries.
  await nav(sessionId, 'Planner')
  for (const day of ['Di', 'Do']) {
    const removed = await script(sessionId, `
      const button = document.querySelector('[aria-label="' + arguments[0] + ' uit planning halen"]')
      if (!button) return false
      button.click()
      return true
    `, [day])
    assert.equal(removed, true, `could not deactivate ${day}`)
  }
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("0 maaltijden actief")',
    'all meals disabled',
  )
  await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    return raw && JSON.parse(raw).activeDays.length === 0
  `, 'empty week persisted')
  // The underlying empty-week financial headline is a known upstream defect (#1051).
  // Assert zero physical basket lines only; do not normalize a claimable comparison
  // while comparator owner PR #1012 is still unmerged.
  await nav(sessionId, 'Mand')
  await until(sessionId,
    'return document.querySelector(".hero-total")?.textContent.includes("0,00") && document.querySelectorAll(".list-card .trace-row").length === 0',
    'zero-cost physical basket without phantom lines',
  )
  await nav(sessionId, 'Lijst')
  const emptyList = await script(sessionId,
    'return document.querySelectorAll("button.shopping-row").length')
  assert.equal(emptyList, 0, 'empty week must not show stale groceries')
  await request(`/session/${sessionId}/refresh`, { method: 'POST', body: '{}' })
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("0 maaltijden actief")',
    'empty week restored after refresh',
  )
  await nav(sessionId, 'Lijst')
  assert.equal(await script(sessionId,
    'return document.querySelectorAll("button.shopping-row").length'), 0)
  checks.push('intentionally-empty-week-persists-without-phantom-groceries')
  await screenshot(sessionId, 'shopping-empty-week.png')

  // Genuine browser recovery: broken local planner and checklist storage
  // must never crash the app, resurrect checked rows or create retail claims.
  await script(sessionId, `
    localStorage.setItem('supa:planner-preferences:v2', '{broken-json')
    localStorage.setItem('supa:shopping-list-progress:v1', '{broken-json')
    return true
  `)
  await request(`/session/${sessionId}/refresh`, { method: 'POST', body: '{}' })
  await until(sessionId,
    'return document.querySelector(".screen")?.textContent.includes("4 maaltijden actief")',
    'corrupt saved week recovered to deterministic default',
  )
  const recoveredPreferences = await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    try {
      const saved = JSON.parse(raw)
      return saved.budget === 35 && saved.activeDays.length === 4
    } catch { return false }
  `, 'recovered default saved planner preferences')
  assert.equal(recoveredPreferences, true)
  await nav(sessionId, 'Mand')
  await until(sessionId, `
    const comparison = document.querySelector('.comparison-card')
    return comparison && comparison.textContent.includes('geen live-besparingsclaim')
  `, 'synthetic-only comparison still disclosed on recovered plan')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'recovered default week creates actual shopping rows',
  )
  assert.equal(await script(sessionId,
    'return document.querySelectorAll("button.shopping-row.checked").length'), 0,
    'corrupt persisted checks must not count as completed groceries')
  const canonicalDefaultShoppingRows = await script(sessionId, `
    return [...document.querySelectorAll('button.shopping-row')]
      .map((row) => row.textContent.trim())
  `)
  assert.ok(canonicalDefaultShoppingRows.length > 0,
    'default screenshot must represent a physical test basket')
  checks.push('corrupt-planner-and-checklist-recover-safely')
  await screenshot(sessionId, 'shopping-recovered-default.png')


  // User-requested Reset is different from corrupt-data fallback: it must
  // explicitly restore defaults after changing both physical demand and budget.
  await nav(sessionId, 'Planner')
  await changeRecipe(sessionId, 'Di', 'pasta')
  for (const day of ['Ma', 'Wo']) {
    const removed = await script(sessionId, `
      const button = document.querySelector('[aria-label="' + arguments[0] + ' uit planning halen"]')
      if (!button) return false
      button.click()
      return true
    `, [day])
    assert.equal(removed, true, `could not remove ${day} before reset`)
  }
  await script(sessionId, `
    const budget = document.querySelectorAll('.budget-options button')[2]
    if (!budget) return false
    budget.click()
    return true
  `)
  await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    if (!raw) return false
    const saved = JSON.parse(raw)
    return saved.budget === 40 && saved.activeDays.length === 2 &&
      saved.recipeByDay.Di === 'pasta'
  `, 'modified saved preferences before explicit reset')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'modified basket checklist before explicit reset')
  await script(sessionId, `
    const first = document.querySelector('button.shopping-row')
    first.click()
    return true
  `)
  await until(sessionId, `
    const raw = localStorage.getItem('supa:shopping-list-progress:v1')
    return raw && JSON.parse(raw).doneLineIds.length === 1
  `, 'checked modified basket stored before reset')

  await nav(sessionId, 'Planner')
  await clickButton(sessionId, '.section-heading button', 'Reset')
  await until(sessionId, `
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    if (!raw) return false
    const saved = JSON.parse(raw)
    return saved.budget === 35 &&
      saved.activeDays.join(',') === 'Ma,Di,Wo,Do' &&
      saved.recipeByDay.Di === 'teriyaki' &&
      saved.recipeByDay.Do === 'tikka'
  `, 'explicit reset persisted canonical default week')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'reset canonical basket checklist')
  assert.equal(await script(sessionId,
    'return document.querySelectorAll("button.shopping-row.checked").length'), 0,
    'reset to a physically different basket must not retain stale checks')

  await request(`/session/${sessionId}/refresh`, { method: 'POST', body: '{}' })
  await until(sessionId, `
    const heading = document.querySelector(".screen")
    const raw = localStorage.getItem('supa:planner-preferences:v2')
    return heading?.textContent.includes('4 maaltijden actief') &&
      raw && JSON.parse(raw).budget === 35
  `, 'reset week survives actual Firefox page reload')
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'default checklist after reset page reload')
  assert.equal(await script(sessionId,
    'return document.querySelectorAll("button.shopping-row.checked").length'), 0,
    'old checked row must not resurrect after reset page reload')
  const afterResetRows = await script(sessionId, `
    return [...document.querySelectorAll('button.shopping-row')]
      .map((row) => row.textContent.trim())
  `)
  assert.deepEqual(afterResetRows, canonicalDefaultShoppingRows,
    'Reset must recreate the identical physical shopping products, packs and quantities')
  checks.push('explicit-reset-restores-week-budget-and-clears-stale-checks')
  await screenshot(sessionId, 'shopping-explicit-reset.png')

  // Cross-viewport product continuity: changing viewport must never
  // change the physical basket, checked state or navigability.
  await request(`/session/${sessionId}/window/rect`, {
    method: 'POST',
    body: JSON.stringify({ width: 960, height: 760 }),
  })
  const desktop = await script(sessionId, `
    const shell = document.querySelector('.app-shell')
    const nav = document.querySelector('.bottom-nav')
    const bar = document.querySelector('.topbar')
    if (!shell || !nav || !bar) return null
    const shellRect = shell.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    return {
      width: innerWidth,
      viewportClientWidth: document.documentElement.clientWidth,
      desktopQuery: matchMedia('(min-width: 700px)').matches,
      shellWidth: shellRect.width,
      shellLeft: shellRect.left,
      navWidth: navRect.width,
      navLeft: navRect.left,
      scrollWidth: document.documentElement.scrollWidth,
      topbar: getComputedStyle(bar).position,
      overflow: getComputedStyle(shell).overflow,
      activeNav: document.querySelector('.bottom-nav button[aria-current="page"]')?.textContent.trim(),
      rowCount: document.querySelectorAll('button.shopping-row').length,
      checkedRows: document.querySelectorAll('button.shopping-row.checked').length,
    }
  `)
  assert.ok(desktop, 'desktop shell/navigation geometry missing')
  assert.ok(desktop.desktopQuery, 'desktop breakpoint must activate')
  assert.ok(desktop.width >= 700, 'Firefox must honor a real desktop viewport')
  assert.ok(desktop.shellWidth <= 561 && desktop.shellWidth > 400,
    'centered desktop shopping app must retain a readable bounded width')
  assert.ok(Math.abs(desktop.shellLeft - (desktop.viewportClientWidth - desktop.shellWidth) / 2) <= 2,
    'desktop app shell must be horizontally centered')
  assert.ok(desktop.navWidth <= 533)
  assert.ok(Math.abs(desktop.navLeft - (desktop.viewportClientWidth - desktop.navWidth) / 2) <= 2,
    'desktop navigation must remain centered')
  assert.equal(desktop.topbar, 'sticky')
  assert.equal(desktop.overflow, 'clip')
  assert.equal(desktop.activeNav, 'Lijst')
  assert.ok(desktop.scrollWidth <= desktop.viewportClientWidth + 2,
    'desktop must not horizontally overflow')
  assert.equal(desktop.rowCount, canonicalDefaultShoppingRows.length)
  assert.equal(desktop.checkedRows, 0)
  checks.push('desktop-centered-shell-navigation-and-groceries')
  await screenshot(sessionId, 'shopping-reset-desktop.png')

  await request(`/session/${sessionId}/window/rect`, {
    method: 'POST',
    body: JSON.stringify({ width: 430, height: 932 }),
  })
  const mobile = await script(sessionId, `
    const nav = document.querySelector('.bottom-nav')
    if (!nav) return null
    const rect = nav.getBoundingClientRect()
    return {
      width: innerWidth,
      desktopQuery: matchMedia('(min-width: 700px)').matches,
      scrollWidth: document.documentElement.scrollWidth,
      viewportClientWidth: document.documentElement.clientWidth,
      navLeft: rect.left,
      navWidth: rect.width,
      activeNav: document.querySelector('.bottom-nav button[aria-current="page"]')?.textContent.trim(),
      rows: [...document.querySelectorAll('button.shopping-row')]
        .map((row) => row.textContent.trim()),
      checkedRows: document.querySelectorAll('button.shopping-row.checked').length,
    }
  `)
  assert.ok(mobile, 'mobile shopping geometry missing')
  assert.equal(mobile.desktopQuery, false)
  assert.ok(mobile.width < 700, 'Firefox must restore the mobile breakpoint')
  assert.ok(mobile.scrollWidth <= mobile.viewportClientWidth + 2,
    'mobile shopping rows must never cause horizontal overflow')
  assert.ok(Math.abs(mobile.navLeft - (mobile.viewportClientWidth - mobile.navWidth) / 2) <= 2,
    'mobile navigation must remain centered')
  assert.equal(mobile.activeNav, 'Lijst')
  assert.deepEqual(mobile.rows, canonicalDefaultShoppingRows,
    'viewport changes must not modify physical product names or pack quantities')
  assert.equal(mobile.checkedRows, 0)
  checks.push('mobile-viewport-return-preserves-exact-groceries')
  await screenshot(sessionId, 'shopping-reset-mobile.png')

  assert.equal(screenshotIntegrity.length, 9,
    'All nine fixture-only UI screenshots must be present before success')
  await writeFile(`${artifactDirectory}/result.json`,
    JSON.stringify({
      schemaVersion: 1,
      category: 'synthetic-M2-M3-product-flow',
      checkoutSha: process.env.GITHUB_SHA ?? null,
      pullRequestHeadSha: process.env.PRODUCT_WEEK_HEAD_SHA ?? null,
      githubRunId: process.env.GITHUB_RUN_ID ?? null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      screenshotIntegrity,
      screenshots: [
        'planner-changed.png',
        'basket-controlled-demo.png',
        'shopping-item-checked.png',
        'shopping-reloaded.png',
        'shopping-empty-week.png',
        'shopping-recovered-default.png',
        'shopping-explicit-reset.png',
        'shopping-reset-desktop.png',
        'shopping-reset-mobile.png',
      ],
      checks,
      retailerDataObserved: false,
      realSavingsClaimEligible: false,
    }, null, 2) + '\n',
    { mode: 0o600 },
  )
  process.stdout.write(`PASS product-week browser: ${checks.join(', ')}\n`)
} finally {
  await request(`/session/${sessionId}`, { method: 'DELETE' })
}
