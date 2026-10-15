import { createHash } from 'node:crypto'
import { open, lstat, constants } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { dirname, join, resolve, parse } from 'node:path'

const MAX_STUDY_BYTES = 4 * 1024 * 1024
const COMMIT_SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/
const FORMAT = 'supa-m3-private-study-code-pin-v1'

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

export function verifyPrivateM3StudyCodePin(studyContent, manifest) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
    const expectedKeys = [
      'format', 'sourceCommitSha', 'studySha256',
      'codeRevisionVerified', 'retailerPermissionVerified', 'publicSavingsClaimEligible',
    ]
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
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
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
      manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
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
      const handle = await open(outputPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600)
      try {
        await handle.writeFile(JSON.stringify(manifest, null, 2) + '\n')
      } finally {
        await handle.close()
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
