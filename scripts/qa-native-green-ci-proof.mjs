/**
 * Independent, offline Supa QA1 check of ONE completed native GREEN job.
 * Consistency check of supplied GitHub API snapshots + job log, NOT a
 * cryptographic authentication, release approval, retailer field observation,
 * source license, or public savings proof. Requires immutable SHA inputs.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { types as nodeTypes } from 'node:util'

const SHA = /^[a-f0-9]{40}$/
const MAX_BYTES = 16 * 1024 * 1024
const CHECKS = [
  'Run npm ci',
  'Run npm audit --audit-level=high',
  'Run npm test',
  'Run npm run m1:matching-benchmark',
  'Run npm run m1:source-permission-gate',
  'Run npm run build',
]
const PREFIX = /^\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /
const refuse = () => { throw new Error('Unverified Supa native GREEN job evidence') }

/** Detach metadata without triggering caller-controlled getters or proxies. */
function inertJson(value) {
  const seen = new WeakSet()
  let properties = 0
  function copy(input, depth) {
    if (depth > 24) refuse()
    if (input === null || typeof input === 'string' || typeof input === 'boolean')
      return input
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) refuse()
      return input
    }
    if (typeof input !== 'object' || nodeTypes.isProxy(input) || seen.has(input))
      refuse()
    const array = Array.isArray(input)
    const prototype = Object.getPrototypeOf(input)
    if (array ? prototype !== Array.prototype :
        (prototype !== Object.prototype && prototype !== null)) refuse()
    seen.add(input)
    const names = Reflect.ownKeys(input)
    properties += names.length
    if (properties > 30_000 || names.some(name => typeof name !== 'string')) refuse()
    const out = array ? [] : Object.create(null)
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) refuse()
      if (array && name === 'length') {
        if (!Number.isSafeInteger(descriptor.value) || descriptor.value > 20_000) refuse()
        out.length = descriptor.value
      } else {
        Object.defineProperty(out, name, {
          value: copy(descriptor.value, depth + 1),
          configurable: true, enumerable: true, writable: true,
        })
      }
    }
    return out
  }
  return copy(value, 0)
}

function boundedText(value) {
  if (typeof value !== 'string' || !value.isWellFormed() ||
      Buffer.byteLength(value, 'utf8') === 0 ||
      Buffer.byteLength(value, 'utf8') > MAX_BYTES) refuse()
  return value
}
function plain(raw) {
  return raw.replace(PREFIX, '').replace(/\x1b\[[0-9;]*m/g, '')
}
function exactlyOne(lines, predicate) {
  const indices = []
  for (let i = 0; i < lines.length; i++) if (predicate(lines[i])) indices.push(i)
  if (indices.length !== 1) refuse()
  return indices[0]
}

/**
 * All three objects must be copies of the ACTUAL SAME GitHub native run.
 * Recheck remote API identity/commit and job details independently. A caller
 * can forge local JSON/log bytes; this NEVER upgrades to productionReady=true.
 */
export function auditNativeGreenJob(untrusted = {}) {
  const {run, job, log, expectedHead, expectedBase} = inertJson(untrusted)
  if (!SHA.test(expectedHead || '') || !SHA.test(expectedBase || '') ||
      expectedHead === expectedBase || !run || !job ||
      !Number.isSafeInteger(run.id) || run.id < 1 ||
      !Number.isSafeInteger(job.id) || job.id < 1 ||
      job.run_id !== run.id || run.head_sha !== expectedHead ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      run.event !== 'pull_request' || run.run_attempt !== 1 ||
      job.status !== 'completed' || job.conclusion !== 'success' ||
      job.name !== 'test-build' || !Array.isArray(job.steps) ||
      run.html_url !== 'https://github.com/Zennay/Supa/actions/runs/' + run.id) refuse()

  const steps = job.steps.map(s => {
    if (!s || typeof s.name !== 'string' || s.status !== 'completed' ||
        s.conclusion !== 'success') refuse()
    return s.name
  })
  if (new Set(steps).size !== steps.length) refuse()
  const stepPositions = CHECKS.map(name => {
    const at = steps.indexOf(name)
    if (at < 0) refuse()
    return at
  })
  if (stepPositions.some((index, at) => at && index <= stepPositions[at - 1])) refuse()
  // No additional "Run ..." executable steps hidden between or outside the
  // known frozen workflow; setup, cleanup and job-completion steps may remain.
  const executableAllowlist = new Set([
    'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    ...CHECKS,
  ])
  const executableSteps = steps.filter(s => s.startsWith('Run '))
  if (executableSteps.length !== executableAllowlist.size ||
      executableSteps.some(name => !executableAllowlist.has(name)) ||
      steps.indexOf('Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1') >= stepPositions[0] ||
      steps.indexOf('Run actions/setup-node@820762786026740c76f36085b0efc47a31fe5020') >= stepPositions[0]) refuse()

  const lines = boundedText(log).split(/\r?\n/).map(plain)
  // GitHub pulls/<number>/merge checkout is not the PR head itself. Match
  // both the exact immutable HEAD and the frozen parent SHA on one line.
  const checkout = exactlyOne(lines, line =>
    /^HEAD is now at [a-f0-9]{7,40} Merge [a-f0-9]{40} into [a-f0-9]{40}$/.test(line))
  if (!lines[checkout].endsWith('Merge ' + expectedHead + ' into ' + expectedBase)) refuse()

  // Reconcile ALL executable GitHub log group markers with metadata, not
  // merely the six expected commands. An omitted extra shell/npm command
  // would make a green source-gate result falsely appear sufficient.
  const loggedCommands = new Set()
  const allowedCommands = new Set(steps.filter(s => s.startsWith('Run ')))
  for (const line of lines) {
    if (!line.startsWith('##[group]Run ')) continue
    const command = line.slice('##[group]'.length)
    if (!allowedCommands.has(command) || loggedCommands.has(command)) refuse()
    loggedCommands.add(command)
  }
  if (CHECKS.some(name => !loggedCommands.has(name))) refuse()
  const starts = CHECKS.map(name => exactlyOne(lines, line => line === '##[group]' + name))
  if (starts.some((i, j) => j && i <= starts[j - 1]) || checkout >= starts[0]) refuse()
  const native = exactlyOne(lines, line => line === 'TAP version 13')
  if (!(starts[2] < native && native < starts[3])) refuse()
  const plan = exactlyOne(lines, line => /^1\.\.[0-9]+$/.test(line))
  const totals = new Map()
  const totalsAt = []
  for (let i = native + 1; i < starts[3]; i++) {
    const match = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/.exec(lines[i])
    if (!match) continue
    if (totals.has(match[1])) refuse()
    totals.set(match[1], Number(match[2]))
    totalsAt.push(i)
  }
  if (totals.size !== 6 || !Number.isSafeInteger(totals.get('tests')) ||
      totals.get('tests') < 1 || totals.get('tests') > 100000 ||
      totals.get('pass') !== totals.get('tests') ||
      totals.get('fail') !== 0 || totals.get('skipped') !== 0 ||
      totals.get('cancelled') !== 0 || totals.get('todo') !== 0 ||
      lines[plan] !== '1..' + totals.get('tests') ||
      !(native < plan && plan < Math.min(...totalsAt) &&
        Math.max(...totalsAt) < starts[3])) refuse()

  for (const line of lines) {
    if (/^\s*not ok\s+\d+\s+-/.test(line) || line.startsWith('##[error]')) refuse()
  }
  // A duplicate TAP summary outside the native Node block, or another plan,
  // cannot be excused as harmless post-job cleanup.
  for (let i = 0; i < lines.length; i++) {
    if (i >= native && i < starts[3]) continue
    if (lines[i] === 'TAP version 13' ||
        /^1\.\.[0-9]+$/.test(lines[i]) ||
        /^# (tests|pass|fail|skipped|cancelled|todo) [0-9]+$/.test(lines[i])) refuse()
  }
  const ciSlice = lines.slice(starts[0], starts[1])
  const auditSlice = lines.slice(starts[1], starts[2])
  if (!ciSlice.some(line => /^found 0 vulnerabilities$/.test(line)) ||
      !auditSlice.some(line => /^found 0 vulnerabilities$/.test(line))) refuse()
  const gateSlice = lines.slice(starts[4], starts[5])
  // Require the *actual complete gate JSON*, not disconnected keywords
  // scattered in unrelated runner text. This binds retailer IDs to the exact
  // denied permission status and production flag for each source.
  const open = exactlyOne(gateSlice, line => line === '{')
  const close = exactlyOne(gateSlice, line => line === '}')
  if (close <= open) refuse()
  let rights
  try { rights = JSON.parse(gateSlice.slice(open, close + 1).join('\n')) }
  catch { refuse() }
  if (rights?.milestone !== 'M1 Data Feasibility' ||
      rights?.productionReady !== false ||
      !Array.isArray(rights.expectedSources) ||
      JSON.stringify([...rights.expectedSources].sort()) !== JSON.stringify(['dekamarkt', 'plus']) ||
      !Array.isArray(rights.blockers) || rights.blockers.length !== 2) refuse()
  const blockers = new Map()
  for (const item of rights.blockers) {
    if (!item || typeof item !== 'object' ||
        !['plus', 'dekamarkt'].includes(item.supermarket) ||
        blockers.has(item.supermarket) || item.productionEnabled !== false) refuse()
    blockers.set(item.supermarket, item.permissionStatus)
  }
  if (blockers.get('plus') !== 'permission_required' ||
      blockers.get('dekamarkt') !== 'unresolved') refuse()
  if (!lines.slice(starts[5]).some(line => /(?:✓|✔) built in [\d.]+(?:ms|s)$/.test(line.trim()))) refuse()

  return {
    outcome: 'native-green-evidence-consistent-not-authenticated',
    headSha: expectedHead, baseSha: expectedBase,
    runId: run.id, jobId: job.id,
    tests: totals.get('tests'), passed: totals.get('pass'),
    failures: 0, skipped: 0, cancelled: 0,
    auditHigh: 'zero-reported-in-log',
    sourcePermissions: 'explicitly-denied-in-log',
    productionReady: false, publicSavingsClaimEligible: false,
    realStorePricesVerified: 0,
  }
}

async function stdinJson() {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_BYTES) refuse()
    chunks.push(chunk)
  }
  let decoded
  try {
    decoded = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})
      .decode(Buffer.concat(chunks))
  } catch { refuse() }
  if (!decoded.isWellFormed()) refuse()
  try { return JSON.parse(decoded) } catch { refuse() }
}

export async function main(args = process.argv.slice(2)) {
  const h = args.filter(x => /^--head=[a-f0-9]{40}$/.test(x))
  const b = args.filter(x => /^--base=[a-f0-9]{40}$/.test(x))
  if (args.length !== 2 || h.length !== 1 || b.length !== 1) refuse()
  const data = await stdinJson()
  const result = auditNativeGreenJob({
    ...data, expectedHead: h[0].slice(7), expectedBase: b[0].slice(7),
  })
  process.stdout.write(JSON.stringify(result) + '\n')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Unverified Supa native GREEN job evidence')
    process.exitCode = 2
  })
}
