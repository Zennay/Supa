import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const config = await readFile(new URL('.github/ISSUE_TEMPLATE/config.yml', root), 'utf8')
const form = await readFile(new URL('.github/ISSUE_TEMPLATE/bug-report.yml', root), 'utf8')
const policy = await readFile(new URL('SECURITY.md', root), 'utf8')

const blocks = form.split(/\n(?=  - type: )/u)

function field(id) {
  return blocks.find((block) => block.split('\n').some((line) => line.trim() === `id: ${id}`)) ?? null
}

test('public issue intake cannot bypass a structured form', () => {
  assert.match(config, /^blank_issues_enabled:\s*false\s*$/m)
  assert.match(config, /^contact_links:\s*$/m)
})

test('sensitive vulnerability reporting uses the repository private advisory URL', () => {
  assert.match(config, /https:\/\/github\.com\/Zennay\/Supa\/security\/advisories\/new/)
  assert.match(config, /privately instead of opening a public issue/i)
  assert.match(policy, /private vulnerability reporting/i)
})

test('public bug intake requires revision, reproduction and evidence boundaries', () => {
  for (const id of ['revision', 'reproduction', 'expected', 'actual', 'validation-context', 'evidence-boundary']) {
    const section = field(id)
    assert.ok(section, `missing required intake field: ${id}`)
    assert.match(section, /validations:\s*\n\s*required:\s*true/m, `${id} must be required`)
  }
})

test('public reporter privacy consent is required and mock savings are never field evidence', () => {
  const confirmations = field('reporter-confirmations')
  assert.ok(confirmations, 'privacy confirmation section is missing')
  assert.equal((confirmations.match(/required:\s*true/g) ?? []).length >= 3, true)
  assert.match(form, /Do not include credentials, personal data/i)
  assert.match(form, /not genuine retailer evidence/i)
  assert.match(form, /issue #78/i)
  assert.match(form, /PLUS baseline \+ DekaMarkt candidate/i)
})
