// Real browser + real server: an own recipe and a planned meal made on one
// device come back on a second browser that uses the same device key.
// Run after `npm run build` with `npm start` serving http://127.0.0.1:4174.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.SUPA_URL ?? 'http://127.0.0.1:4174'
await mkdir('artifacts/sync-ui', { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  const first = await browser.newContext({ viewport: { width: 440, height: 960 } })
  const page = await first.newPage(); page.on('pageerror', e => errors.push(e.message))
  await page.goto(base)
  await page.getByRole('button', { name: 'Recepten', exact: true }).click()
  await page.getByRole('button', { name: '＋ Eigen recept', exact: true }).click()
  await page.getByLabel('Naam van het recept').fill('Sync testsoep')
  await page.getByLabel('Ingrediënten', { exact: true }).fill('200 g linzen\n1 l bouillon')
  await page.getByLabel('Bereiding', { exact: true }).fill('Kook de linzen in de bouillon.')
  await page.getByRole('button', { name: 'Controleer recept', exact: true }).click()
  await page.getByRole('button', { name: 'Opslaan in mijn recepten', exact: true }).click()
  await page.getByRole('button', { name: 'Bekijk Sync testsoep', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Planner', exact: true }).click()
  await page.locator('#recipe-Ma').selectOption({ label: 'Sync testsoep' })

  // Background sync pushes within a few seconds; wait for the server copy.
  const deviceKey = await page.evaluate(() => localStorage.getItem('supa:device-key:v1'))
  assert.match(deviceKey, /^[A-Za-z0-9_-]{43}$/)
  let remote
  for (let attempt = 0; attempt < 40; attempt++) {
    remote = await (await fetch(`${base}/api/sync`, { headers: { authorization: `Bearer ${deviceKey}` } })).json()
    if (remote.entries?.['supa:planner-preferences:v2']?.includes('own-')) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.match(remote.entries['supa.recipe-library.v1'], /Sync testsoep/)
  assert.match(remote.entries['supa:planner-preferences:v2'], /"Ma":"own-/)

  // A fresh browser profile linked to the same device key.
  const second = await browser.newContext({ viewport: { width: 440, height: 960 } })
  await second.addInitScript(key => { if (!localStorage.getItem('supa:device-key:v1')) localStorage.setItem('supa:device-key:v1', key) }, deviceKey)
  const other = await second.newPage(); other.on('pageerror', e => errors.push(e.message))
  await other.goto(base)
  await other.getByRole('button', { name: 'Planner', exact: true }).click()
  const selected = await other.locator('#recipe-Ma option:checked').innerText()
  assert.equal(selected.trim(), 'Sync testsoep')
  await other.screenshot({ path: 'artifacts/sync-ui/restored-planner-440.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('sync browser check passed')
} finally {
  await browser.close()
}
