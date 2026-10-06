import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = '.github/workflows/vps-mobile-foundation.yml'

test('permanent VPS mobile validation watches every domain module', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(
    workflow,
    /^\s*- ["']src\/domain\/\*\*["']\s*$/m,
    'domain validation must fail safe: every src/domain change should trigger the permanent VPS test/build lane',
  )
})

test('permanent VPS mobile validation still runs the locked full test/build contract', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(workflow, /^\s*runs-on:\s*self-hosted\s*$/m)
  assert.match(workflow, /^\s*- run: npm ci\s*$/m)
  assert.match(workflow, /^\s*- run: npm test\s*$/m)
  assert.match(workflow, /^\s*- run: npm run build\s*$/m)
  assert.match(workflow, /vps-bb300bba/)
})
