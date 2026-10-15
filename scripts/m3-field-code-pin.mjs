import { createHash } from 'node:crypto'
import { open, lstat, constants, mkdtemp, link, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dirname, join, resolve, parse } from 'node:path'

const MAX_STUDY_BYTES = 4 * 1024 * 1024
const COMMIT_SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const FORMAT = 'supa-m3-private-study-code-pin-v1'
const MANIFEST_KEYS = Object.freeze([
  'format', 'sourceCommitSha', 'studySha256',
  'codeRevisionVerified', 'retailerPermissionVerified', 'publicSavingsClaimEligible',
])

function fail() {
  throw new Error('Invalid private M3 study code-pin input')
}

function sourceBytes(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) fail()
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
  if (bytes.length === 0 || bytes.length > MAX_STUDY_BYTES) fail()
  return bytes
}

function requireStudy(bytes) {
  let study
  try {
    study = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    fail()
  }
  if (!study || Array.isArray(study) || typeof study !== 'object' ||
      study.schemaVersion !== 1 || typeof study.studyId !== 'string' ||
      study.studyId.length === 0 ||
      !study.baseline || typeof study.baseline !== 'object' ||
      !study.candidate || typeof study.candidate !== 'object') fail()
}

export function createPrivateM3StudyCodePin(studyContent, sourceCommitSha) {
  if (typeof sourceCommitSha !== 'string' || !COMMIT_SHA.test(sourceCommitSha) ||
      /^0{40}$/.test(sourceCommitSha)) fail()
  const bytes = sourceBytes(studyContent)
  requireStudy(bytes)
  return Object.freeze({
    format: FORMAT,
    sourceCommitSha,
    studySha256: createHash('sha256').update(bytes).digest('hex'),
    codeRevisionVerified: false,
    retailerPermissionVerified: false,
    publicSavingsClaimEligible: false,
  })
}

// Manifest format is a *flat* six-field JSON object. Validate member identity
// while scanning the original bytes: JSON.parse silently overwrites duplicates,
// which can conceal a contradictory SHA or privacy/eligibility attestation.
export function parseStrictPrivateM3Manifest(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) fail()
  let offset = 0
  const skipWhitespace = () => {
    while (offset < raw.length && [9, 10, 13, 32].includes(raw.charCodeAt(offset))) {
      offset += 1
    }
  }
  const consume = (char) => {
    skipWhitespace()
    if (raw[offset] !== char) fail()
    offset += 1
  }
  const jsonString = () => {
    skipWhitespace()
    if (raw[offset] !== '"') fail()
    const start = offset++
    let closed = false
    while (offset < raw.length) {
      const char = raw[offset++]
      if (char === '\\') {
        if (offset >= raw.length) fail()
        offset += 1
      } else if (char === '"') {
        closed = true
        break
      } else if (char.charCodeAt(0) < 0x20) {
        fail()
      }
    }
    if (!closed) fail()
    try {
      return JSON.parse(raw.slice(start, offset))
    } catch {
      fail()
    }
  }
  const values = Object.create(null)
  consume('{')
  let count = 0
  skipWhitespace()
  while (raw[offset] !== '}') {
    if (count > 0) consume(',')
    const key = jsonString()
    if (!MANIFEST_KEYS.includes(key) || Object.hasOwn(values, key)) fail()
    consume(':')
    skipWhitespace()
    let value
    if (raw[offset] === '"') {
      value = jsonString()
    } else if (raw.startsWith('false', offset)) {
      value = false
      offset += 5
    } else if (raw.startsWith('true', offset)) {
      value = true
      offset += 4
    } else {
      fail()
    }
    values[key] = value
    count += 1
    if (count > MANIFEST_KEYS.length) fail()
    skipWhitespace()
    if (offset >= raw.length) fail()
  }
  consume('}')
  skipWhitespace()
  if (offset !== raw.length || count !== MANIFEST_KEYS.length) fail()
  return Object.assign({}, values)
}

export function verifyPrivateM3StudyCodePin(studyContent, manifest) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
    const expectedKeys = MANIFEST_KEYS
    if (Object.getPrototypeOf(manifest) !== Object.prototype) return false
    const keys = Reflect.ownKeys(manifest)
    if (keys.length !== expectedKeys.length ||
        !expectedKeys.every((key) => keys.includes(key))) return false

    // Read each primitive own data field once. A prototype/getter must not be
    // able to switch evidence or authorization flags between validation steps.
    const pinned = {}
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(manifest, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
      pinned[key] = descriptor.value
    }
    if (pinned.format !== FORMAT || typeof pinned.sourceCommitSha !== 'string' ||
        typeof pinned.studySha256 !== 'string' || !DIGEST.test(pinned.studySha256) ||
        pinned.codeRevisionVerified !== false ||
        pinned.retailerPermissionVerified !== false ||
        pinned.publicSavingsClaimEligible !== false) return false
    const expected = createPrivateM3StudyCodePin(studyContent, pinned.sourceCommitSha)
    return expectedKeys.every((key) => pinned[key] === expected[key])
  } catch {
    return false
  }
}

async function readBoundedPrivateStudy(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STUDY_BYTES ||
        stat.nlink !== 1) fail()
    const buffer = Buffer.allocUnsafe(MAX_STUDY_BYTES + 1)
    let used = 0
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null)
      if (bytesRead === 0) break
      used += bytesRead
    }
    return sourceBytes(buffer.subarray(0, used))
  } finally {
    await handle.close()
  }
}

async function assertPrivateNewOutput(destination) {
  if (typeof destination !== 'string' || !destination || destination.trim() !== destination ||
      destination.startsWith('-') || destination.includes('\u0000')) fail()
  const target = resolve(destination)
  let parent = dirname(target)
  while (true) {
    const metadata = await lstat(parent)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail()
    try {
      await lstat(join(parent, '.git'))
      fail() // Refuse private evidence below any Git checkout or worktree.
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid private M3 study code-pin input') throw error
      if (!error || error.code !== 'ENOENT') fail()
    }
    if (parent === parse(parent).root) return target
    parent = dirname(parent)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const verifyMode = argv[0] === '--verify'
  const outputMode = !verifyMode && argv.length === 4 && argv[2] === '--output'
  if ((verifyMode && argv.length !== 3) ||
      (!verifyMode && !outputMode && argv.length !== 2) ||
      (!verifyMode && argv[0]?.startsWith('-')) ||
      argv.some((arg, index) => index > 0 && arg.startsWith('--') && !(outputMode && index === 2))) {
    throw new Error('usage: m3-field-code-pin <study.json> <40-char-main-sha> [--output <new-private-pin.json>] OR --verify <study.json> <private-pin.json>')
  }
  let bytes
  try {
    bytes = await readBoundedPrivateStudy(argv[verifyMode ? 1 : 0])
  } catch {
    throw new Error('Private M3 study could not be read or validated')
  }

  if (verifyMode) {
    let manifest
    try {
      const manifestBytes = await readBoundedPrivateStudy(argv[2])
      if (manifestBytes.length > 4096) throw new Error('invalid manifest')
      manifest = parseStrictPrivateM3Manifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
    } catch {
      throw new Error('Private M3 manifest could not be read or validated')
    }
    if (!verifyPrivateM3StudyCodePin(bytes, manifest)) {
      throw new Error('Private M3 study byte digest or code-pin contract did not match')
    }
    const result = Object.freeze({
      privateStudyBytesMatch: true,
      codeRevisionVerified: false,
      retailerPermissionVerified: false,
      publicSavingsClaimEligible: false,
    })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return result
  }

  const manifest = createPrivateM3StudyCodePin(bytes, argv[1])
  if (outputMode) {
    try {
      const outputPath = await assertPrivateNewOutput(argv[3])
      // Stage under a newly owned 0700 directory on the *same* filesystem.
      // The public final name never exists until every byte has been written,
      // fsynced and the staging descriptor safely closed. Hard-link creates
      // that name atomically and fails if another process owns the target.
      const stagingDir = await mkdtemp(join(dirname(outputPath), '.supa-m3-codepin-'))
      try {
        const stagingFile = join(stagingDir, 'manifest.json')
        const handle = await open(stagingFile,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600)
        try {
          await handle.writeFile(JSON.stringify(manifest, null, 2) + '\n')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await link(stagingFile, outputPath)
      } finally {
        await rm(stagingDir, { recursive: true, force: true })
      }
    } catch {
      throw new Error('Private M3 code-pin destination refused or unavailable')
    }
    process.stdout.write('Private M3 code pin saved as a new private file\n')
    return manifest
  }
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Private M3 code-pin generation refused')
    process.exitCode = 1
  })
}
