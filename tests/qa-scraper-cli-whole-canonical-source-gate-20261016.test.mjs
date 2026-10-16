import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent offline #3436 acceptance: an operator's fictional private Dirk
// approval cannot bypass invalid evidence for unrelated canonical PLUS/Deka.
// No actual source receives legal permission, and every run must be rejected
// BEFORE a SQLite DB, browser or any retailer request is opened.
const cli = fileURLToPath(new URL('../scraper/cli.mjs', import.meta.url))
const canonical = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)

const mutants = [
  ['missing Deka sibling', gate => { gate.sources = gate.sources.filter(x => x.supermarket !== 'dekamarkt') }],
  ['duplicate PLUS sibling', gate => { gate.sources.push(structuredClone(gate.sources.find(x => x.supermarket === 'plus'))) }],
  ['PLUS falsely permitted without a license', gate => {
    gate.sources.find(x => x.supermarket === 'plus').permissionStatus = 'permitted'
  }],
  ['Deka production flag contradicts its unresolved rights', gate => {
    gate.sources.find(x => x.supermarket === 'dekamarkt').productionEnabled = true
  }],
  ['future canonical review timestamp', gate => { gate.reviewedAt = '2099-01-01' }],
  ['wrong canonical milestone', gate => { gate.milestone = 'M3 fictitious milestone' }],
  ['non-HTTPS evidence source', gate => {
    gate.sources.find(x => x.supermarket === 'plus').evidence[0].url = 'http://example.test/not-licensed'
  }],
]

for (const [name, mutate] of mutants) {
  test('standalone scraper refuses whole-source canonical gate mutation: ' + name, async t => {
    const root = await mkdtemp(join(tmpdir(), 'supa-full-rights-denial-'))
    t.after(async () => rm(root, { recursive: true, force: true }))
    const gatePath = join(root, 'invalid-canonical.json')
    const policyPath = join(root, 'synthetic-policy.json')
    const dbPath = join(root, 'MUST-NOT-EXIST.sqlite')
    const gate = JSON.parse(await readFile(canonical, 'utf8'))
    mutate(gate)
    await writeFile(gatePath, JSON.stringify(gate))
    await writeFile(policyPath, JSON.stringify({
      version: 1,
      sources: [{
        id: 'dirk', enabled: true, publicationApproved: true,
        scope: 'public-product-prices', basis: 'documented_legal_review',
        reviewedAt: new Date().toISOString().slice(0, 10),
        evidenceUrl: 'https://example.test/fictional-only',
        scopeNote: 'QA only, not a retailer license or actual collection permission.',
      }],
    }))
    const run = spawnSync(process.execPath, [
      cli, 'scrape', '--retailer', 'dirk', '--limit', '1', '--db', dbPath,
    ], {
      encoding: 'utf8', timeout: 15000,
      env: {
        ...process.env,
        SUPA_SCRAPER_POLICY: policyPath,
        SUPA_SOURCE_PERMISSION_GATE: gatePath,
      },
    })
    assert.ifError(run.error)
    assert.equal(run.status, 1, run.stderr)
    assert.equal(run.stdout, '', 'no candidate SKU or price after invalid canonical gate')
    assert.match(run.stderr, /Direct retailer scrape refused: source rights unverified/u)
    assert.doesNotMatch(run.stderr, /https?:\/\/|€|scopeNote|evidenceUrl|fictional-only/u,
      'private policy, source and price must never appear in denial logs')
    await assert.rejects(stat(dbPath), { code: 'ENOENT' })
  })
}
