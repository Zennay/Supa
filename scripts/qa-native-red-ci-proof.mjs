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
  // A JS string can contain orphaned surrogate units; Buffer.byteLength
  // would silently replace them. Never certify lossy operator evidence.
  if (!log.isWellFormed()) throw new Error('Malformed UTF-16 GitHub job log')
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
  let observedPassing = 0
  const rootOrdinals = new Set()
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
      if (!Number.isSafeInteger(nativeTapPlan) || nativeTapPlan < 1 ||
          nativeTapPlan > Buffer.byteLength(log, 'utf8')) {
        throw new Error('Unsafe or unsupported native TAP plan count')
      }
      nativeTapPlanLine = lineNumber
    }
    if (line === '##[error]Process completed with exit code 1.') {
      nativeTerminalCount++
      nativeTerminalLine = lineNumber
    }
    const failingTap = /^\s*not ok\s+\d+\s+-\s+(.+)$/.exec(line)
    const passingTap = /^\s*ok\s+\d+\s+-\s+/.test(line)
    const rootTap = /^(?:not ok|ok)\s+(\d+)\s+-\s+/.exec(line)
    if (rootTap) {
      // A top-level record must use a unique, positive safe ordinal.
      // Nested test subgroups may restart their own indexes, and legacy
      // evidence intentionally accepts nested failures beside root records.
      const ordinal = Number(rootTap[1])
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || rootOrdinals.has(ordinal)) {
        throw new Error('Duplicate or invalid native root TAP ordinal')
      }
      rootOrdinals.add(ordinal)
    }
    if (failingTap || passingTap) {
      // Native test records are valid only between the unique TAP header
      // and the root plan. A log line from setup, summaries, or cleanup is
      // never allowed to backfill the completed test-job evidence.
      if (nativeTapHeaders !== 1 || nativeTapPlan !== null ||
          totals.size !== 0 || nativeTerminalCount !== 0) {
        throw new Error('TAP record outside native test phase')
      }
      completeFailure()
      if (passingTap) observedPassing++
      if (failingTap) current = { file: null, locationCount: 0 }
    }
    if (current) {
      const location = /^\s*location:\s*['"]([^'"]*[/\\]([^/'"\\]+\.test\.mjs):(\d+):(\d+))['"]$/.exec(line)
      if (location) {
        // A failure's source location must also occur inside its original
        // native test phase, never after the final root TAP plan.
        if (nativeTapHeaders !== 1 || nativeTapPlan !== null ||
            totals.size !== 0 || nativeTerminalCount !== 0) {
          throw new Error('Failure origin outside native TAP test phase')
        }
        // A filename alone is not provenance: a foreign checkout or nested
        // dependency can contain an identically named test. Native SUPA TAP
        // must originate from the checked-in repository's root tests folder.
        const rawPath = location[1]
        // Exact documented checkout roots of GitHub-hosted native runners:
        // Linux ubuntu-latest is /home/runner/work/Supa/Supa;
        // Windows is <drive>:\a\Supa\Supa. A generic suffix allows a
        // different checkout to shadow the same QA test filename.
        const hostedRoot = /^(?:\/home\/runner\/work\/Supa\/Supa\/tests\/|[A-Za-z]:[\\/]a[\\/]Supa[\\/]Supa[\\/]tests[\\/])[A-Za-z0-9][A-Za-z0-9._-]*\.test\.mjs:[1-9]\d*:[1-9]\d*$/
        if (!hostedRoot.test(rawPath)) {
          throw new Error('Foreign native TAP failure location')
        }
        // Every failed native test has one authoritative TAP origin. A later
        // diagnostic line may not overwrite a foreign failure with a trusted
        // QA path (nor duplicate the same path to fabricate certainty).
        current.locationCount++
        if (current.locationCount !== 1) {
          throw new Error('Ambiguous native TAP failure location')
        }
        current.file = location[2]
      }
    }
    const summary = /^#\s+(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)$/.exec(line)
    if (summary) {
      completeFailure()
      if (totals.has(summary[1])) throw new Error('Ambiguous duplicate TAP summary')
      const count = Number(summary[2])
      // A native log cannot prove more test events than there are bytes,
      // and floating point summary counts must never round a real failure
      // away or serialize non-finite values to JSON null.
      if (!Number.isSafeInteger(count) || count > Buffer.byteLength(log, 'utf8')) {
        throw new Error('Unsafe or unsupported TAP summary count')
      }
      totals.set(summary[1], count)
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
  // A root plan cannot be certified solely from indented nested-subtest
  // events. At least one unindented TAP test must witness the root suite.
  if (nativeTapHeaders !== 1 || nativeTapPlan === null || nativeTapPlan !== tests ||
      rootOrdinals.size === 0 ||
      [...rootOrdinals].some(ordinal => ordinal > nativeTapPlan) ||
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
  // Node TAP can repeat a parent's successful record for nested subtests,
  // so observed native passes may exceed '# pass'; they must not be fewer.
  // Unseen success records are not evidence, even when summary math works.
  if (pass > observedPassing || tests > observedPassing + failing.length) {
    throw new Error('TAP summary claims tests absent from native records')
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
  try {
    // Preserve malformed wire bytes as an error instead of replacing them
    // with U+FFFD outside TAP lines and accidentally certifying that log.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(Buffer.concat(chunks))
  } catch {
    throw new Error('Malformed UTF-8 GitHub job log')
  }
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
