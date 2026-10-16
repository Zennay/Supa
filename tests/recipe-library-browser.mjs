import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

await mkdir('artifacts/recipe-ui', { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 440, height: 960 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto('http://127.0.0.1:4174')
  await page.getByRole('button', {name:'Recepten',exact:true}).click()
  await page.locator('.hifi-recipe-photo').first().waitFor()
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))))
  assert.equal(await page.locator('.hifi-recipe-card').count(), 6)
  await page.getByRole('button',{name:'Bekijk Groente pasta',exact:true}).click()
  assert.match(await page.locator('dialog[open]').innerText(), /250 g Spaghetti/)
  assert.match(await page.locator('dialog[open]').innerText(), /Voeg 400 g tomatenblokjes/)
  await page.getByRole('button',{name:'Details sluiten',exact:true}).click()
  const geometry = await page.locator('.hifi-recipe-card').first().boundingBox()
  assert.equal(geometry.width, 192); assert.equal(geometry.height, 143)
  assert.equal(await page.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0)), true)
  await page.screenshot({path:'artifacts/recipe-ui/recipes-440.png',fullPage:true})
  await page.getByRole('button',{name:'＋ Eigen recept',exact:true}).click()
  await page.getByLabel('Naam van het recept').fill('Mijn testcurry')
  await page.getByLabel('Ingrediënten',{exact:true}).fill('200 g rijst\n250 ml kokosmelk')
  await page.getByLabel('Bereiding',{exact:true}).fill('Kook de rijst.\nVoeg kokosmelk toe.')
  await page.getByRole('button',{name:'Controleer recept',exact:true}).click()
  await page.screenshot({path:'artifacts/recipe-ui/recipe-review-440.png',fullPage:true})
  await page.getByRole('button',{name:'Opslaan in mijn recepten',exact:true}).click()
  await page.getByRole('button',{name:'Bekijk Mijn testcurry',exact:true}).waitFor()
  await page.reload()
  await page.getByRole('button',{name:'Recepten',exact:true}).click()
  await page.getByRole('button',{name:'Bekijk Mijn testcurry',exact:true}).click()
  assert.match(await page.locator('dialog[open]').innerText(),/Kook de rijst/)
  await page.getByRole('button',{name:'Details sluiten',exact:true}).click()
  // Product-core acceptance: real browser refresh retains favorite selections.
  await page.getByRole('button',{name:'Favoriet: Mijn testcurry',exact:true}).click()
  await page.reload()
  await page.getByRole('button',{name:'Recepten',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Favoriet: Mijn testcurry',exact:true}).getAttribute('aria-pressed'),'true')

  // An actual second same-origin tab must update the existing recipe heart,
  // rather than requiring a full reload or writing back a stale snapshot.
  const otherTab = await page.context().newPage()
  await otherTab.goto('http://127.0.0.1:4174')
  await otherTab.evaluate(() => {
    const key = 'supa.recipe-favorites.v1'
    const state = JSON.parse(localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify({ ...state, ids: [] }))
  })
  await page.waitForFunction(() => document.querySelector('button[aria-label="Favoriet: Mijn testcurry"]')?.getAttribute('aria-pressed') === 'false')
  await otherTab.evaluate(() => {
    const key = 'supa.recipe-favorites.v1'
    const library = JSON.parse(localStorage.getItem('supa.recipe-library.v1'))
    const own = library.recipes.find(recipe => recipe.title === 'Mijn testcurry')
    localStorage.setItem(key, JSON.stringify({ version: 1, ids: [own.id] }))
  })
  await page.waitForFunction(() => document.querySelector('button[aria-label="Favoriet: Mijn testcurry"]')?.getAttribute('aria-pressed') === 'true')
  await otherTab.close()

  // Edit retains the same private recipe while updating fields and planner title.
  await page.getByRole('button',{name:'Bekijk Mijn testcurry',exact:true}).click()
  await page.getByRole('button',{name:'Bewerk eigen recept',exact:true}).click()
  await page.getByLabel('Naam van het recept').fill('Mijn testcurry aangepast')
  await page.getByLabel('Ingrediënten',{exact:true}).fill('500 g rijst\n250 ml kokosmelk')
  await page.getByRole('button',{name:'Controleer recept',exact:true}).click()
  await page.getByRole('button',{name:'Opslaan in mijn recepten',exact:true}).click()
  await page.getByRole('button',{name:'Bekijk Mijn testcurry aangepast',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Favoriet: Mijn testcurry aangepast',exact:true}).getAttribute('aria-pressed'),'true')

  // Duplicate creates an independently selectable recipe, then delete only that copy.
  await page.getByRole('button',{name:'Bekijk Mijn testcurry aangepast',exact:true}).click()
  await page.getByRole('button',{name:'Dupliceer recept',exact:true}).click()
  await page.getByRole('button',{name:'Bekijk Kopie van Mijn testcurry aangepast',exact:true}).waitFor()
  await page.getByRole('button',{name:'Bekijk Kopie van Mijn testcurry aangepast',exact:true}).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button',{name:'Verwijder eigen recept',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Bekijk Kopie van Mijn testcurry aangepast',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Bekijk Mijn testcurry aangepast',exact:true}).count(),1)
  await page.screenshot({path:'artifacts/recipe-ui/own-recipe-edit-duplicate-delete-440.png',fullPage:true})
  await page.getByRole('button',{name:'Planner',exact:true}).click()
  await page.locator('#recipe-Ma').selectOption({label:'Mijn testcurry aangepast'})
  assert.equal(await page.locator('#recipe-Ma').inputValue().then(x => x.startsWith('own-')),true)
  await page.screenshot({path:'artifacts/recipe-ui/planner-440.png',fullPage:true})
  await page.getByRole('button',{name:'Lijst',exact:true}).click()
  await page.screenshot({path:'artifacts/recipe-ui/list-440.png',fullPage:true})
  await page.getByRole('button',{name:'Producten',exact:true}).click()
  await page.screenshot({path:'artifacts/recipe-ui/products-440.png',fullPage:true})
  await page.getByRole('button',{name:'Recepten',exact:true}).click()
  // Deterministic UI boundary test; actual HTTP + parser path has separate native tests.
  await page.route('**/api/recipes/import', route => route.fulfill({json:{draft:{source:'url',sourceUrl:'https://recipes.example.org/soep',title:'Geïmporteerde soep',servings:2,minutes:25,ingredients:[{original:'250 g wortels',label:'wortels',query:'wortels',amount:250,unit:'g',reviewReason:null}],steps:['Kook de wortels.'],warnings:[],status:'needs_review'}}}))
  await page.getByRole('button',{name:'Importeer via link',exact:true}).click()
  await page.getByLabel('Receptlink',{exact:true}).fill('https://recipes.example.org/soep')
  await page.getByRole('button',{name:'Importeer recept',exact:true}).click()
  await page.getByLabel('Naam van het recept').waitFor()
  assert.equal(await page.getByLabel('Naam van het recept').inputValue(),'Geïmporteerde soep')
  await page.getByRole('button',{name:'Controleer recept',exact:true}).click()
  await page.getByRole('button',{name:'Opslaan in mijn recepten',exact:true}).click()
  await page.getByRole('button',{name:'Bekijk Geïmporteerde soep',exact:true}).waitFor()
  // Real portable JSON backup from UI: explicit download, reviewed merge and no replacement.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button',{name:'Maak back-up',exact:true}).click()
  const download = await downloadPromise
  assert.equal(download.suggestedFilename(), 'supa-mijn-recepten.json')
  const backup = await readFile(await download.path(), 'utf8')
  const exported = JSON.parse(backup)
  assert.equal(exported.format, 'supa-private-recipes-backup')
  assert.equal(exported.recipes.length, 2)
  assert.equal('id' in exported.recipes[0], false)
  // Native window.confirm explicitly authorizes a non-destructive merge.
  page.once('dialog', dialog => dialog.accept())
  await page.locator('input[aria-label="Supa receptenback-up bestand"]').setInputFiles({
    name:'my-private-recipes.json',mimeType:'application/json',buffer:Buffer.from(backup),
  })
  await page.getByText(/2 recepten veilig toegevoegd/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Bekijk Mijn testcurry aangepast',exact:true}).count(), 2)
  const corruptFile = '{"format":"supa-private-recipes-backup","version":99,"recipes":[]}'
  await page.locator('input[aria-label="Supa receptenback-up bestand"]').setInputFiles({
    name:'corrupt.json',mimeType:'application/json',buffer:Buffer.from(corruptFile),
  })
  await page.getByText(/Onbekend of te groot Supa-back-upformaat/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Bekijk Mijn testcurry aangepast',exact:true}).count(), 2)

  await page.setViewportSize({width:320,height:800})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true)
  await page.screenshot({path:'artifacts/recipe-ui/own-recipes-320.png',fullPage:true})
  assert.deepEqual(errors,[])
  await writeFile('artifacts/recipe-ui/result.json',JSON.stringify({status:'passed',checks:['six real, fully specified recipes with matching Figma photos','192x143 geometry','all local images loaded','manual recipe review/save','reload persistence and favorites','edit/duplicate/confirmed delete of private recipe','canonical planner recipe','URL import review/save UI with synthetic response','320px overflow','no runtime errors']},null,2))
} finally { await browser.close() }
