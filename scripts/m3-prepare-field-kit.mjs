import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { renderM3PaperChecklist } from './m3-print-field-checklist.mjs'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

// This is an EMPTY manual field collection kit, not real retailer evidence.
// The authenticated, checked-out main SHA is recorded as a companion file:
// #205 still owns adding that pin to the actual observation/study schema.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REVISION_RE = /^[0-9a-f]{40}$/

function checkedRevision(revision) {
  // Source-code provenance is evidence metadata. Never let caller-controlled
  // getters supply one SHA for validation and a different one for the guide
  // or revision manifest. Pin exactly two OWN data descriptors one time.
  try {
    if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
      throw new Error('invalid revision')
    }
    const keys = Reflect.ownKeys(revision)
    if (keys.length !== 2 || !keys.includes('branch') || !keys.includes('sha')) {
      throw new Error('unexpected revision fields')
    }
    const branch = Reflect.getOwnPropertyDescriptor(revision, 'branch')
    const sha = Reflect.getOwnPropertyDescriptor(revision, 'sha')
    if (!branch || !Object.hasOwn(branch, 'value') || branch.value !== 'main' ||
        !sha || !Object.hasOwn(sha, 'value') ||
        typeof sha.value !== 'string' || !REVISION_RE.test(sha.value)) {
      throw new Error('invalid revision values')
    }
    return { branch: 'main', sha: sha.value }
  } catch {
    throw new Error('M3 field kit requires an exact clean main checkout')
  }
}

export function currentMainRevision() {
  try {
    const git = (...args) => execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
    const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD')
    const sha = git('rev-parse', '--verify', 'HEAD')
    // Refuse a locally out-of-date main relative to its tracked origin/main.
    // This is not a remote freshness check: operator must fetch/pull first.
    const trackedMain = git('rev-parse', '--verify', 'refs/remotes/origin/main')
    if (sha !== trackedMain) throw new Error('local main not aligned')
    // A tracked local modification would make a commit pin misleading.
    if (git('status', '--porcelain', '--untracked-files=no')) {
      throw new Error('dirty checkout')
    }
    const revision = { branch, sha }
    return checkedRevision(revision)
  } catch {
    throw new Error('M3 field kit requires an exact clean main checkout')
  }
}

export function buildM3FieldKit(revision) {
  const pinnedRevision = checkedRevision(revision)
  const sheet = buildObservationSheet()
  if (sheet.requirements.length !== 11 || sheet.baseline.lines.length !== 11 ||
      sheet.candidate.lines.length !== 11) {
    throw new Error('M3 field kit requires exactly eleven demands for each retailer')
  }
  for (const side of ['baseline', 'candidate']) {
    for (let i = 0; i < 11; i += 1) {
      const row = sheet[side].lines[i]
      const requirement = sheet.requirements[i]
      if (row.ingredientId !== requirement.id ||
          row.ingredientLabel !== requirement.label ||
          row.requirement.amount !== requirement.amount ||
          row.requirement.unit !== requirement.unit ||
          row.observedProduct.available !== null ||
          row.observedProduct.priceCents !== null) {
        throw new Error('M3 field kit has invalid or prefilled collection lines')
      }
    }
  }
  const demandSha256 = createHash('sha256')
    .update(JSON.stringify(sheet.requirements)).digest('hex')
  const provenance = {
    schemaVersion: 1,
    kind: 'm3-blank-manual-field-kit-revision',
    evidenceStatus: 'collection-kit-not-evidence',
    sourceBranch: 'main',
    sourceCommitSha: pinnedRevision.sha,
    canonicalDemandSha256: demandSha256,
    baselineRetailer: 'PLUS',
    candidateRetailer: 'DekaMarkt',
    requiredLinesPerRetailer: 11,
    verifiedRetailerObservations: false,
    publicSavingsClaimEligible: false,
    notice: 'Companion revision file only. Issue #205 must still persist this pin through the actual collected observation/study/report.',
  }
  const guide = [
    'SUPA M3 · lege veldmeetbundel (GEEN WINKELBEWIJS)',
    'Codeversie main: ' + pinnedRevision.sha,
    'Vaste eisen: 11 dezelfde ingredienten bij PLUS en DekaMarkt.',
    'Prijscontext: kies voor beide winkels in-store OF online-order.',
    'Waarnemingen: maximaal 24 uur uiteen. Noteer echte ISO-tijd met tijdzone.',
    '',
    '1. Lees deze codeversie en bewaar source-revision.json bij de latere private meting.',
    '2. Gebruik field-form.html als twee lege printformulieren voor de winkels.',
    '3. Vul collection-sheet.json pas met echt geobserveerde producten, beschikbaarheid,',
    '   verpakking, aantal pakken, prijs per pak, bron en herkomst. Geen schattingen.',
    '4. Vul alleen pseudonieme deelnemerscodes in; geen namen, e-mail of account-ID.',
    '5. Bij ontbrekend product: markeer expliciet niet beschikbaar; geen nulprijs of gok.',
    '6. Houd bronbestanden en deze bundel prive; commit nooit de ingevulde meting.',
    '7. Converteer later met npm run m3:build-observed-study -- <input> --output <nieuw>.json',
    '8. Beoordeel met npm run m3:assess-observed-week -- <study> --output <nieuw>.json',
    '9. Vraag onafhankelijke review voor #78; geen publieke besparing of M4-promotie.',
    '',
    'LET OP: issue #205 staat nog open. Deze begeleidende broncode-pin wordt nog NIET',
    'automatisch opgenomen in het studie-JSON of financiele rapport; bewaar samen.',
    'Automatisch ophalen van winkelprijzen blijft verboden zonder bronrechten (#74).',
    '',
  ].join('\n')
  return {
    'collection-sheet.json': JSON.stringify(sheet, null, 2) + '\n',
    'field-form.html': renderM3PaperChecklist(),
    'source-revision.json': JSON.stringify(provenance, null, 2) + '\n',
    'START-HERE.txt': guide,
  }
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 ||
      argv[0] !== '--output-dir' || typeof argv[1] !== 'string' ||
      !argv[1].trim() || argv[1].trim() !== argv[1] ||
      argv[1].startsWith('-') || /[\u0000-\u001f\u007f]/u.test(argv[1])) {
    throw new Error('usage: m3-prepare-field-kit --output-dir <new-private-directory>')
  }
  return argv[1]
}

/**
 * Private filled retailer sheets must never sit inside ANY existing Git
 * checkout, not merely inside the Supa checkout running this command.
 * Worktrees use a .git FILE instead of a directory; both are refused.
 * Do not follow or read the marker, which may itself be an untrusted link.
 * This is an operator mistake guard, not a hostile-filesystem race sandbox.
 */
async function assertOutsideAnyGitCheckout(output) {
  if (basename(output) === '.git') {
    throw new Error('refusing M3 private output under a Git checkout')
  }
  let parent = dirname(output)
  while (true) {
    try {
      await lstat(join(parent, '.git'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const next = dirname(parent)
      if (next === parent) break
      parent = next
      continue
    }
    throw new Error('refusing M3 private output under a Git checkout')
  }
}

export async function writeM3FieldKit(destination, kit) {
  if (typeof destination !== 'string' || !destination.trim() ||
      destination.trim() !== destination ||
      destination.startsWith('-') || /[\u0000-\u001f\u007f]/u.test(destination)) {
    throw new Error('invalid M3 field kit destination')
  }
  const expectedFiles = [
    'collection-sheet.json', 'field-form.html', 'source-revision.json', 'START-HERE.txt',
  ]
  // Snapshot exactly the four OWN data properties once. A caller-provided
  // accessor (or Proxy get trap) must not swap canonical bytes between
  // validation and writeFile. The final output uses ONLY this pinned snapshot.
  // Descriptor reflection may itself trap; fail closed without echoing
  // untrusted private values or exception text.
  const pinned = Object.create(null)
  try {
    if (!kit || typeof kit !== 'object' || Array.isArray(kit)) {
      throw new Error('invalid kit object')
    }
    const keys = Reflect.ownKeys(kit)
    if (keys.length !== expectedFiles.length ||
        keys.some((key) => typeof key !== 'string' || !expectedFiles.includes(key))) {
      throw new Error('unexpected kit fields')
    }
    for (const file of expectedFiles) {
      const descriptor = Reflect.getOwnPropertyDescriptor(kit, file)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
          typeof descriptor.value !== 'string') {
        throw new Error('unsafe kit field')
      }
      pinned[file] = descriptor.value
    }
  } catch {
    throw new Error('incomplete blank M3 field kit')
  }
  // The exported writer must not accept prefilled or substituted "blank"
  // artifacts. Rebuild all four canonical bytes from the claimed companion
  // revision *before* touching the filesystem. The actual CLI additionally
  // authenticates that revision against its current clean Git main checkout.
  let companion
  try {
    companion = JSON.parse(pinned['source-revision.json'])
    checkedRevision({
      branch: companion.sourceBranch,
      sha: companion.sourceCommitSha,
    })
  } catch {
    throw new Error('invalid blank M3 kit revision companion')
  }
  const canonical = buildM3FieldKit({
    branch: companion.sourceBranch, sha: companion.sourceCommitSha,
  })
  if (expectedFiles.some((file) => pinned[file] !== canonical[file])) {
    throw new Error('refusing modified or prefilled M3 field kit')
  }
  const output = resolve(destination)
  // Later filled sheets contain private retailer observations and pseudonymous
  // study metadata. They must never be generated under this Git checkout,
  // where a routine `git add -A` could accidentally publish evidence.
  // Resolve first to reject dot-dot traversal and relative child paths.
  if (output === REPO_ROOT || output.startsWith(REPO_ROOT + sep)) {
    throw new Error('refusing M3 field kit destination inside source repository')
  }
  await assertNoSymlinkedM3OutputParents(output)
  await assertOutsideAnyGitCheckout(output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  // mkdir without recursive refuses an existing directory, symlink, or file:
  // never replace or silently add data to an existing private evidence folder.
  await mkdir(output, { mode: 0o700 })
  try {
    for (const file of expectedFiles) {
      await writeFile(join(output, file), pinned[file], {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    }
  } catch {
    // This newly-created directory holds only our blank kit. Do not risk
    // deleting a raced replacement directory or user-created evidence.
    throw new Error('incomplete blank M3 kit; inspect new private directory')
  }
  return { files: expectedFiles, sourceCommitSha: companion.sourceCommitSha }
}

export async function main(argv = process.argv.slice(2)) {
  const destination = parseArgs(argv)
  const revision = currentMainRevision()
  const kit = buildM3FieldKit(revision)
  const result = await writeM3FieldKit(destination, kit)
  process.stdout.write(
    'SUPA M3: vier LEGE private veldbestanden gemaakt op main ' +
    result.sourceCommitSha + '. Geen winkelwaarneming of besparing.\n',
  )
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never reveal private file paths, entered names, or stack traces in CLI logs.
    process.stderr.write('M3 field kit geweigerd: gebruik een schone main en een nieuwe prive-map.\n')
    process.exitCode = 1
  })
}
