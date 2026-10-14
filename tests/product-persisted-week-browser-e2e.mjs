import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const baseUrl = process.env.PRODUCT_WEEK_BASE_URL ?? 'http://127.0.0.1:4179'
const driverUrl = process.env.PRODUCT_WEEK_WEBDRIVER_URL ?? 'http://127.0.0.1:4457'
const artifactDirectory = process.env.PRODUCT_WEEK_ARTIFACT_DIR ?? 'artifacts/product-week-browser'

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
  checks.push('edited-planner-saved')

  await nav(sessionId, 'Mand')
  await until(sessionId,
    'return document.querySelector(".comparison-card")?.textContent.includes("geen live-besparingsclaim")',
    'controlled fixture comparison disclaimer',
  )
  checks.push('basket-price-claim-boundary')

  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'populated checklist',
  )
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
  await nav(sessionId, 'Lijst')
  await until(sessionId,
    'return document.querySelector("button.shopping-row")?.classList.contains("checked")',
    'budget-only change kept checked item',
  )
  checks.push('budget-only-preserves-checklist')

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

  await writeFile(`${artifactDirectory}/result.json`,
    JSON.stringify({
      schemaVersion: 1,
      category: 'synthetic-M2-M3-product-flow',
      checkoutSha: process.env.GITHUB_SHA ?? null,
      pullRequestHeadSha: process.env.PRODUCT_WEEK_HEAD_SHA ?? null,
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
