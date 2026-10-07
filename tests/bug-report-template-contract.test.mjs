import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const form = await readFile('.github/ISSUE_TEMPLATE/bug-report.yml', 'utf8')

test('bug intake requires reproducible revision and behavior context', () => {
  assert.match(form, /id: revision/)
  assert.match(form, /Exact commit or ref/)
  assert.match(form, /id: reproduction/)
  assert.match(form, /id: expected/)
  assert.match(form, /id: actual/)
  assert.match(form, /id: validation/)
  assert.match(form, /required: true/)
})

test('bug intake preserves privacy and M3 evidence boundaries', () => {
  assert.match(form, /Do not include credentials, personal data, tokens, full receipt images/i)
  assert.match(form, /Mock\/generated data is not genuine retailer evidence or savings proof/i)
  assert.match(form, /issue #78/)
  assert.match(form, /PLUS \+ DekaMarkt/)
  assert.match(form, /does not authorize active testing or scraping of third-party retailer systems/i)
})
