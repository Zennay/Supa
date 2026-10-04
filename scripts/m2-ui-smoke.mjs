import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const previewUrl = 'http://127.0.0.1:4173'
const webdriverUrl = 'http://127.0.0.1:4444'
const elementKey = 'element-6066-11e4-a52e-4f735466cecf'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHttp(url, label, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Process is still starting.
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}: ${url}`)
}

async function request(method, path, body) {
  const response = await fetch(`${webdriverUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.value?.error) {
    throw new Error(
      `WebDriver ${method} ${path} failed: ${JSON.stringify(payload)}`,
    )
  }
  return payload.value
}

function currencyText(value) {
  return String(value).replace(/[\u00a0\u202f]/g, ' ').trim()
}

async function main() {
  const preview = spawn(
    'npm',
    ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { stdio: 'inherit' },
  )
  const driver = spawn(
    'geckodriver',
    ['--host', '127.0.0.1', '--port', '4444'],
    { stdio: 'inherit' },
  )

  let sessionId = null

  try {
    await Promise.all([
      waitForHttp(previewUrl, 'Vite preview'),
      waitForHttp(`${webdriverUrl}/status`, 'geckodriver'),
    ])

    const session = await request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            args: ['-headless'],
          },
        },
      },
    })
    sessionId = session.sessionId

    const execute = (script, args = []) =>
      request('POST', `/session/${sessionId}/execute/sync`, {
        script,
        args,
      })

    const navigate = (url) =>
      request('POST', `/session/${sessionId}/url`, { url })

    const waitForDom = async (script, expected, label, attempts = 60) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const value = await execute(script)
        if (expected(value)) return value
        await sleep(100)
      }
      throw new Error(`Timed out waiting for DOM assertion: ${label}`)
    }

    await navigate(previewUrl)

    const initialTotal = await waitForDom(
      "return document.querySelector('.budget-summary strong')?.textContent ?? null",
      (value) => Boolean(value),
      'initial planner total',
    )
    assert.equal(currencyText(initialTotal), '€ 30,08')

    const selectedRecipe = await execute(`
      const select = document.querySelector('#recipe-Di')
      if (!select) throw new Error('recipe-Di select missing')
      select.value = 'pasta'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return select.value
    `)
    assert.equal(selectedRecipe, 'pasta')

    await execute(`
      const button = [...document.querySelectorAll('.bottom-nav button')]
        .find((candidate) => candidate.textContent.trim() === 'Mand')
      if (!button) throw new Error('Mand navigation button missing')
      button.click()
    `)

    const changedBasketTotal = await waitForDom(
      "return document.querySelector('.hero-total > strong')?.textContent ?? null",
      (value) => currencyText(value) === '€ 23,30',
      'basket total after changing Di to pasta',
    )
    assert.equal(currencyText(changedBasketTotal), '€ 23,30')

    await execute(`
      const button = [...document.querySelectorAll('.bottom-nav button')]
        .find((candidate) => candidate.textContent.trim() === 'Lijst')
      if (!button) throw new Error('Lijst navigation button missing')
      button.click()
    `)

    const shoppingText = await waitForDom(
      "return document.querySelector('.list-card')?.innerText ?? ''",
      (value) => String(value).includes('Tomatenblokjes 400 g'),
      'shopping list generated from changed plan',
    )
    assert.match(shoppingText, /Tomatenblokjes 400 g/)
    assert.match(shoppingText, /2 × 400 g/)

    await execute(`
      const button = [...document.querySelectorAll('.bottom-nav button')]
        .find((candidate) => candidate.textContent.trim() === 'Planner')
      if (!button) throw new Error('Planner navigation button missing')
      button.click()
    `)

    await waitForDom(
      "return document.querySelector('#recipe-Di')?.value ?? null",
      (value) => value === 'pasta',
      'planner restored after tab switch',
    )

    await execute(`
      const dayButton = document.querySelector('button[aria-label="Do uit planning halen"]')
      if (!dayButton) throw new Error('Do toggle missing')
      dayButton.click()

      const budgetButton = [...document.querySelectorAll('.budget-chip')]
        .find((candidate) => candidate.textContent.includes('40'))
      if (!budgetButton) throw new Error('€40 budget button missing')
      budgetButton.click()
    `)

    const reducedTotal = await waitForDom(
      "return document.querySelector('.budget-summary strong')?.textContent ?? null",
      (value) => currencyText(value) === '€ 16,52',
      'basket-backed planner total after disabling Do',
    )
    assert.equal(currencyText(reducedTotal), '€ 16,52')

    await navigate(previewUrl)

    const persisted = await waitForDom(
      `return {
        recipe: document.querySelector('#recipe-Di')?.value ?? null,
        doPressed: document.querySelector('button[aria-label="Do aan planning toevoegen"]')?.getAttribute('aria-pressed') ?? null,
        budget: document.querySelector('#weekbudget-title')?.textContent ?? null,
        total: document.querySelector('.budget-summary strong')?.textContent ?? null,
      }`,
      (value) =>
        value?.recipe === 'pasta' &&
        value?.doPressed === 'false' &&
        currencyText(value?.budget) === '€ 40,00' &&
        currencyText(value?.total) === '€ 16,52',
      'persisted full-week planner state after reload',
    )

    assert.equal(persisted.recipe, 'pasta')
    assert.equal(persisted.doPressed, 'false')
    assert.equal(currencyText(persisted.budget), '€ 40,00')
    assert.equal(currencyText(persisted.total), '€ 16,52')

    console.log(
      JSON.stringify(
        {
          status: 'pass',
          initialTotal: currencyText(initialTotal),
          changedBasketTotal: currencyText(changedBasketTotal),
          changedShoppingLine: 'Tomatenblokjes 400 g · 2 × 400 g',
          persisted: {
            recipeDi: persisted.recipe,
            doActive: false,
            budget: currencyText(persisted.budget),
            basketTotal: currencyText(persisted.total),
          },
        },
        null,
        2,
      ),
    )
  } finally {
    if (sessionId) {
      await request('DELETE', `/session/${sessionId}`).catch(() => undefined)
    }
    preview.kill('SIGTERM')
    driver.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
