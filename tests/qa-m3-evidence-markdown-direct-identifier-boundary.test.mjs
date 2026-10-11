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
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+(?:\\[[ xX]\\][ \\t]+)?|[0-9]{1,3}[.)][ \\t]+)*(?:\\*\\*|__|\\x60)?' +
    identifierField + '(?:\\*\\*|__|\\x60)?\\s*(?::|=)\\s*\\S+',
  'im',
)
const tableValueLine = new RegExp(
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+(?:\\[[ xX]\\][ \\t]+)?|[0-9]{1,3}[.)][ \\t]+)*\\|[ \\t]*(?:\\*\\*|__|\\x60)?' + identifierField +
    '(?:\\*\\*|__|\\x60)?\\s*\\|\\s*[^|\\s][^|]*\\|?',
  'im',
)


const quotedFieldValueLine = new RegExp(
  '^[ \\t]*(?:>[ \\t]*|#{1,6}[ \\t]+|[-*+][ \\t]+(?:\\[[ xX]\\][ \\t]+)?|[0-9]{1,3}[.)][ \\t]+)*(?:\\{\\s*)?(?:\\x22|\\x27)' +
    identifierField + '(?:\\x22|\\x27)\\s*(?::|=)\\s*\\S+',
  'im',
)
const htmlTableValueLine = new RegExp(
  '<(?:td|th)\\b[^>]*>\\s*(?:<(?<mark>strong|b|code)\\b[^>\\r\\n]{0,512}>\\s*)?' + identifierField +
    '\\s*(?:<\\/\\k<mark>>\\s*)?<\\/(?:td|th)>\\s*<(?:td|th)\\b[^>]*>\\s*\\S+',
  'im',
)
const htmlCommentValueLine = new RegExp(
  '<!--\\s*' + identifierField + '\\s*(?::|=)\\s*\\S+[\\s\\S]*?-->',
  'im',
)

// Raw HTML definition lists render field labels and their paired values.
// A closing </dd> tag is not a nonempty disclosed value.
const htmlDefinitionValueLine = new RegExp(
  '<dt\\b[^>\\r\\n]{0,512}>\\s*(?:<(?<defmark>strong|b|code)\\b[^>\\r\\n]{0,512}>\\s*)?' +
    identifierField + '\\s*(?:<\\/\\k<defmark>>\\s*)?<\\/dt>\\s*<dd\\b[^>\\r\\n]{0,512}>\\s*(?:<(?:span|strong|b|em|code)\\b[^>\\r\\n]{0,512}>\\s*){0,2}[^\\s<]+',
  'im',
)

// Decode only visible ASCII numeric HTML references for privacy scanning.
// This stays in-memory: source evidence and permissions are unchanged.
function privacyScanText(markdown) {
  return markdown.normalize('NFKC')
    .replace(/[\u00ad\u200b-\u200f\u2060\u2066-\u2069\ufeff]/g, '')
    .replace(/&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g, (reference, hex, decimal) => {
      const code = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16)
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : reference
    })
    // CommonMark also renders HTML5 named references for these visible
    // identifier delimiters. Keep this deliberately small and inspect-only.
    .replace(/&(lowbar|period|hyphen|colon|commat|equals|nbsp|Tab);/g, (_, name) => {
      const values = {
        lowbar: '_', period: '.', hyphen: '-', colon: ':',
        commat: '@', equals: '=', nbsp: ' ', Tab: ' ',
      }
      return values[name]
    })
}

function assertMarkdownHasNoObviousDirectIdentifiers(markdown, displayPath) {
  assert.equal(typeof markdown, 'string')
  // NFKC folds width/compatibility variants before text-only privacy checks.
  // Deliberately leave file paths, evidence files and collection metadata untouched.
  // This is a backstop against obvious labelled IDs, not general PII detection.
  // Ignore selected invisible format controls only in scanner text, including
  // soft hyphens, bidi marks/isolates and BOM. Keep actual evidence bytes intact.
  // This prevents visually unchanged ID labels and email addresses hiding
  // from the backstop without modifying any stored Markdown evidence.
  // Decode visible Markdown punctuation escapes before scanning explicit IDs.
  // This modifies only the in-memory scan text, never the evidence note itself.
  // Inspect original link targets before unwrapping rendered field labels:
  // otherwise a mailto: URL could lose its email address during scanning.
  assert.doesNotMatch(
    privacyScanText(markdown),
    emailLike,
    'obvious participant identifier email is not allowed in M3 Markdown evidence: ' + displayPath,
  )
  markdown = privacyScanText(markdown)
    // Unwrap simple linked field labels for the scanner only: rendered
    // Markdown/HTML links must not conceal an otherwise explicit ID field.
    // Retain the original evidence bytes; this is not an HTML parser.
    .replace(/\\([_.-])/g, '$1')
    .replace(/\[([^\]\r\n]{1,160})\]\([^()\r\n]{1,512}\)/g, '$1')
    // Resolve simple reference/collapsed linked field labels in scan text only.
    // Link definitions and raw M3 notes remain untouched.
    .replace(/\[([^\]\r\n]{1,160})\]\[[^\]\r\n]{0,160}\]/g, '$1')
    .replace(/<a\b[^>\r\n]{0,512}>\s*([^<\r\n]{1,160}?)\s*<\/a>/gi, '$1')
  // Inline phrasing tags render their contents in a visible field label.
  // Strip only bounded presentational tags in scan text, never in evidence.
  // Original email/link targets were already checked before this step.
  markdown = markdown.replace(/<\/?(?:strong|b|em|i|code|span|p)\b[^>\r\n]{0,512}>/gi, '')
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
    htmlDefinitionValueLine,
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
