import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const webdriver = process.env.WEBDRIVER_URL || 'http://127.0.0.1:4444'
const baseUrl = process.env.M2_BASE_URL || 'http://127.0.0.1:4173'
const artifactDir = process.env.M2_E2E_ARTIFACT_DIR || 'artifacts/m2-browser-e2e'

async function request(endpoint, options = {}) {
  const response = await fetch(webdriver + endpoint, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    body = { raw }
  }

  if (!response.ok || body?.value?.error) {
    throw new Error(
      `WebDriver ${endpoint} failed: ${response.status} ${raw}`,
    )
  }
  return body.value
}

async function execute(sessionId, script, args = []) {
  return request(`/session/${sessionId}/execute/sync`, {
    method: 'POST',
    body: JSON.stringify({ script, args }),
  })
}

async function bodyText(sessionId) {
  return execute(
    sessionId,
    'return (document.body?.innerText || "").replace(/\\s+/g, " ").trim()',
  )
}

async function waitForText(sessionId, expected, timeoutMs = 5000) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < timeoutMs) {
    last = await bodyText(sessionId)
    if (last.includes(expected)) return last
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Timed out waiting for text "${expected}". Last body: ${last.slice(0, 1200)}`,
  )
}

async function clickNav(sessionId, label) {
  const clicked = await execute(
    sessionId,
    `
      const button = [...document.querySelectorAll('nav button')]
        .find((candidate) => candidate.textContent?.trim() === arguments[0])
      if (!button) return false
      button.click()
      return true
    `,
    [label],
  )
  assert.equal(clicked, true, `navigation button missing: ${label}`)
}

async function screenshot(sessionId, filename) {
  const encoded = await request(`/session/${sessionId}/screenshot`)
  await writeFile(path.join(artifactDir, filename), Buffer.from(encoded, 'base64'))
}

await mkdir(artifactDir, { recursive: true })

const created = await request('/session', {
  method: 'POST',
  body: JSON.stringify({
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        acceptInsecureCerts: false,
        'moz:firefoxOptions': {
          args: ['-headless', '--width=430', '--height=932'],
        },
      },
    },
  }),
})

const sessionId = created?.sessionId
if (!sessionId) throw new Error('No Firefox WebDriver session id returned')

const evidence = {
  schemaVersion: 1,
  milestone: 'M2 Core Planner Vertical Slice',
  baseUrl,
  checks: [],
}

try {
  await request(`/session/${sessionId}/url`, {
    method: 'POST',
    body: JSON.stringify({ url: baseUrl }),
  })

  const plannerText = await waitForText(sessionId, 'Plan eerst. Bespaar daarna.')
  assert.match(plannerText, /4 maaltijden actief/)
  evidence.checks.push({
    step: 'planner-default',
    passed: true,
    observed: 'planner rendered with four active meals',
  })

  const changed = await execute(
    sessionId,
    `
      const select = document.getElementById('recipe-Di')
      if (!select) return false
      select.value = 'pasta'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value === 'pasta'
    `,
  )
  assert.equal(changed, true, 'Tuesday recipe could not be changed to pasta')
  evidence.checks.push({
    step: 'recipe-change',
    passed: true,
    observed: 'Tuesday recipe changed to pasta through the rendered planner control',
  })

  await clickNav(sessionId, 'Mand')
  let basketText = await waitForText(sessionId, 'Deterministisch mandtotaal')
  basketText = await waitForText(sessionId, '23,30')
  assert.match(basketText, /Garam masala/)
  assert.match(basketText, /Controle nodig/)
  assert.match(basketText, /M2 testwinkel/)
  assert.match(basketText, /Gecontroleerde winkelvergelijking/)
  assert.match(basketText, /M3 testwinkel B ligt/)
  assert.match(basketText, /geen live-besparingsclaim/)
  const comparisonOutcome = await execute(
    sessionId,
    "return document.querySelector('.comparison-card')?.dataset.comparisonOutcome || null",
  )
  assert.equal(comparisonOutcome, 'better')
  await screenshot(sessionId, 'basket.png')
  evidence.checks.push({
    step: 'basket-recalculation',
    passed: true,
    observed:
      'recipe change recalculated the one-store basket to EUR 23.30 and kept Garam masala unresolved',
  })

  await clickNav(sessionId, 'Lijst')
  const listText = await waitForText(sessionId, 'Boodschappenlijst')
  assert.match(listText, /1 productkeuze vraagt controle/)
  assert.match(listText, /Garam masala/)
  assert.match(listText, /handmatig kiezen/)
  await screenshot(sessionId, 'shopping-list.png')
  evidence.checks.push({
    step: 'shopping-list',
    passed: true,
    observed:
      'shopping list renders the same unresolved Garam masala line as a manual-choice item',
  })

  const checked = await execute(
    sessionId,
    `
      const row = [...document.querySelectorAll('button.shopping-row')]
        .find((candidate) => candidate.textContent?.includes('Garam masala'))
      if (!row) return false
      row.click()
      return true
    `,
  )
  assert.equal(checked, true, 'unresolved shopping-list row was not interactive')
  const checkedText = await bodyText(sessionId)
  assert.match(checkedText, /Garam masala/)
  evidence.checks.push({
    step: 'shopping-list-interaction',
    passed: true,
    observed: 'manual-choice shopping-list row remains usable as a checklist item',
  })

  await clickNav(sessionId, 'Planner')
  await waitForText(sessionId, 'Plan eerst. Bespaar daarna.')

  const changedPreferences = await execute(
    sessionId,
    `
      const dayButton = document.querySelector('button[aria-label="Do uit planning halen"]')
      const budgetButton = [...document.querySelectorAll('.budget-chip')]
        .find((candidate) => candidate.textContent?.includes('40'))
      if (!dayButton || !budgetButton) return false
      dayButton.click()
      budgetButton.click()
      return true
    `,
  )
  assert.equal(changedPreferences, true, 'planner preferences could not be changed')
  let preferenceText = await waitForText(sessionId, '3 maaltijden actief')
  preferenceText = await waitForText(sessionId, '16,52')
  assert.match(preferenceText, /40,00/)
  evidence.checks.push({
    step: 'planner-preferences-change',
    passed: true,
    observed:
      'Tuesday pasta + disabled Thursday recalculated the shared basket to EUR 16.52 while budget changed to EUR 40',
  })

  await request(`/session/${sessionId}/url`, {
    method: 'POST',
    body: JSON.stringify({ url: baseUrl }),
  })

  let restoredText = await waitForText(sessionId, '3 maaltijden actief')
  restoredText = await waitForText(sessionId, '16,52')
  assert.match(restoredText, /40,00/)

  const restored = await execute(
    sessionId,
    `
      return {
        recipeDi: document.getElementById('recipe-Di')?.value || null,
        thursdayInactive: Boolean(
          document.querySelector('button[aria-label="Do aan planning toevoegen"]'),
        ),
        budget: document.getElementById('weekbudget-title')?.textContent || null,
        stored: window.localStorage.getItem('supa:planner-preferences:v2'),
      }
    `,
  )

  assert.equal(restored.recipeDi, 'pasta')
  assert.equal(restored.thursdayInactive, true)
  assert.match(restored.budget || '', /40,00/)
  assert.match(restored.stored || '', /"budget":40/)
  assert.match(restored.stored || '', /"Di":"pasta"/)
  await screenshot(sessionId, 'planner-reloaded.png')
  evidence.checks.push({
    step: 'planner-preferences-reload',
    passed: true,
    observed:
      'reload restored budget EUR 40, Tuesday pasta, Thursday inactive and the resulting EUR 16.52 basket-backed planner total',
  })

  evidence.passed = true
  await writeFile(
    path.join(artifactDir, 'result.json'),
    JSON.stringify(evidence, null, 2) + '\n',
    'utf8',
  )
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  evidence.passed = false
  evidence.error = error instanceof Error ? error.message : String(error)
  await writeFile(
    path.join(artifactDir, 'result.json'),
    JSON.stringify(evidence, null, 2) + '\n',
    'utf8',
  )
  throw error
} finally {
  await request(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
}
