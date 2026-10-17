/**
 * Independent, offline Supa QA1 check of ONE completed native GREEN job.
 * Consistency check of supplied GitHub API snapshots + job log, NOT a
 * cryptographic authentication, release approval, retailer field observation,
 * source license, or public savings proof. Requires immutable SHA inputs.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

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
export function auditNativeGreenJob({run, job, log, expectedHead, expectedBase} = {}) {
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
  if (steps.filter(s => s.startsWith('Run npm ')).length !== CHECKS.length) refuse()

  const lines = boundedText(log).split(/\r?\n/).map(plain)
  // GitHub pulls/<number>/merge checkout is not the PR head itself. Match
  // both the exact immutable HEAD and the frozen parent SHA on one line.
  const checkout = exactlyOne(lines, line =>
    /^HEAD is now at [a-f0-9]{7,40} Merge [a-f0-9]{40} into [a-f0-9]{40}$/.test(line))
  if (!lines[checkout].endsWith('Merge ' + expectedHead + ' into ' + expectedBase)) refuse()

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
  const auditSlice = lines.slice(starts[1], starts[2])
  if (!auditSlice.some(line => /^found 0 vulnerabilities$/.test(line))) refuse()
  const gateSlice = lines.slice(starts[4], starts[5])
  const needed = [
    '"productionReady": false,',
    '"permissionStatus": "permission_required",',
    '"permissionStatus": "unresolved",',
    '"productionEnabled": false,',
  ]
  for (const text of needed) {
    if (!gateSlice.some(line => line.trim() === text)) refuse()
  }
  if (gateSlice.some(line => /"productionReady":\s*true/.test(line))) refuse()
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
