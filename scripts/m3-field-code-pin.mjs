import { createHash } from 'node:crypto'
import { open, constants } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

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
    if (Object.keys(manifest).length !== 6 ||
        manifest.format !== FORMAT || typeof manifest.sourceCommitSha !== 'string' ||
        typeof manifest.studySha256 !== 'string' || !DIGEST.test(manifest.studySha256) ||
        manifest.codeRevisionVerified !== false ||
        manifest.retailerPermissionVerified !== false ||
        manifest.publicSavingsClaimEligible !== false) return false
    const expected = createPrivateM3StudyCodePin(studyContent, manifest.sourceCommitSha)
    return Object.keys(expected).every((key) => manifest[key] === expected[key])
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

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0].startsWith('-') || argv[1].startsWith('-')) {
    throw new Error('usage: m3-field-code-pin <private-study.json> <40-char-main-commit-sha>')
  }
  let bytes
  try {
    bytes = await readBoundedPrivateStudy(argv[0])
  } catch {
    throw new Error('Private M3 study could not be read or validated')
  }
  const manifest = createPrivateM3StudyCodePin(bytes, argv[1])
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Private M3 code-pin generation refused')
    process.exitCode = 1
  })
}
