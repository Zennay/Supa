import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import test from 'node:test'

const evidenceDir = 'evidence/m3'
const allowedExtensions = new Set(['.json', '.md'])
// Canonicalize JSON key spellings before applying the privacy denylist.
// Do not allow a snake_case, kebab-case, dotted, spaced, case-variant,
// or Unicode-width alias to bypass the same direct-identifier restriction.
const directIdentifierKeys = new Set([
  'participantname',
  'participantemail',
  'emailaddress',
  'accountid',
  'accountemail',
  'fullname',
])

function canonicalIdentifierKey(key) {
  return key.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

function assertNoEvidenceSymlink(entry, path) {
  assert.equal(
    entry.isSymbolicLink(),
    false,
    `symbolic links are not allowed in durable M3 evidence: ${relative(evidenceDir, path)}`,
  )
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(root, entry.name)
    assertNoEvidenceSymlink(entry, path)

    if (entry.isDirectory()) {
      files.push(...await listFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }

  return files
}

function inspectForDirectIdentifiers(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectForDirectIdentifiers(item, `${path}[${index}]`),
    )
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert.equal(
        directIdentifierKeys.has(canonicalIdentifierKey(key)),
        false,
        `direct participant identifier key is not allowed in M3 evidence: ${path}.${key}`,
      )
      inspectForDirectIdentifiers(item, `${path}.${key}`)
    }
    return
  }

  if (typeof value === 'string') {
    assert.equal(
      emailPattern.test(value),
      false,
      `email-like direct identifier is not allowed in M3 evidence: ${path}`,
    )
  }
}

test('M3 durable evidence zone contains only reviewable text evidence formats', async () => {
  const files = await listFiles(evidenceDir)

  assert.ok(
    files.some((path) => path.endsWith('README.md')),
    'evidence/m3 must keep its repository evidence boundary documented',
  )

  for (const path of files) {
    assert.equal(
      allowedExtensions.has(extname(path).toLowerCase()),
      true,
      `non-reviewable/raw field artifact must not be committed under evidence/m3: ${relative(evidenceDir, path)}`,
    )
  }
})

test('M3 durable evidence rejects symbolic links without traversing them', () => {
  const symlinkEntry = {
    isSymbolicLink: () => true,
  }
  const regularFileEntry = {
    isSymbolicLink: () => false,
  }

  assert.throws(
    () => assertNoEvidenceSymlink(symlinkEntry, join(evidenceDir, 'linked-study.json')),
    /symbolic links are not allowed in durable M3 evidence: linked-study\.json/,
  )
  assert.doesNotThrow(() =>
    assertNoEvidenceSymlink(regularFileEntry, join(evidenceDir, 'study.json')),
  )
})

test('committed M3 study JSON stays structurally identifiable and privacy-safe', async () => {
  const files = (await listFiles(evidenceDir)).filter(
    (path) => extname(path).toLowerCase() === '.json',
  )

  for (const path of files) {
    const study = JSON.parse(await readFile(path, 'utf8'))

    assert.equal(study.schemaVersion, 1, `${path}: unsupported M3 study schema`)
    assert.equal(typeof study.studyId, 'string', `${path}: studyId is required`)
    assert.equal(
      typeof study.participantKey,
      'string',
      `${path}: pseudonymous participantKey is required`,
    )
    assert.ok(study.baseline && typeof study.baseline === 'object', `${path}: baseline is required`)
    assert.ok(study.candidate && typeof study.candidate === 'object', `${path}: candidate is required`)

    inspectForDirectIdentifiers(study)
  }
})


test('M3 evidence privacy boundary rejects equivalent direct-identifier key spellings', () => {
  const disallowedAliases = [
    'participant_name',
    'PARTICIPANT-NAME',
    'participant.name',
    'participant name',
    'ParticipantEmail',
    'account-id',
    'ACCOUNT_EMAIL',
    'Full Name',
    'email-address',
    'ｅｍａｉｌ＿ａｄｄｒｅｓｓ',
  ]

  for (const key of disallowedAliases) {
    assert.throws(
      () => inspectForDirectIdentifiers({ nested: [{ [key]: 'Synthetic Person' }] }),
      /direct participant identifier key is not allowed in M3 evidence/,
      `identifier alias ${JSON.stringify(key)} must fail closed`,
    )
  }

  assert.doesNotThrow(() =>
    inspectForDirectIdentifiers({
      participantKey: 'student-001',
      studyId: 'week-001',
      storeId: 'plus-001',
      ingredientLabel: 'Broccoli',
      provenanceNote: 'Synthetic test only',
    }),
  )
})
