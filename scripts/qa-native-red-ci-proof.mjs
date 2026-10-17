import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const MAX_LOG_BYTES = 12 * 1024 * 1024
const FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/
const PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /

function plainLine(line) {
  return line.replace(PREFIX, '').replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Verify a deliberately RED GitHub-hosted Node TAP gate without mistaking it
 * for a green build. Every reported failure must come from an explicit owned
 * QA test filename, and TAP summary arithmetic must be exact.
 *
 * It never fetches GitHub logs, contacts retailers, or publishes findings.
 */
export function analyzeNativeRedCi(log, { expectedRed, allowedTestFiles } = {}) {
  if (typeof log !== 'string' || Buffer.byteLength(log, 'utf8') > MAX_LOG_BYTES) {
    throw new Error('A bounded UTF-8 GitHub job log is required')
  }
  if (!Number.isSafeInteger(expectedRed) || expectedRed < 1 || expectedRed > 10000) {
    throw new Error('Expected RED must be a bounded positive integer')
  }
  if (!Array.isArray(allowedTestFiles) || allowedTestFiles.length === 0 ||
      allowedTestFiles.length > 32 ||
      allowedTestFiles.some(x => typeof x !== 'string' || !FILENAME.test(x)) ||
      new Set(allowedTestFiles).size !== allowedTestFiles.length) {
    throw new Error('Explicit unique QA test filenames are required')
  }

  const allowed = new Set(allowedTestFiles)
  const totals = new Map()
  const failing = []
  const errors = []
  let current = null
  let nativeTapHeaders = 0
  let nativeTapHeaderLine = -1
  let nativeTapPlan = null
  let nativeTapPlanLine = -1
  let firstSummaryLine = -1
  let lastSummaryLine = -1
  let nativeTerminalCount = 0
  let nativeTerminalLine = -1

  function completeFailure() {
    if (current) {
      failing.push(current)
      current = null
    }
  }

  for (const [lineNumber, rawLine] of log.split(/\r?\n/).entries()) {
    const line = plainLine(rawLine)
    // The native TAP envelope and GitHub terminal marker must belong to the
    // same *completed* job; passing fragments cannot certify hosted CI.
    if (line === 'TAP version 13') {
      nativeTapHeaders++
      nativeTapHeaderLine = lineNumber
    }
    const planMatch = /^1\.\.(\d+)$/.exec(line)
    if (planMatch) {
      if (nativeTapPlan !== null) throw new Error('Ambiguous duplicate native TAP plan')
      nativeTapPlan = Number(planMatch[1])
      nativeTapPlanLine = lineNumber
    }
    if (line === '##[error]Process completed with exit code 1.') {
      nativeTerminalCount++
      nativeTerminalLine = lineNumber
    }
    const failingTap = /^\s*not ok\s+\d+\s+-\s+(.+)$/.exec(line)
    const passingTap = /^\s*ok\s+\d+\s+-\s+/.test(line)
    if (failingTap || passingTap) {
      completeFailure()
      if (failingTap) current = { file: null }
    }
    if (current) {
      const location = /^\s*location:\s*['"](?:[^'"]*[/\\])?([^/'"\\]+\.test\.mjs):\d+:\d+['"]/.exec(line)
      if (location) current.file = location[1]
    }
    const summary = /^#\s+(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)$/.exec(line)
    if (summary) {
      completeFailure()
      if (totals.has(summary[1])) throw new Error('Ambiguous duplicate TAP summary')
      totals.set(summary[1], Number(summary[2]))
      if (firstSummaryLine === -1) firstSummaryLine = lineNumber
      lastSummaryLine = lineNumber
    }
    if (line.startsWith('##[error]') &&
        !/^##\[error\]Process completed with exit code 1\.$/.test(line)) {
      errors.push('non-TAP GitHub Actions error')
    }
  }
  completeFailure()

  for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
    if (!totals.has(key)) throw new Error('Incomplete native TAP summary')
  }
  const tests = totals.get('tests')
  const pass = totals.get('pass')
  const fail = totals.get('fail')
  const skipped = totals.get('skipped')
  const cancelled = totals.get('cancelled')
  const todo = totals.get('todo')
  if (nativeTapHeaders !== 1 || nativeTapPlan === null || nativeTapPlan !== tests ||
      nativeTapHeaderLine < 0 || nativeTapHeaderLine >= nativeTapPlanLine ||
      nativeTapPlanLine >= firstSummaryLine || firstSummaryLine > lastSummaryLine) {
    throw new Error('Incomplete or ambiguous native TAP envelope')
  }
  if (nativeTerminalCount !== 1 || nativeTerminalLine <= lastSummaryLine) {
    throw new Error('Incomplete or ambiguous hosted terminal completion')
  }
  if (tests !== pass + fail + skipped + cancelled || skipped || cancelled || todo) {
    throw new Error('TAP totals are inconsistent or include incomplete tests')
  }
  if (fail !== expectedRed || failing.length !== expectedRed) {
    throw new Error('Unexpected RED count or TAP failures do not match summary')
  }
  if (errors.length) throw new Error('Non-test GitHub Actions error present')
  if (failing.some(item => !item.file || !allowed.has(item.file))) {
    throw new Error('Failure outside the explicitly approved QA files')
  }
  const byFile = Object.fromEntries([...allowed].sort().map(file =>
    [file, failing.filter(item => item.file === file).length]))
  if (Object.values(byFile).some(count => count === 0)) {
    throw new Error('Expected QA suite missing from RED proof')
  }
  return {
    outcome: 'expected-qa-red-only',
    tests,
    pass,
    fail,
    skipped,
    cancelled,
    unexpectedFailures: 0,
    byFile,
    sourcePermissionGate: 'not-proven-by-red-node',
    productionBuild: 'not-proven-by-red-node',
    productionReady: false,
  }
}

async function readBoundedStdin() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_LOG_BYTES) throw new Error('GitHub job log exceeds 12 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function main(args = process.argv.slice(2)) {
  const expectedArg = args.filter(arg => /^--expected-red=\d+$/.test(arg))
  const allowedArgs = args.filter(arg => /^--allow=[a-zA-Z0-9][a-zA-Z0-9._-]*\.test\.mjs$/.test(arg))
  if (expectedArg.length !== 1 || allowedArgs.length === 0 ||
      expectedArg.length + allowedArgs.length !== args.length) {
    throw new Error('Usage: --expected-red=N --allow=qa-name.test.mjs [...], log on stdin')
  }
  const proof = analyzeNativeRedCi(await readBoundedStdin(), {
    expectedRed: Number(expectedArg[0].slice('--expected-red='.length)),
    allowedTestFiles: allowedArgs.map(x => x.slice('--allow='.length)),
  })
  process.stdout.write(JSON.stringify(proof, null, 2) + '\n')
  return proof
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Unverified native CI evidence: unsafe, incomplete or unexpected RED')
    process.exitCode = 2
  })
}
