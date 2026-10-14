import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const readmeUrl = new URL('../README.md', import.meta.url)
const securityUrl = new URL('../SECURITY.md', import.meta.url)

function securitySection(document) {
  let active = false
  const lines = []
  for (const line of document.split(/\r?\n/u)) {
    if (/^#{1,6}\s+/u.test(line)) {
      if (active) break
      active = /^##\s+Security\s*$/iu.test(line)
      continue
    }
    if (active) lines.push(line)
  }
  return lines.join('\n')
}

function hasLocalReportingLink(section) {
  return [...section.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].some(
    ([, label, target]) => label === 'SECURITY.md' && target === 'SECURITY.md',
  )
}

test('README exposes the repository-local security reporting policy', async () => {
  const [readme, policy, policyStat] = await Promise.all([
    readFile(readmeUrl, 'utf8'),
    readFile(securityUrl, 'utf8'),
    stat(securityUrl),
  ])
  assert.ok(policyStat.isFile(), 'security target must be a checked-in file')
  assert.ok(hasLocalReportingLink(securitySection(readme)),
    'README Security section must link to local SECURITY.md')
  assert.match(policy, /^# Security Policy\s*$/mu)
  assert.match(policy, /## Reporting a vulnerability/u)
})

test('security discoverability guard rejects remote, parent and disguised links', () => {
  for (const target of [
    'https://example.test/SECURITY.md',
    '../SECURITY.md',
    './docs/SECURITY.md',
    'SECURITY.md#external',
    'SECURITY%2Emd',
  ]) {
    assert.equal(hasLocalReportingLink('See [SECURITY.md](' + target + ')'), false, target)
  }
  assert.equal(hasLocalReportingLink('See [SECURITY.md](SECURITY.md)'), true)
  assert.equal(securitySection('## Important\nSee [SECURITY.md](SECURITY.md)\n## Security\nMissing'), 'Missing')
})
