import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function hasQuotedPathTrigger(workflow, path) {
  return workflow.includes(`- "${path}"`) || workflow.includes(`- '${path}'`)
}

test('permanent VPS mobile validation watches every domain module', async () => {
  const workflow = await readFile(
    '.github/workflows/vps-mobile-foundation.yml',
    'utf8',
  )

  assert.equal(
    hasQuotedPathTrigger(workflow, 'src/domain/**'),
    true,
    'domain validation must fail safe: every src/domain change should trigger the permanent VPS test/build lane',
  )
})

test('mobile shell changes trigger both permanent VPS product gates', async () => {
  const mobileWorkflow = await readFile(
    '.github/workflows/vps-mobile-foundation.yml',
    'utf8',
  )
  const browserWorkflow = await readFile(
    '.github/workflows/m2-vps-e2e.yml',
    'utf8',
  )

  for (const path of ['index.html', 'tests/mobile-safe-area-contract.test.mjs']) {
    assert.equal(
      hasQuotedPathTrigger(mobileWorkflow, path),
      true,
      `permanent VPS mobile validation must trigger when ${path} changes`,
    )
    assert.equal(
      hasQuotedPathTrigger(browserWorkflow, path),
      true,
      `rendered browser proof must trigger when ${path} changes`,
    )
  }
})

test('permanent VPS mobile validation still runs the locked full test/build contract', async () => {
  const workflow = await readFile(
    '.github/workflows/vps-mobile-foundation.yml',
    'utf8',
  )

  assert.match(workflow, /^\s*runs-on:\s*self-hosted\s*$/m)
  assert.match(workflow, /^\s*- run: npm ci\s*$/m)
  assert.match(workflow, /^\s*- run: npm test\s*$/m)
  assert.match(workflow, /^\s*- run: npm run build\s*$/m)
  assert.match(workflow, /vps-bb300bba/)

  for (const path of ['package.json', 'package-lock.json', 'vite.config.*', 'tsconfig*.json']) {
    assert.equal(
      hasQuotedPathTrigger(workflow, path),
      true,
      `permanent VPS mobile validation must trigger when ${path} changes`,
    )
  }
})

test('rendered M2 proof watches every domain dependency in the planner-to-list route', async () => {
  const workflow = await readFile('.github/workflows/m2-vps-e2e.yml', 'utf8')
  const requiredRoutePaths = [
    'src/main.tsx',
    'src/styles.css',
    'src/components/**',
    'src/lib/**',
    'src/domain/basket.ts',
    'src/domain/basketComparison.ts',
    'src/domain/matching.ts',
    'src/domain/m3ObservationSheet.ts',
    'src/domain/planner.ts',
    'src/domain/plannerPreferences.ts',
    'src/domain/types.ts',
    'src/features/observation/**',
    'package.json',
    'package-lock.json',
    'vite.config.*',
    'tsconfig*.json',
  ]

  for (const path of requiredRoutePaths) {
    assert.equal(
      hasQuotedPathTrigger(workflow, path),
      true,
      `rendered M2 proof must trigger when ${path} changes`,
    )
  }

  assert.match(workflow, /^\s*runs-on:\s*self-hosted\s*$/m)
  assert.match(workflow, /vps-bb300bba/)
  assert.match(workflow, /node tests\/m2-browser-e2e\.mjs/)
})
