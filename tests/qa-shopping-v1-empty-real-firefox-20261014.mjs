import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

// Independent QA-only REAL Firefox acceptance on frozen original shopping-v1
// empty-state source owner #1877. Never starts on the permanent VPS.
const app = process.env.SUPA_QA_BROWSER_URL
const driver = process.env.SUPA_QA_WEBDRIVER_URL
const directory = process.env.SUPA_QA_ARTIFACT_DIR ?? 'artifacts/qa-shopping-empty'
for (const [name, raw] of [['app', app], ['driver', driver]]) {
  assert.equal(typeof raw, 'string', name + ' URL required')
  const u = new URL(raw)
  assert.equal(u.protocol, 'http:')
  assert.equal(u.hostname, '127.0.0.1')
  assert.ok(u.port)
  assert.equal(u.pathname, '/')
  assert.equal(u.username, '')
  assert.equal(u.password, '')
  assert.equal(u.search, '')
  assert.equal(u.hash, '')
}
if (process.env.GITHUB_ACTIONS === 'true') {
  assert.match(process.env.SUPA_QA_OWNER_HEAD_SHA ?? '', /^[a-f0-9]{40}$/i)
  assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/i)
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/)
}

async function wd(endpoint, options = {}) {
  const response = await fetch(driver + endpoint, {
    ...options,
    headers: { 'content-type': 'application/json' },
  })
  const json = await response.json()
  if (!response.ok || json.value?.error) {
    throw new Error('Firefox WebDriver request failed at ' + endpoint +
      ': ' + (json.value?.error ?? response.status))
  }
  return json.value
}

async function js(session, source, args = []) {
  return wd('/session/' + session + '/execute/sync', {
    method: 'POST', body: JSON.stringify({ script: source, args }),
  })
}

async function eventually(session, script, description) {
  for (let i = 0; i < 90; i++) {
    const out = await js(session, script)
    if (out) return out
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Actual Firefox UI state not reached: ' + description)
}

async function nav(session, tab) {
  const clicked = await js(session, `
    const b = [...document.querySelectorAll('nav.bottom-nav button')]
      .find(el => el.textContent?.trim() === arguments[0])
    if (!b) return false
    b.click()
    return true
  `, [tab])
  assert.equal(clicked, true)
  await eventually(session, `
    return [...document.querySelectorAll('nav.bottom-nav button')]
      .some(el => el.textContent?.trim() === arguments[0] &&
                    el.getAttribute('aria-current') === 'page')
  `.replace('arguments[0]', JSON.stringify(tab)), 'navigation ' + tab)
}

async function capture(session, filename) {
  const base64 = await wd('/session/' + session + '/screenshot')
  assert.match(base64, /^[A-Za-z0-9+/]+={0,2}$/)
  const png = Buffer.from(base64, 'base64')
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(png.length > 1024)
  await writeFile(directory + '/' + filename, png, { mode: 0o600 })
}

await mkdir(directory, { recursive: true })
const created = await wd('/session', {
  method: 'POST',
  body: JSON.stringify({
    capabilities: { alwaysMatch: { browserName: 'firefox',
      acceptInsecureCerts: false,
      'moz:firefoxOptions': { args: ['-headless', '--width=430', '--height=932'] },
    } },
  }),
})
const sid = created.sessionId
assert.ok(sid, 'Firefox must return a WebDriver session')
const checks = []
try {
  await wd('/session/' + sid + '/url', {
    method: 'POST', body: JSON.stringify({ url: app }),
  })
  await eventually(sid,
    'return document.querySelector(".screen")?.textContent.includes("4 maaltijden actief")',
    'initial genuine 4-meal planner')
  checks.push('four-meal-default')

  await nav(sid, 'Lijst')
  const populated = await eventually(sid,
    'return document.querySelectorAll("button.shopping-row").length > 0',
    'populated real routed v1 shopping rows')
  assert.equal(populated, true)
  const originalRows = await js(sid,
    'return document.querySelectorAll("button.shopping-row").length')
  assert.ok(originalRows > 0)
  const badStatus = await js(sid,
    'return document.querySelector("p[role=status]")?.textContent ?? null')
  assert.equal(badStatus, null, 'normal week must not show empty-state trust message')
  checks.push('populated-v1-shopping-visible')
  await capture(sid, 'qa-shopping-populated.png')

  await nav(sid, 'Planner')
  for (const day of ['Ma', 'Di', 'Wo', 'Do']) {
    const removed = await js(sid, `
      const button = document.querySelector('[aria-label="' + arguments[0] + ' uit planning halen"]')
      if (!button) return false
      button.click()
      return true
    `, [day])
    assert.equal(removed, true, 'remove scheduled meal ' + day)
    await eventually(sid, `
      const raw = localStorage.getItem('supa:planner-preferences:v2')
      return raw && !JSON.parse(raw).activeDays.includes(arguments[0])
    `.replace('arguments[0]', JSON.stringify(day)), 'saved ' + day + ' removal')
  }
  await eventually(sid,
    'return document.querySelector(".screen")?.textContent.includes("0 maaltijden actief")',
    'empty physical week')
  checks.push('empty-week-persisted')

  async function checkEmptyState() {
    await nav(sid, 'Lijst')
    const message = await eventually(sid,
      `const t = document.querySelector('p[role="status"]')?.textContent ?? ''
       return t.includes('Geen boodschappen voor deze planning.') &&
         t.includes('Voeg een maaltijd toe in Planner.') && t`,
      'human-readable empty-week explanation in actual Firefox')
    assert.match(message, /Geen boodschappen voor deze planning\./)
    assert.match(message, /Voeg een maaltijd toe in Planner\./)
    assert.doesNotMatch(message, /Boodschappenlijst niet beschikbaar|besparing|goedkoper/i)
    assert.equal(await js(sid,
      'return document.querySelectorAll("button.shopping-row").length'), 0)
    assert.equal(await js(sid,
      'return !!document.querySelector(".attention-card")'), false)
  }
  await checkEmptyState()
  checks.push('real-empty-week-v1-status-visible')
  await capture(sid, 'qa-shopping-empty-with-message.png')

  await wd('/session/' + sid + '/refresh', {
    method: 'POST', body: '{}',
  })
  await eventually(sid,
    'return document.querySelector(".screen")?.textContent.includes("0 maaltijden actief")',
    'empty planner persisted on reload')
  await checkEmptyState()
  checks.push('empty-week-message-survives-reload')

  await writeFile(directory + '/qa-result.json', JSON.stringify({
    schemaVersion: 1,
    category: 'synthetic-rendered-shopping-v1-empty-acceptance',
    frozenOwnerHeadSha: process.env.SUPA_QA_OWNER_HEAD_SHA ?? null,
    checkoutSha: process.env.GITHUB_SHA ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    originalRows, checks,
    screenshots: ['qa-shopping-populated.png', 'qa-shopping-empty-with-message.png'],
    humanM3Observed: false,
    realSavingsClaimEligible: false,
    productionReleaseEligible: false,
  }, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write('PASS independent REAL Firefox v1 shopping empty-week: ' +
    checks.join(', ') + '\n')
} finally {
  await wd('/session/' + sid, { method: 'DELETE' })
}
