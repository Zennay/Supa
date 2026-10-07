import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']
const disabledCallPattern = new RegExp(
  `\\b(?:${aliases.join('|')})\\s*(?:\\.\\s*(?:${disabledMembers.join('|')})|\\[\\s*(?:'(?:${disabledMembers.join('|')})'|"(?:${disabledMembers.join('|')})"|\`(?:${disabledMembers.join('|')})\`)\\s*\\])\\s*\\(`,
)
const permanentlyDisabledOptionPattern =
  /\b(?:skip|todo)\s*:\s*(?:true\b|'[^'\r\n]+'|"[^"\r\n]+"|`(?![^`\r\n]*\${)[^`\r\n]+`)/

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\const permanentlyDisabledOptionPattern =
  /\b(?:skip|todo)\s*:\s*(?:true\b|'[^'\r\n]+'|"[^"\r\n]+"|`(?![^`\r\n]*\${)[^`\r\n]+`)/
')
}

function importedNodeTestDisabledCall(source) {
  const importedAliases = []

  const defaultImportPattern =
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s+['\"]node:test['\"]/g
  for (const match of source.matchAll(defaultImportPattern)) {
    importedAliases.push(escapeRegex(match[1]))
  }

  const namedImportPattern =
    /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s+from\s+['\"]node:test['\"]/g
  for (const match of source.matchAll(namedImportPattern)) {
    for (const specifier of match[1].split(',')) {
      const named = specifier
        .trim()
        .match(/^(test|it|describe|suite)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (named) importedAliases.push(escapeRegex(named[2] ?? named[1]))
    }
  }

  const namespaceImportPattern =
    /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['\"]node:test['\"]/g
  for (const match of source.matchAll(namespaceImportPattern)) {
    for (const apiName of aliases) {
      importedAliases.push(
        escapeRegex(match[1]) + '\\s*\\.\\s*' + escapeRegex(apiName),
      )
    }
  }

  const disabledMemberAccess =
    "\\s*(?:\\.\\s*(?:skip|todo)|\\[\\s*(?:'(?:skip|todo)'|\\\"(?:skip|todo)\\\"|`(?:skip|todo)`)\\s*\\])\\s*\\("

  for (const aliasPattern of importedAliases) {
    const disabledCall = source.match(
      new RegExp('\\b' + aliasPattern + disabledMemberAccess),
    )
    if (disabledCall) return disabledCall
  }

  return null
}

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')
    const disabledCall =
      source.match(disabledCallPattern) ?? importedNodeTestDisabledCall(source)
    const permanentDisable = source.match(permanentlyDisabledOptionPattern)

    assert.equal(
      disabledCall,
      null,
      `${file} explicitly disables a regression with ${disabledCall?.[0] ?? 'unknown call'}`,
    )
    assert.equal(
      permanentDisable,
      null,
      `${file} permanently disables a regression with a literal test option`,
    )
  }
})

test('disabled-test guard rejects dot and static bracket member calls', () => {
  const disabledCalls = [
    ['test', '.skip', "('disabled', () => {})"].join(''),
    ['it', "['skip']", "('disabled', () => {})"].join(''),
    ['describe', '["todo"]', '("disabled", () => {})'].join(''),
    ['suite', '[`skip`]', '("disabled", () => {})'].join(''),
  ]

  for (const disabledCall of disabledCalls) {
    assert.match(disabledCall, disabledCallPattern, disabledCall)
  }

  for (const enabledCall of [
    "test('enabled', () => {})",
    "it['runs']('enabled', () => {})",
    "describe[member]('dynamic', () => {})",
  ]) {
    assert.doesNotMatch(enabledCall, disabledCallPattern, enabledCall)
  }
})

test('disabled-test guard follows aliases imported from node:test', () => {
  const defaultAliasSource = [
    "import check from 'node:test'",
    ['check', '.skip', "('disabled', () => {})"].join(''),
  ].join('\n')
  const namedAliasSource = [
    "import { test as check, describe as group } from 'node:test'",
    ['group', '[\"todo\"]', "('disabled', () => {})"].join(''),
  ].join('\n')
  const namespaceAliasSource = [
    "import * as testApi from 'node:test'",
    ['testApi', '.', 'test', '.skip', "('disabled', () => {})"].join(''),
  ].join('\n')
  const unrelatedAliasSource = [
    "import check from './helper.js'",
    ['check', '.skip', "('not a node:test API', () => {})"].join(''),
  ].join('\n')

  assert.ok(importedNodeTestDisabledCall(defaultAliasSource), defaultAliasSource)
  assert.ok(importedNodeTestDisabledCall(namedAliasSource), namedAliasSource)
  assert.ok(importedNodeTestDisabledCall(namespaceAliasSource), namespaceAliasSource)
  assert.equal(importedNodeTestDisabledCall(unrelatedAliasSource), null)
})
test('disabled-test guard permits conditional skips but rejects literal disabled options', () => {
  const literalSkip = ['skip', ': true'].join('')
  const literalTodo = ['todo', ': true'].join('')
  const literalStringSkip = ['skip', ": 'flaky regression'"].join('')
  const literalStringTodo = ['todo', ': "pending regression"'].join('')
  const literalTemplateSkip = ['skip', ': `flaky regression`'].join('')
  const literalTemplateTodo = ['todo', ': `pending regression`'].join('')
  const emptyStringSkip = ['skip', ": ''"].join('')
  const emptyTemplateSkip = ['skip', ': ``'].join('')
  const conditionalSkip = ['skip', ": process.platform === 'win32'"].join('')
  const conditionalTemplateSkip = ['skip', ': `${process.platform}`'].join('')

  assert.match(literalSkip, permanentlyDisabledOptionPattern)
  assert.match(literalTodo, permanentlyDisabledOptionPattern)
  assert.match(literalStringSkip, permanentlyDisabledOptionPattern)
  assert.match(literalStringTodo, permanentlyDisabledOptionPattern)
  assert.match(literalTemplateSkip, permanentlyDisabledOptionPattern)
  assert.match(literalTemplateTodo, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(emptyStringSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(emptyTemplateSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalTemplateSkip, permanentlyDisabledOptionPattern)
})
