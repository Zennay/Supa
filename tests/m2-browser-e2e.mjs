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

  await waitForText(sessionId, 'Weekplanning')
  const homeLoaded = await execute(sessionId, `return {
    node: document.querySelector('[data-figma-node]')?.getAttribute('data-figma-node'),
    homeCurrent: document.querySelector('.hifi-nav button[aria-current]')?.textContent.trim(),
    assets: [...document.querySelectorAll('.hifi-home img, .hifi-nav img')].map(i => ({src:i.getAttribute('src'), width:i.getBoundingClientRect().width, height:i.getBoundingClientRect().height})),
    overflow: document.documentElement.scrollWidth > innerWidth
  }`)
  assert.equal(homeLoaded.node, '3307:4224')
  assert.equal(homeLoaded.homeCurrent, 'Home')
  assert.equal(homeLoaded.overflow, false)
  assert.ok(homeLoaded.assets.length >= 35)
  assert.ok(homeLoaded.assets.every(i => !i.src.includes('figma.com') && i.width > 0 && i.height > 0))
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await execute(sessionId, 'return [...document.querySelectorAll(".hifi-home img, .hifi-nav img")].every(i => i.complete && i.naturalWidth > 0)')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(await execute(sessionId, 'return [...document.querySelectorAll(".hifi-home img, .hifi-nav img")].every(i => i.complete && i.naturalWidth > 0)'), true)
  await screenshot(sessionId, 'hifi-home.png')
  await execute(sessionId, `const input = document.querySelector('.hifi-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Bananen'); input.dispatchEvent(new Event('input',{bubbles:true}));`)
  await waitForText(sessionId, 'Geen gerechten gevonden')
  assert.equal(await execute(sessionId, 'return document.querySelectorAll(".hifi-product-card").length'), 1)
  await execute(sessionId, `document.querySelector('.hifi-product-actions button:last-child').click()`)
  await waitForText(sessionId, 'toegevoegd aan je demolijst')
  await clickNav(sessionId, 'Lijst')
  await waitForText(sessionId, 'Jouw gekozen producten')
  await execute(sessionId, `document.querySelector('.hifi-demo-list button').click()`)
  assert.equal(await execute(sessionId, 'return document.querySelector(".hifi-demo-list") === null'), true)
  await clickNav(sessionId, 'Home')
  await waitForText(sessionId, 'Weekplanning')
  await execute(sessionId, `document.querySelector('.hifi-recipe-open').click()`)
  await waitForText(sessionId, 'De volledige bereiding')
  assert.equal(await execute(sessionId, 'return document.querySelector("dialog").open'), true)
  await execute(sessionId, `document.querySelector('dialog form button').click()`)
  await execute(sessionId, `document.querySelector('.hifi-recipe-card .hifi-favorite').click(); document.querySelector('.hifi-filter').click()`)
  await execute(sessionId, `document.querySelector('#hifi-filter-panel input').click()`)
  await waitForText(sessionId, 'Geen producten gevonden')
  assert.equal(await execute(sessionId, 'return document.querySelectorAll(".hifi-recipe-card").length'), 1)
  await execute(sessionId, `document.querySelector('#hifi-filter-panel button').click()`)
  evidence.checks.push({step:'figma-home-interactions', passed:true, observed:'Original local Figma assets loaded; Home search, demo-list add/remove, recipe modal and favorite filter work.', assets:homeLoaded.assets})
  await clickNav(sessionId, 'Planner')
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

  // Rows open the recipe picker; the recipe only changes on an explicit choice.
  const openedPicker = await execute(
    sessionId,
    `
      const row = [...document.querySelectorAll('button.hifi-meal-open')]
        .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('Dinsdag'))
      if (!row) return false
      row.click()
      return true
    `,
  )
  assert.equal(openedPicker, true, 'Tuesday row did not open the recipe picker')
  await waitForText(sessionId, 'Kies een recept voor Dinsdag')
  const changed = await execute(
    sessionId,
    `
      const option = [...document.querySelectorAll('.hifi-recipe-picker li button')]
        .find((candidate) => candidate.textContent?.includes('Romige tomatenpasta'))
      if (!option) return false
      option.click()
      return true
    `,
  )
  assert.equal(changed, true, 'Tuesday recipe could not be changed to pasta')
  evidence.checks.push({
    step: 'recipe-change',
    passed: true,
    observed: 'Tuesday recipe changed to pasta through the rendered recipe picker',
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
  await waitForText(sessionId, 'Plan eerst. Vergelijk daarna.')

  const openedThursday = await execute(
    sessionId,
    `
      const day = [...document.querySelectorAll('button.hifi-planner-day')]
        .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('Donderdag'))
      if (!day) return false
      day.click()
      return true
    `,
  )
  assert.equal(openedThursday, true, 'Thursday did not open the recipe picker')
  await waitForText(sessionId, 'Kies een recept voor Donderdag')
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
  await waitForText(sessionId, '3 maaltijden actief')
  evidence.checks.push({
    step: 'planner-preferences-change',
    passed: true,
    observed:
      'Tuesday pasta + Thursday removed through the picker while budget changed to EUR 40',
  })

  await request(`/session/${sessionId}/url`, {
    method: 'POST',
    body: JSON.stringify({ url: baseUrl }),
  })

  await waitForText(sessionId, 'Weekplanning')
  await clickNav(sessionId, 'Planner')
  await waitForText(sessionId, '3 maaltijden actief')

  const restored = await execute(
    sessionId,
    `
      return {
        recipeDi: [...document.querySelectorAll('button.hifi-meal-open')]
          .find((row) => row.getAttribute('aria-label')?.startsWith('Dinsdag'))
          ?.getAttribute('aria-label') || null,
        thursdayInactive: [...document.querySelectorAll('button.hifi-planner-day')]
          .some((day) => day.getAttribute('aria-label')?.startsWith('Donderdag') &&
            day.getAttribute('aria-pressed') === 'false'),
        budget: document.getElementById('weekbudget-title')?.textContent || null,
        stored: window.localStorage.getItem('supa:planner-preferences:v2'),
      }
    `,
  )

  assert.match(restored.recipeDi || '', /Romige tomatenpasta/)
  assert.equal(restored.thursdayInactive, true)
  assert.match(restored.budget || '', /40,00/)
  assert.match(restored.stored || '', /"budget":40/)
  assert.match(restored.stored || '', /"Di":"pasta"/)
  await screenshot(sessionId, 'planner-reloaded.png')
  evidence.checks.push({
    step: 'planner-preferences-reload',
    passed: true,
    observed:
      'reload restored budget EUR 40, Tuesday pasta and Thursday inactive',
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
