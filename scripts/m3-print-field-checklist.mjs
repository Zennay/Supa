import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderM3PaperChecklist } from '../src/features/observation/m3PaperWorksheet.ts'
import { assertNoSymlinkedM3OutputParents } from './m3-source-output-preservation.mjs'

// The same blank canonical A4 output is reused by the browser Meten screen.
export { renderM3PaperChecklist } from '../src/features/observation/m3PaperWorksheet.ts'

export async function main(argv = process.argv.slice(2)) {
  let output = null
  let fieldRunCommitSha = ''
  if (argv.length > 4 || argv.length % 2 !== 0) {
    throw new Error('Invalid paper checklist arguments')
  }
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (typeof value !== 'string' || !value || value.trim() !== value ||
        value.startsWith('-')) {
      throw new Error('Invalid paper checklist arguments')
    }
    if (flag === '--output' && output === null) output = value
    else if (flag === '--field-run-sha' && !fieldRunCommitSha) fieldRunCommitSha = value
    else throw new Error('Invalid paper checklist arguments')
  }
  const content = renderM3PaperChecklist(fieldRunCommitSha)
  if (output === null) return process.stdout.write(content)
  // Preserve raw path segments: resolving first can hide a symlink before /../.
  // Reuse the same static private M3 output-parent guard as derived reports.
  // This is not a descriptor-relative guarantee against concurrent path swaps.
  await assertNoSymlinkedM3OutputParents(output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await assertNoSymlinkedM3OutputParents(output)
  await writeFile(output, content, { flag: 'wx', mode: 0o600, encoding: 'utf8' })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Could not create blank M3 field worksheet; no observed prices were generated')
    process.exitCode = 1
  })
}
