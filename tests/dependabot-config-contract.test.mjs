import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = await readFile('.github/dependabot.yml', 'utf8')

function ecosystemBlock(name) {
  const marker = `  - package-ecosystem: "${name}"`
  const start = config.indexOf(marker)
  assert.ok(start >= 0, `Dependabot must configure ${name}`)

  const next = config.indexOf('\n  - package-ecosystem:', start + marker.length)
  return config.slice(start, next >= 0 ? next : undefined)
}

test('Dependabot keeps both npm and GitHub Actions update lanes', () => {
  assert.match(config, /^version:\s*2\s*$/m)

  const ecosystems = [
    ...config.matchAll(/^\s*- package-ecosystem:\s*"([^"]+)"\s*$/gm),
  ].map((match) => match[1])

  assert.deepEqual(ecosystems.sort(), ['github-actions', 'npm'])
})

test('dependency update lanes stay bounded, weekly and staggered', () => {
  const expectedTimes = new Map([
    ['npm', '06:00'],
    ['github-actions', '06:15'],
  ])

  for (const [ecosystem, expectedTime] of expectedTimes) {
    const block = ecosystemBlock(ecosystem)

    assert.match(block, /^\s*directory:\s*"\/"\s*$/m)
    assert.match(block, /^\s*interval:\s*"weekly"\s*$/m)
    assert.match(block, /^\s*day:\s*"monday"\s*$/m)
    assert.match(
      block,
      new RegExp(`^\\s*time:\\s*"${expectedTime}"\\s*$`, 'm'),
      `${ecosystem} must keep its staggered update time`,
    )
    assert.match(block, /^\s*timezone:\s*"Europe\/Amsterdam"\s*$/m)

    const limit = block.match(/^\s*open-pull-requests-limit:\s*(\d+)\s*$/m)
    assert.ok(limit, `${ecosystem} must bound open update pull requests`)
    assert.ok(Number(limit[1]) >= 1 && Number(limit[1]) <= 10)
  }
})
