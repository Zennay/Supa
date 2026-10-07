import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const issueForm = readFileSync(
  new URL('../.github/ISSUE_TEMPLATE/bug-report.yml', import.meta.url),
  'utf8',
)

function requiresAll(...snippets) {
  for (const snippet of snippets) {
    assert.ok(
      issueForm.includes(snippet),
      `bug report issue form must include: ${snippet}`,
    )
  }
}

test('bug report issue form requires reproducible revision and validation context', () => {
  requiresAll(
    'name: Bug report',
    'id: revision',
    'label: Exact commit or ref',
    'id: reproduction',
    'label: Reproduction steps',
    'id: expected',
    'label: Expected behavior',
    'id: actual',
    'label: Actual behavior',
    'id: validation-context',
    'label: Validation context',
    'required: true',
  )
})

test('bug report issue form preserves privacy and security routing boundaries', () => {
  requiresAll(
    'Do not include credentials, personal data, receipt images, private account data, or sensitive retailer data.',
    '[SECURITY.md](https://github.com/Zennay/Supa/blob/main/SECURITY.md)',
    'I removed credentials, personal data, receipt images, private account data, and sensitive retailer data',
  )
})

test('bug report issue form does not let controlled data become M3 evidence', () => {
  requiresAll(
    'Mock, generated, deterministic, replayed, or fixture data is test material only.',
    'not genuine retailer evidence',
    'not proof of savings',
    'Issue #78 remains the genuine same-demand PLUS baseline + DekaMarkt candidate M3 field-evidence gate.',
    'id: evidence-boundary',
    'label: Evidence and claim boundary',
    'issue #78 remains the genuine M3 field-evidence gate',
  )
})
