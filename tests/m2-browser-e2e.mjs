import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

async function readGithubProvenance() {
  const provenance = {
    checkoutSha: process.env.GITHUB_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    eventName: process.env.GITHUB_EVENT_NAME || null,
    ref: process.env.GITHUB_REF || null,
    headRef: process.env.GITHUB_HEAD_REF || null,
    pullRequestHeadSha: null,
    pullRequestBaseSha: null,
  }

  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(
      await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
    )
    provenance.pullRequestHeadSha = event?.pull_request?.head?.sha ?? null
    provenance.pullRequestBaseSha = event?.pull_request?.base?.sha ?? null
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    assert.match(
      provenance.checkoutSha ?? '',
      /^[0-9a-f]{40}$/i,
      'GitHub Actions evidence requires a checkout SHA',
    )
    assert.match(
      provenance.runId ?? '',
      /^\d+$/,
      'GitHub Actions evidence requires a numeric run ID',
    )
    assert.match(
      provenance.runAttempt ?? '',
      /^\d+$/,
      'GitHub Actions evidence requires a numeric run attempt',
    )

    if (provenance.eventName === 'pull_request') {
      assert.match(
        provenance.pullRequestHeadSha ?? '',
        /^[0-9a-f]{40}$/i,
        'pull-request evidence requires the candidate head SHA',
      )
      assert.match(
        provenance.pullRequestBaseSha ?? '',
        /^[0-9a-f]{40}$/i,
        'pull-request evidence requires the base SHA',
      )
    }
  }

  return provenance
}

const evidence = {
  schemaVersion: 1,
  milestone: 'M2 Core Planner Vertical Slice',
  baseUrl,
  provenance: null,
  checks: [],
}

try {
  evidence.provenance = await readGithubProvenance()

  await request(`/session/${sessionId}/url`, {
    method: 'POST',
    body: JSON.stringify({ url: baseUrl }),
  })

  const plannerText = await waitForText(sessionId, 'Plan eerst. Vergelijk daarna.')
  assert.match(plannerText, /4 maaltijden actief/)
  evidence.checks.push({
    step: 'planner-default',
    passed: true,
    observed: 'planner rendered with four active meals',
  })

  await request(`/session/${sessionId}/window/rect`, {
    method: 'POST',
    body: JSON.stringify({ width: 800, height: 640 }),
  })
  const desktopStickyTopbar = await execute(
    sessionId,
    `
      const shell = document.querySelector('.app-shell')
      const topbar = document.querySelector('.topbar')
      if (!shell || !topbar) return null

      const initialTop = topbar.getBoundingClientRect().top
      window.scrollTo(0, 240)
      const stickyTop = topbar.getBoundingClientRect().top

      return {
        desktopMedia: matchMedia('(min-width: 700px)').matches,
        shellOverflow: getComputedStyle(shell).overflow,
        topbarPosition: getComputedStyle(topbar).position,
        initialTop,
        stickyTop,
        scrollY: window.scrollY,
      }
    `,
  )
  assert.ok(desktopStickyTopbar, 'desktop sticky topbar could not be inspected')
  assert.equal(desktopStickyTopbar.desktopMedia, true)
  assert.equal(desktopStickyTopbar.shellOverflow, 'clip')
  assert.equal(desktopStickyTopbar.topbarPosition, 'sticky')
  assert.ok(desktopStickyTopbar.scrollY > 0, 'desktop page did not scroll')
  assert.ok(
    Math.abs(desktopStickyTopbar.stickyTop) <= 1,
    `desktop topbar did not remain sticky at the viewport top: ${desktopStickyTopbar.stickyTop}`,
  )
  await execute(sessionId, 'window.scrollTo(0, 0); return window.scrollY')
  await request(`/session/${sessionId}/window/rect`, {
    method: 'POST',
    body: JSON.stringify({ width: 430, height: 932 }),
  })
  evidence.checks.push({
    step: 'desktop-sticky-topbar',
    passed: true,
    observed:
      'Firefox desktop viewport keeps the topbar sticky at the viewport top while the rounded app shell clips with overflow: clip',
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
  let basketText = await waitForText(sessionId, 'Bekend mandminimum')
  basketText = await waitForText(sessionId, 'min. € 23,30')
  assert.match(basketText, /Garam masala/)
  assert.match(basketText, /Controle nodig/)
  assert.match(basketText, /Eerst controleren/)
  assert.match(basketText, /1 productkeuze vraagt jouw controle\. Die staat bovenaan\./)
  assert.match(basketText, /Geen productmatch is zeker genoeg; kies zelf\./)
  assert.match(basketText, /Automatisch gekozen op basis van ingrediënt en verpakking\./)
  assert.doesNotMatch(basketText, /score below trust threshold/)
  assert.doesNotMatch(basketText, /query phrase present/)
  assert.doesNotMatch(basketText, /Match \d+/)
  assert.match(basketText, /Voorbeeldwinkel/)
  assert.doesNotMatch(basketText, /M2 testwinkel/)
  assert.match(basketText, /1 productkeuze is nog niet meegerekend/)
  assert.match(basketText, /geen volledig mandtotaal/)
  const basketTotalState = await execute(
    sessionId,
    "return document.querySelector('.hero-total')?.dataset.basketTotalState || null",
  )
  assert.equal(basketTotalState, 'minimum')
  const prioritizedReview = await execute(
    sessionId,
    `
      const rows = [...document.querySelectorAll('.list-card .trace-row')]
      return {
        priorityVisible:
          document.querySelector('[data-basket-review-priority="true"]') !== null,
        firstRow: rows[0]?.textContent || '',
      }
    `,
  )
  assert.equal(prioritizedReview.priorityVisible, true)
  assert.match(prioritizedReview.firstRow, /Garam masala/)
  assert.match(basketText, /Gecontroleerde winkelvergelijking/i)
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
      'recipe change recalculated the known basket minimum to EUR 23.30, prioritized the unresolved Garam masala choice, kept user-facing guidance, hid matcher diagnostics and suppressed a complete-total claim',
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

  await clickNav(sessionId, 'Meten')
  let observationText = await waitForText(sessionId, 'Meten zonder gokken.')
  assert.match(observationText, /0\/22 regels compleet/)
  assert.match(observationText, /collection-template-not-evidence/)
  assert.match(observationText, /JSON-concept openen/)
  assert.match(observationText, /Volgende: PLUS · Basmati rijst/)

  const observationQuickEntry = await execute(
    sessionId,
    `
      const baseline = document.querySelector('[data-observation-side="baseline"]')
      const candidate = document.querySelector('[data-observation-side="candidate"]')
      const nowButton = baseline
        ? [...baseline.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Gebruik huidige tijd',
          )
        : null
      const candidateStoreId = candidate?.querySelector(
        'input[placeholder="dekamarkt-leiden-..."]',
      )
      const firstSummary = baseline?.querySelector('.observation-line summary')
      const primaryAction = document.querySelector('.observation-actions .primary-button')
      if (!nowButton || !candidateStoreId || !firstSummary || !primaryAction) return null
      nowButton.click()
      return {
        candidateStoreIdHint: candidateStoreId.getAttribute('placeholder'),
        inputFontSize: getComputedStyle(candidateStoreId).fontSize,
        inputMinHeight: getComputedStyle(candidateStoreId).minHeight,
        summaryMinHeight: getComputedStyle(firstSummary).minHeight,
        primaryActionMinHeight: getComputedStyle(primaryAction).minHeight,
      }
    `,
  )
  assert.ok(observationQuickEntry, 'M3 quick-entry controls are missing')
  assert.equal(
    observationQuickEntry.candidateStoreIdHint,
    'dekamarkt-leiden-...',
  )
  assert.equal(observationQuickEntry.inputFontSize, '16px')
  assert.equal(observationQuickEntry.inputMinHeight, '44px')
  assert.equal(observationQuickEntry.summaryMinHeight, '44px')
  assert.equal(observationQuickEntry.primaryActionMinHeight, '44px')

  let observationTimestamp = ''
  for (let attempt = 0; attempt < 20 && !observationTimestamp; attempt += 1) {
    observationTimestamp = await execute(
      sessionId,
      `
        const baseline = document.querySelector('[data-observation-side="baseline"]')
        return baseline?.querySelector('input[type="datetime-local"]')?.value || ''
      `,
    )
    if (!observationTimestamp) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  assert.match(
    observationTimestamp,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  )

  const incompleteObservationChanged = await execute(
    sessionId,
    `
      const select = document.querySelector(
        'select[aria-label="baseline Basmati rijst beschikbaar"]',
      )
      if (!select) return false
      select.value = 'true'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value === 'true'
    `,
  )
  assert.equal(
    incompleteObservationChanged,
    true,
    'M3 available observation could not be recorded',
  )
  observationText = await waitForText(sessionId, 'details aanvullen')
  assert.match(observationText, /0\/22 regels compleet/)

  const temporaryProductEntered = await execute(
    sessionId,
    `
      const line = document.querySelector('[data-observation-line="basmati-rice"]')
      const productName = line?.querySelector('input[placeholder="Exacte productnaam"]')
      if (!productName) return false

      productName.value = 'Temporary observed product'
      productName.dispatchEvent(new Event('input', { bubbles: true }))
      productName.dispatchEvent(new Event('change', { bubbles: true }))
      return productName.value === 'Temporary observed product'
    `,
  )
  assert.equal(
    temporaryProductEntered,
    true,
    'M3 temporary observed product detail could not be entered',
  )

  await execute(
    sessionId,
    `
      const select = document.querySelector(
        'select[aria-label="baseline Basmati rijst beschikbaar"]',
      )
      if (!select) return false
      select.value = 'false'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    `,
  )
  await waitForText(sessionId, 'niet beschikbaar')

  await execute(
    sessionId,
    `
      const select = document.querySelector(
        'select[aria-label="baseline Basmati rijst beschikbaar"]',
      )
      if (!select) return false
      select.value = 'true'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    `,
  )
  await waitForText(sessionId, 'details aanvullen')

  const staleDetailsCleared = await execute(
    sessionId,
    `
      const line = document.querySelector('[data-observation-line="basmati-rice"]')
      const productName = line?.querySelector('input[placeholder="Exacte productnaam"]')
      return productName?.value === ''
    `,
  )
  assert.equal(
    staleDetailsCleared,
    true,
    'M3 availability reset retained stale observed product details',
  )

  const observationChanged = await execute(
    sessionId,
    `
      const select = document.querySelector(
        'select[aria-label="baseline Basmati rijst beschikbaar"]',
      )
      if (!select) return false
      select.value = 'false'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value === 'false'
    `,
  )
  assert.equal(
    observationChanged,
    true,
    'M3 observation availability could not be recorded',
  )
  observationText = await waitForText(sessionId, '1/22 regels compleet')
  observationText = await waitForText(sessionId, 'Volgende: PLUS · Broccoli')
  assert.match(observationText, /Basmati rijst/)

  const jumpedToNextObservation = await execute(
    sessionId,
    `
      const baseline = document.querySelector('[data-observation-side="baseline"]')
      const basmati = baseline?.querySelector('[data-observation-line="basmati-rice"]')
      const nextButton = basmati?.querySelector('button.observation-line-next')
      if (!nextButton || nextButton.disabled) return false
      nextButton.click()
      const broccoli = baseline.querySelector('[data-observation-line="broccoli"]')
      const focused = document.activeElement?.getAttribute('aria-label')
      return Boolean(
        broccoli?.open &&
          focused === 'baseline Broccoli beschikbaar',
      )
    `,
  )
  assert.equal(
    jumpedToNextObservation,
    true,
    'completed M3 line did not jump focus to the next open observation',
  )
  await screenshot(sessionId, 'm3-observation-entry.png')
  evidence.checks.push({
    step: 'm3-observation-entry',
    passed: true,
    observed:
      'rendered M3 collector exposes the canonical 22 store/ingredient observations, supports one-tap timestamps, uses retailer-specific store hints and jumps from a completed line to the next open observation',
  })

  await clickNav(sessionId, 'Planner')
  await waitForText(sessionId, 'Plan eerst. Vergelijk daarna.')

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
