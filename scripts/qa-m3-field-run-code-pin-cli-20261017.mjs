#!/usr/bin/env node
// Optional private offline QA: compare the current-main commit recorded in
// three physical M3 artifacts. This does NOT pin the product converter by
// itself, prove retailer rights, verify shop prices, or enable public savings.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPrivateM3OperatorFile } from './qa-m3-private-csv-report-binding-20261017.mjs'
import { parsePrivateM3UniqueKeyJson } from './qa-m3-private-unique-json-keys-20261017.mjs'
import { auditPrivateM3FieldRunCodePin } from './qa-m3-field-run-code-pin-20261017.mjs'

const REFUSE = 'M3 private field-run pin proof refused'
const refuse = () => { throw new Error(REFUSE) }

export async function main(argv = process.argv.slice(2)) {
  try {
    if (!Array.isArray(argv) || argv.length !== 8 ||
        argv.some(x => typeof x !== 'string') ||
        argv[0] !== '--sheet' || argv[2] !== '--study' ||
        argv[4] !== '--assessment' || argv[6] !== '--expected-main-sha') refuse()
    const paths = [argv[1], argv[3], argv[5]]
    if (paths.some(p => !p || p !== p.trim() || p.startsWith('-') ||
        p.includes('\0')) || new Set(paths.map(p => resolve(p))).size !== 3) refuse()
    // Shared existing QA reader checks owner UID, 0600, one link, pinned FD,
    // bounded regular-file size, strict UTF-8, non-symlinked ancestor paths.
    const [sheetText, studyText, assessmentText] = await Promise.all(
      paths.map(p => readPrivateM3OperatorFile(p)))
    const sheet = parsePrivateM3UniqueKeyJson(sheetText)
    const study = parsePrivateM3UniqueKeyJson(studyText)
    const assessment = parsePrivateM3UniqueKeyJson(assessmentText)
    const proof = auditPrivateM3FieldRunCodePin(
      sheet, study, assessment, argv[7])
    process.stdout.write(JSON.stringify(proof) + '\n')
    return proof
  } catch {
    refuse() // Exact generic stderr; no participant, path, price or SHA.
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write(REFUSE + '\n')
    process.exitCode = 1
  })
}
