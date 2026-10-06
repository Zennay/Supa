import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = '.github/workflows/m3-observed-week-report.yml'

function hasQuotedPathTrigger(workflow, path) {
  return workflow.includes(`- "${path}"`) || workflow.includes(`- '${path}'`)
}

test('M3 observed-week workflow preserves the field-evidence execution boundary', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m)
  assert.match(workflow, /^\s*permissions:\s*\n\s*contents:\s*read\s*$/m)
  assert.match(workflow, /^\s*runs-on:\s*self-hosted\s*$/m)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /^\s*- run: npm ci\s*$/m)

  assert.match(
    workflow,
    /npm run m3:create-observation-sheet -- --output artifacts\/m3\/observation-sheet\.json/,
  )
  assert.match(workflow, /^\s*if:\s*github\.event_name == 'workflow_dispatch'\s*$/m)
  assert.match(workflow, /^\s*name:\s*supa-m3-field-run-pack\s*$/m)
  assert.match(workflow, /^\s*path:\s*artifacts\/m3\/observation-sheet\.json\s*$/m)
  assert.match(workflow, /^\s*if-no-files-found:\s*error\s*$/m)

  assert.match(workflow, /^\s*- run: npm test\s*$/m)
  assert.match(workflow, /^\s*- run: npm run build\s*$/m)
})

test('M3 observed-week workflow keeps every evidence-boundary dependency in its PR trigger', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const requiredPaths = [
    '.github/workflows/m3-observed-week-report.yml',
    'scripts/m3-create-observation-sheet.mjs',
    'scripts/m3-build-observed-study.mjs',
    'scripts/m3-assess-observed-week.mjs',
    'src/domain/observedBasketStudy.ts',
    'src/domain/basketComparison.ts',
    'src/domain/savingsAttribution.ts',
    'tests/m3-observation-sheet.test.mjs',
    'tests/m3-build-observed-study.test.mjs',
    'tests/m3-observed-study-report.test.mjs',
    'tests/m3-savings-attribution.test.mjs',
    'tests/m3-workflow-contract.test.mjs',
    'package.json',
  ]

  for (const path of requiredPaths) {
    assert.equal(
      hasQuotedPathTrigger(workflow, path),
      true,
      `M3 observed-week validation must trigger when ${path} changes`,
    )
  }
})

test('M3 observed-week workflow retains focused evidence tests before the full suite', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const focusedCommand =
    'node --experimental-strip-types --test tests/m3-observation-sheet.test.mjs tests/m3-build-observed-study.test.mjs tests/m3-observed-study-report.test.mjs tests/m3-savings-attribution.test.mjs tests/m3-workflow-contract.test.mjs'

  assert.equal(workflow.includes(focusedCommand), true)

  const focusedIndex = workflow.indexOf(focusedCommand)
  const fullSuiteIndex = workflow.indexOf('- run: npm test')
  const buildIndex = workflow.indexOf('- run: npm run build')

  assert.ok(focusedIndex >= 0)
  assert.ok(fullSuiteIndex > focusedIndex)
  assert.ok(buildIndex > fullSuiteIndex)
})
