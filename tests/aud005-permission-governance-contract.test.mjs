import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const permissionPath = 'docs/research/2026-10-05-retailer-permission-path.md'
const routingPath = 'docs/research/2026-10-05-retailer-outreach-routing.md'
const evidenceReadmePath = 'evidence/aud005/README.md'
const gitignorePath = '.gitignore'

test('AUD-005 documentation keeps production permission separate from technical accessibility', async () => {
  const [permission, routing, evidenceReadme, gitignore] = await Promise.all([
    readFile(permissionPath, 'utf8'),
    readFile(routingPath, 'utf8'),
    readFile(evidenceReadmePath, 'utf8'),
    readFile(gitignorePath, 'utf8'),
  ])

  for (const [documentName, document] of [
    ['permission path', permission],
    ['outreach routing', routing],
  ]) {
    assert.match(
      document,
      /does (?:\*\*)?not(?:\*\*)? (?:grant|treat).*permission|not sufficient|reuse remains disabled/i,
      `${documentName} must reject technical/public accessibility as production permission`,
    )
    assert.match(
      document,
      /production.*(?:reuse|automation).*?(?:disabled|until)|do not enable production-scale source reuse/i,
      `${documentName} must keep production reuse gated`,
    )
  }

  assert.match(permission, /explicit written retailer permission/i)
  assert.match(permission, /licensed\/contracted data provider/i)
  assert.match(permission, /technical feasibility or a public webpage alone is not sufficient/i)

  assert.match(routing, /one substantive response or interview from PLUS/i)
  assert.match(routing, /one substantive response or interview from DekaMarkt/i)
  assert.match(routing, /keep M3 manual evidence collection independent/i)
  assert.match(
    routing,
    /npm run aud005:record-retailer-response/,
    'routing contract must retain the repository-safe response recorder',
  )
  assert.match(
    routing,
    /artifacts\/aud005\/<retailer>-<response-id>\.json/,
    'routing contract must use a unique per-response evidence path',
  )
  assert.match(
    routing,
    /fails if the output path already exists/i,
    'routing contract must explain the no-clobber recorder boundary',
  )
  assert.match(
    routing,
    /do not delete, overwrite, or reuse a prior response artifact/i,
    'routing contract must preserve prior stakeholder evidence',
  )
  assert.match(
    routing,
    /--output evidence\/aud005\/<retailer>-<response-id>\.json/,
    'durable AUD-005 responses must use the tracked evidence lane',
  )
  assert.doesNotMatch(
    routing,
    /--output artifacts\/aud005\//,
    'ignored generated artifacts must not be the durable retailer-response record',
  )
  assert.match(gitignore, /^artifacts\/$/m)
  assert.match(evidenceReadme, /durable, privacy-safe derived stakeholder-response records/i)
  assert.match(evidenceReadme, /do \*\*not\*\*.*authorize production automated retailer-data reuse/is)
  assert.match(evidenceReadme, /do \*\*not\*\*.*count as M3 observed-basket evidence/is)
})

test('AUD-005 evidence contract preserves non-approval outcomes instead of coercing them to permission', async () => {
  const [permission, routing] = await Promise.all([
    readFile(permissionPath, 'utf8'),
    readFile(routingPath, 'utf8'),
  ])

  for (const outcome of [
    'licensed feed required',
    'manual/research-only allowed',
    'automated use denied',
    'no suitable route',
  ]) {
    assert.equal(
      permission.toLowerCase().includes(outcome.toLowerCase()),
      true,
      `permission path must retain valid outcome: ${outcome}`,
    )
  }

  assert.match(
    routing,
    /denial, licensing requirement, or “no suitable route” is useful evidence/i,
  )
  assert.match(routing, /must be preserved rather than reinterpreted as approval/i)
})
