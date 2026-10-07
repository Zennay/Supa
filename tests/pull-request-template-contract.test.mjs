import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const template = await readFile('.github/pull_request_template.md', 'utf8')

test('pull request template locks ownership and exact-head validation fields', () => {
  assert.match(template, /## Ownership \/ parallel boundary/)
  assert.match(template, /Active-owner overlap checked/)
  assert.match(template, /Exact head SHA/)
  assert.match(template, /npm ci/)
  assert.match(template, /npm test/)
  assert.match(template, /npm run m1:matching-benchmark/)
  assert.match(template, /npm run m1:source-permission-gate/)
  assert.match(template, /npm run build/)
  assert.match(template, /workflow is green on this exact head/i)
})

test('pull request template preserves M3 evidence and claim boundaries', () => {
  assert.match(template, /Mock\/generated data is never genuine retailer evidence or savings proof/i)
  assert.match(template, /M3 issue #78 genuine PLUS \+ DekaMarkt field-evidence dependency/)
  assert.match(template, /Public savings claim eligibility changed/)
})

test('pull request template routes sensitive reports to the security policy', () => {
  assert.match(template, /\[SECURITY\.md\]\(\.\.\/SECURITY\.md\)/)
  assert.match(template, /No credentials, personal data, tokens, receipt images/i)
  assert.match(template, /authorization to actively test or scrape third-party retailer systems/i)
})
