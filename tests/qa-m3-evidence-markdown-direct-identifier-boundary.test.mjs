import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const EVIDENCE_ROOT = fileURLToPath(new URL('../evidence/m3/', import.meta.url))
const emailLike = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

// Deliberately narrow: recognize field/value disclosure in Markdown notes,
// not every occurrence of a word such as "name" in policy prose.
// This is a backstop, not general-purpose PII identification.
const identifierField =
  '(?:participant[\\s_.-]*(?:name|email)|full[\\s_.-]*name|account[\\s_.-]*(?:id|email)|e[\\s_.-]*mail[\\s_.-]*(?:address|adres)|naam[\\s_.-]*deelnemer)'
const fieldValueLine = new RegExp(
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+)*(?:\\*\\*|__|\\x60)?' +
    identifierField + '(?:\\*\\*|__|\\x60)?\\s*(?::|=)\\s*\\S+',
  'im',
)
const tableValueLine = new RegExp(
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+)*\\|[ \\t]*(?:\\*\\*|__|\\x60)?' + identifierField +
    '(?:\\*\\*|__|\\x60)?\\s*\\|\\s*[^|\\s][^|]*\\|?',
  'im',
)


const quotedFieldValueLine = new RegExp(
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+)*(?:\\{\\s*)?(?:\\x22|\\x27)' +
    identifierField + '(?:\\x22|\\x27)\\s*(?::|=)\\s*\\S+',
  'im',
)
const htmlTableValueLine = new RegExp(
  '<(?:td|th)\\b[^>]*>\\s*(?:<(?<mark>strong|b|code)>\\s*)?' + identifierField +
    '\\s*(?:<\\/\\k<mark>>\\s*)?<\\/(?:td|th)>\\s*<(?:td|th)\\b[^>]*>\\s*\\S+',
  'im',
)
const htmlCommentValueLine = new RegExp(
  '<!--\\s*' + identifierField + '\\s*(?::|=)\\s*\\S+[^\\n]*?-->',
  'im',
)

function assertMarkdownHasNoObviousDirectIdentifiers(markdown, displayPath) {
  assert.equal(typeof markdown, 'string')
  // NFKC folds width/compatibility variants before text-only privacy checks.
  // Deliberately leave file paths, evidence files and collection metadata untouched.
  // This is a backstop against obvious labelled IDs, not general PII detection.
  markdown = markdown.normalize('NFKC')
  assert.doesNotMatch(
    markdown,
    emailLike,
    'obvious participant identifier email is not allowed in M3 Markdown evidence: ' + displayPath,
  )
  assert.doesNotMatch(
    markdown,
    fieldValueLine,
    'obvious participant identifier field is not allowed in M3 Markdown evidence: ' + displayPath,
  )
  assert.doesNotMatch(
    markdown,
    tableValueLine,
    'obvious participant identifier table field is not allowed in M3 Markdown evidence: ' + displayPath,
  )

  for (const pattern of [
    quotedFieldValueLine,
    htmlTableValueLine,
    htmlCommentValueLine,
  ]) {
    assert.doesNotMatch(
      markdown,
      pattern,
      'obvious participant identifier embedded field is not allowed in M3 Markdown evidence: ' + displayPath,
    )
  }
}

async function listMarkdownFiles(root = EVIDENCE_ROOT) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    assert.equal(entry.isSymbolicLink(), false, 'M3 evidence symlink: ' + relative(EVIDENCE_ROOT, path))
    if (entry.isDirectory()) files.push(...await listMarkdownFiles(path))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path)
  }
  return files.sort()
}

test('QA M3: every committed Markdown evidence note forbids obvious personal identifiers', async () => {
  const files = await listMarkdownFiles()
  assert.ok(files.some((path) => path.endsWith('README.md')))
  for (const file of files) {
    assertMarkdownHasNoObviousDirectIdentifiers(
      await readFile(file, 'utf8'),
      relative(EVIDENCE_ROOT, file),
    )
  }
})

test('QA M3: synthetic email and direct-name disclosure forms are refused', () => {
  for (const markdown of [
    'Contact: synthetic.person@example.test',
    '[Private contact](mailto:synthetic@example.test)',
    '- participant_name: Example Student',
    '**Full Name**: Example Student',
    'account-id = synthetic-user-001',
    '> Participant Email: synthetic-value',
    'Naam deelnemer: Example Student',
    '| full name | Example Student |',
    '| **participant-name** | Example Student |',
    'E-mail-adres: synthetic@example.test',
  ]) {
    assert.throws(
      () => assertMarkdownHasNoObviousDirectIdentifiers(markdown, 'synthetic-test.md'),
      /obvious participant identifier/,
      markdown,
    )
  }
})

test('QA M3: legitimate metadata and descriptive policy text stay allowed', () => {
  for (const markdown of [
    '# M3 privacy contract\nDo not commit names, email addresses, receipts or screenshots.',
    'participantKey: student-pseudonymous-001\nstudyId: synthetic-week-1',
    '- Grocery prices, basket provenance and collection window are described here.',
    '| Field | Meaning |\n| participantKey | pseudonymous reference |',
    '- Product name: Broccoli\n- Store name: PLUS',
  ]) {
    assert.doesNotThrow(() => assertMarkdownHasNoObviousDirectIdentifiers(markdown, 'synthetic-control.md'))
  }
})
