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
    'scripts/m3-source-output-preservation.mjs',
    'tests/m3-cli-source-alias-regression.test.mjs',
    'tests/m3-cli-parent-alias-regression.test.mjs',
    'tests/m3-cli-distinct-output-rerun.test.mjs',
    'src/domain/observedBasketStudy.ts',
    'src/domain/basket.ts',
    'src/domain/m3ObservationSheet.ts',
    'src/data/m2Fixture.ts',
    'src/domain/decimalPackArithmetic.ts',
    'src/domain/types.ts',
    'src/domain/matching.ts',
    'src/domain/basketComparison.ts',
    'src/domain/savingsAttribution.ts',
    'tests/m3-observation-sheet.test.mjs',
    'tests/m3-build-observed-study.test.mjs',
    'tests/m3-observed-study-report.test.mjs',
    'tests/m3-savings-attribution.test.mjs',
    'tests/qa-m3-attribution-root-shape.test.mjs',
    'tests/qa-m3-attribution-guard-edge-controls.test.mjs',
    'tests/m3-workflow-contract.test.mjs',
    'tests/m3-workflow-transitive-trigger-closure.test.mjs',
    'package.json',
    'package-lock.json',
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

// This workflow runs on a persistent self-hosted VPS. A PR from a fork
// must not be able to execute its checkout-controlled code on that host.
test('M3 permanent VPS gate excludes untrusted fork pull-request heads', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(workflow, /^\s*runs-on:\s*self-hosted\s*$/m)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/)
  assert.match(workflow, /if:\s*\(github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'\)\s*\|\|\s*\(github\.event_name\s*==\s*'pull_request'[^\n]*github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository\)/)
  assert.match(workflow, /uses:\s*actions\/checkout@[0-9a-f]{40}\s+# v\d+\.\d+\.\d+\s*\n\s*with:\s*\n\s*persist-credentials:\s*false/)
})

test('M3 independent attribution test paths cannot silently lose VPS trigger coverage', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  for (const path of [
    'tests/qa-m3-attribution-root-shape.test.mjs',
    'tests/qa-m3-attribution-guard-edge-controls.test.mjs',
  ]) {
    assert.equal(hasQuotedPathTrigger(workflow, path), true)
    const mutant = workflow.replace('      - "' + path + '"', '')
    assert.notEqual(mutant, workflow, 'missing QA path fixture: ' + path)
    assert.equal(hasQuotedPathTrigger(mutant, path), false)
  }
})

function validateDispatchOnlyFieldPackUpload(workflow) {
  const lines = workflow.split(/\r?\n/u)
  const title = '      - name: Upload M3 field-run pack'
  const indices = lines.flatMap((line, index) => line === title ? [index] : [])
  assert.equal(indices.length, 1, 'exactly one M3 field-pack upload step')
  const index = indices[0]
  const step = []
  for (let next = index + 1; next < lines.length; next += 1) {
    if (lines[next].startsWith('      - ')) break
    step.push(lines[next])
  }
  assert.ok(step.includes("        if: github.event_name == 'workflow_dispatch'"),
    'upload step itself must require an explicit human workflow dispatch')
  assert.ok(step.some((line) => /^        uses: actions\/upload-artifact@[a-f0-9]{40}(?:\s+#.*)?$/u.test(line)),
    'field-pack upload must be bound to its intended pinned upload action')
  const uploads = lines.filter((line) => /^\s+uses: actions\/upload-artifact@/u.test(line))
  assert.equal(uploads.length, 1, 'no extra unguarded artifact upload action')
}

test('M3 field-pack upload is dispatch-only on the actual step, not a nearby step', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  validateDispatchOnlyFieldPackUpload(workflow)

  // A global search for a dispatch-only condition can be fooled if it is
  // moved to another step: the upload itself must own the guard.
  const removed = workflow.replace(
    "      - name: Upload M3 field-run pack\n        if: github.event_name == 'workflow_dispatch'\n",
    '      - name: Upload M3 field-run pack\n',
  )
  assert.notEqual(removed, workflow)
  assert.throws(() => validateDispatchOnlyFieldPackUpload(removed))

  const loosened = workflow.replace(
    "        if: github.event_name == 'workflow_dispatch'\n",
    '        if: always()\n',
  )
  assert.notEqual(loosened, workflow)
  assert.throws(() => validateDispatchOnlyFieldPackUpload(loosened))

  const duplicate = workflow.replace(
    '      - name: Upload M3 field-run pack',
    '      - name: Upload M3 field-run pack\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  )
  assert.notEqual(duplicate, workflow)
  assert.throws(() => validateDispatchOnlyFieldPackUpload(duplicate))
})

test('M3 manual field-run pack runs only on the current main ref', async () => {
  const yaml = await readFile(workflowPath, 'utf8')
  const jobCondition = yaml.split(/\r?\n/u).find((line) => line.startsWith('    if: '))
  const trustedCondition = "    if: (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.base_ref == 'main' && github.event.pull_request.head.repo.full_name == github.repository)"
  assert.equal(jobCondition, trustedCondition,
    'branch-pinned workflow_dispatch and same-repository main PR condition must both remain exact')

  for (const invalid of [
    "    if: github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && github.base_ref == 'main' && github.event.pull_request.head.repo.full_name == github.repository)",
    trustedCondition.replace(" && github.ref == 'refs/heads/main'", ''),
    trustedCondition.replace('refs/heads/main', 'refs/heads/feature'),
    trustedCondition.replace("github.event.pull_request.head.repo.full_name == github.repository", 'true'),
  ]) {
    assert.notEqual(invalid, trustedCondition)
    assert.notEqual(invalid, jobCondition, 'unsafe manual dispatch or PR condition would bypass source pin')
  }
})
