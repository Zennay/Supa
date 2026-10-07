import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const template = readFileSync(
  new URL('../.github/pull_request_template.md', import.meta.url),
  'utf8',
)

function requiresAll(...snippets) {
  for (const snippet of snippets) {
    assert.ok(
      template.includes(snippet),
      `pull request template must include: ${snippet}`,
    )
  }
}

test('pull request template requires scope ownership and exact-head validation evidence', () => {
  requiresAll(
    '## Scope and ownership',
    'checked the current open pull requests',
    'Exact head SHA:',
    'Validation commands executed on that exact head:',
    'npm ci',
    'npm audit --audit-level=high',
    'npm test',
    'Required gates / run IDs and conclusions:',
    'Hosted CI:',
    'Path-selected permanent workflow(s), if applicable:',
    'did not reuse an older green run',
  )

  assert.match(template, /npm ci\s+\n?npm audit --audit-level=high\s+\n?npm test/)
})

test('pull request template preserves the M3 genuine-evidence boundary', () => {
  requiresAll(
    '## Evidence boundary',
    'Mock, generated, deterministic, replayed, or fixture data',
    'not genuine retailer evidence',
    'not proof of savings',
    'PLUS baseline + DekaMarkt candidate',
    'issue #78',
    '## M3 claim impact',
    'Issue #78 remains the genuine M3 field-evidence dependency',
  )
})

test('pull request template routes sensitive findings to the security policy', () => {
  requiresAll(
    '## Security and privacy',
    '[SECURITY.md](https://github.com/Zennay/Supa/blob/main/SECURITY.md)',
    'credentials, personal data, receipt images, exploit details',
    'authorization for active testing of third-party retailers or services',
  )
})
