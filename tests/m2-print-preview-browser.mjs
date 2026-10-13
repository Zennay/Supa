import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const webdriver = process.env.PRINT_WEBDRIVER_URL || 'http://127.0.0.1:4455'
const pageUrl = process.env.PRINT_BASE_URL || 'http://127.0.0.1:4189/tests/fixtures/print-preview.html'
const artifactDir = process.env.PRINT_ARTIFACT_DIR || 'artifacts/print-browser-e2e'

async function request(url, options = {}) {
  const response = await fetch(webdriver + url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  let body
  try { body = JSON.parse(raw) } catch { body = { raw } }
  if (!response.ok || body?.value?.error) {
    throw new Error(`WebDriver ${url} failed (${response.status}): ${raw.slice(0, 1500)}`)
  }
  return body.value
}

async function execute(session, script, args = []) {
  return request(`/session/${session}/execute/sync`, {
    method: 'POST',
    body: JSON.stringify({ script, args }),
  })
}

async function waitFor(session, selector, timeout = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await execute(session, 'return !!document.querySelector(arguments[0])', [selector])) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  throw new Error(`missing rendered selector ${selector}`)
}

async function screenshot(session, filename) {
  const base64 = await request(`/session/${session}/screenshot`)
  await writeFile(path.join(artifactDir, filename), Buffer.from(base64, 'base64'))
}

function extractPdfText(pdfPath) {
  try {
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
      encoding: 'utf8', timeout: 10_000,
    })
  } catch (error) {
    // This run still proves native PDF generation. No fabricated textual-PDF
    // acceptance when Poppler is unavailable or cannot read the artifact.
    return null
  }
}

await mkdir(artifactDir, { recursive: true })
const created = await request('/session', {
  method: 'POST',
  body: JSON.stringify({
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        acceptInsecureCerts: false,
        'moz:firefoxOptions': { args: ['-headless', '--width=430', '--height=932'] },
      },
    },
  }),
})
const sessionId = created?.sessionId
assert.ok(sessionId, 'Firefox WebDriver session id missing')

const evidence = {
  schemaVersion: 1,
  scope: 'synthetic-only, standalone, UNROUTED print fixture',
  github: {
    checkoutSha: process.env.GITHUB_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    pullRequestHeadSha: null,
  },
  checks: [],
  pdfTextVerified: false,
}
try {
  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
    evidence.github.pullRequestHeadSha = event?.pull_request?.head?.sha ?? null
  }
  await request(`/session/${sessionId}/url`, {
    method: 'POST', body: JSON.stringify({ url: pageUrl }),
  })
  await waitFor(sessionId, '.supa-printable-shopping__action')

  for (const width of [320, 430, 800]) {
    await request(`/session/${sessionId}/window/rect`, {
      method: 'POST', body: JSON.stringify({ width, height: 932 }),
    })
    const observed = await execute(sessionId, `
      const root = document.querySelector('[data-synthetic-print-fixture]')
      const action = document.querySelector('.supa-printable-shopping__action')
      const paper = document.querySelector('.supa-printable-shopping__paper')
      if (!root || !action || !paper) return null
      const rows = [...paper.querySelectorAll('li')]
      return {
        viewport: document.documentElement.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        minHeight: getComputedStyle(action).minHeight,
        buttonType: action.type,
        rows: rows.length,
        checkedBoxRows: paper.querySelectorAll('li span[aria-hidden="true"]').length,
        unresolved: paper.textContent.includes('handmatig kiezen'),
        unknownProductExplicit: paper.textContent.includes('Product nog te kiezen'),
        demo: paper.textContent.includes('voorbeeldgegevens'),
        noClaims: paper.textContent.includes('Geen liveprijzen of besparingsbewijs.'),
        containsMoney: /[€]/.test(paper.textContent),
        paperHiddenUntilPrint: getComputedStyle(paper).display === 'none',
      }
    `)
    assert.ok(observed, 'React print fixture did not render')
    assert.ok(observed.viewport <= width + 2 && observed.viewport >= width - 2, `Firefox did not honor ${width}px viewport: ${observed.viewport}`)
    assert.equal(observed.horizontalOverflow, false, `overflow at ${width}px`)
    assert.equal(observed.minHeight, '44px')
    assert.equal(observed.buttonType, 'button')
    assert.equal(observed.rows, 11)
    assert.equal(observed.checkedBoxRows, 11)
    assert.equal(observed.unresolved, true)
    assert.equal(observed.unknownProductExplicit, true)
    assert.equal(observed.demo, true)
    assert.equal(observed.noClaims, true)
    assert.equal(observed.containsMoney, false)
    assert.equal(observed.paperHiddenUntilPrint, true)
    evidence.checks.push({ kind: 'visible-browser', requestedWidth: width, ...observed, passed: true })
    await screenshot(sessionId, `preview-${width}.png`)
  }

  const clickInvokesNativePrint = await execute(sessionId, `
    const button = document.querySelector('.supa-printable-shopping__action')
    if (!button) return false
    let invoked = 0
    window.print = () => { invoked += 1 }
    button.click()
    return invoked === 1
  `)
  assert.equal(clickInvokesNativePrint, true, 'the actual React button did not invoke window.print')
  evidence.checks.push({ kind: 'react-print-button', passed: true })

  // W3C /print exercises the *real* Firefox print medium, not an SSR stub.
  const printBase64 = await request(`/session/${sessionId}/print`, {
    method: 'POST',
    body: JSON.stringify({
      background: false,
      page: { width: 21, height: 29.7 },
      scale: 1,
      shrinkToFit: true,
    }),
  })
  const pdf = Buffer.from(printBase64, 'base64')
  assert.ok(pdf.subarray(0, 5).toString('ascii') === '%PDF-', 'Firefox did not generate a PDF')
  assert.ok(pdf.length > 2000 && pdf.length < 3_000_000, 'PDF unexpectedly empty or enormous')
  const pdfPath = path.join(artifactDir, 'synthetic-shopping-list.pdf')
  await writeFile(pdfPath, pdf)
  const printText = extractPdfText(pdfPath)
  assert.notEqual(printText, null, 'Poppler must verify the native PDF content')
  if (printText !== null) {
    assert.match(printText, /Boodschappenlijst/)
    assert.match(printText, /handmatig kiezen/)
    assert.match(printText, /voorbeeldgegevens/)
    assert.doesNotMatch(printText, /Schermhulp \(mag niet op papier verschijnen\)/)
    assert.doesNotMatch(printText, /Testnavigatie \(mag niet op papier verschijnen\)/)
    assert.doesNotMatch(printText, /€|Besparing:|bespaard/)
    evidence.pdfTextVerified = true
  }
  evidence.checks.push({
    kind: 'native-firefox-pdf',
    passed: true,
    bytes: pdf.length,
    containsPdfHeader: true,
    printTextVerifiedWithPoppler: evidence.pdfTextVerified,
  })
} finally {
  await request(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
  await writeFile(
    path.join(artifactDir, 'evidence.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
}
