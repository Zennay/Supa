import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']
const jsTriviaPattern = String.raw`(?:\s|\/\*[\s\S]*?\*\/)*`
const disabledCallPattern = new RegExp(
  `\\b(?:${aliases.join('|')})${jsTriviaPattern}(?:\\.${jsTriviaPattern}(?:${disabledMembers.join('|')})|\\[${jsTriviaPattern}(?:'(?:${disabledMembers.join('|')})'|"(?:${disabledMembers.join('|')})"|\`(?:${disabledMembers.join('|')})\`)${jsTriviaPattern}\\])${jsTriviaPattern}\\(`,
)
const permanentlyDisabledOptionPattern =
  /(?:\b(?:skip|todo)|['"](?:skip|todo)['"]|\[(?:\s|\/\*[\s\S]*?\*\/)*(?:'(?:skip|todo)'|"(?:skip|todo)"|`(?:skip|todo)`)(?:\s|\/\*[\s\S]*?\*\/)*\])(?:\s|\/\*[\s\S]*?\*\/)*:(?:\s|\/\*[\s\S]*?\*\/)*(?:true\b|'[^'\r\n]+'|"[^"\r\n]+"|`(?![^`\r\n]*\${)[^`\r\n]+`)/

function escapeRegex(value) {
  const special = new Set(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|'])
  return [...value]
    .map((character) => special.has(character) ? `\\${character}` : character)
    .join('')
}
function importedNodeTestDisabledCall(source) {
  const importedAliases = []

  const defaultImportPattern =
    /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?(?:\s|\/\*[\s\S]*?\*\/)+from(?:\s|\/\*[\s\S]*?\*\/)+['\"]node:test['\"]/g
  for (const match of source.matchAll(defaultImportPattern)) {
    importedAliases.push(escapeRegex(match[1]))
  }

  const namedImportPattern =
    /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}(?:\s|\/\*[\s\S]*?\*\/)+from(?:\s|\/\*[\s\S]*?\*\/)+['\"]node:test['\"]/g
  for (const match of source.matchAll(namedImportPattern)) {
    for (const specifier of match[1].split(',')) {
      const named = specifier
        .trim()
        .match(/^(test|it|describe|suite)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (named) importedAliases.push(escapeRegex(named[2] ?? named[1]))
    }
  }

  const namespaceImportPattern =
    /\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)(?:\s|\/\*[\s\S]*?\*\/)+from(?:\s|\/\*[\s\S]*?\*\/)+['\"]node:test['\"]/g
  for (const match of source.matchAll(namespaceImportPattern)) {
    for (const apiName of aliases) {
      importedAliases.push(
        escapeRegex(match[1]) + '\\s*\\.\\s*' + escapeRegex(apiName),
      )
    }
  }

  const dynamicNamespaceImportPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import(?:\s|\/\*[\s\S]*?\*\/)*\(\s*['\"]node:test['\"]\s*\)/g
  for (const match of source.matchAll(dynamicNamespaceImportPattern)) {
    for (const apiName of aliases) {
      importedAliases.push(
        escapeRegex(match[1]) + '\\s*\\.\\s*' + escapeRegex(apiName),
      )
    }
  }

  const dynamicNamedImportPattern =
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import(?:\s|\/\*[\s\S]*?\*\/)*\(\s*['\"]node:test['\"]\s*\)/g
  for (const match of source.matchAll(dynamicNamedImportPattern)) {
    for (const specifier of match[1].split(',')) {
      const named = specifier
        .trim()
        .match(/^(test|it|describe|suite)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/)
      if (named) importedAliases.push(escapeRegex(named[2] ?? named[1]))
    }
  }

  const disabledMemberAccess =
    `${jsTriviaPattern}(?:\\.${jsTriviaPattern}(?:skip|todo)|\\[${jsTriviaPattern}(?:'(?:skip|todo)'|\"(?:skip|todo)\"|\`(?:skip|todo)\`)${jsTriviaPattern}\\])${jsTriviaPattern}\\(`

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
    ['test', '/* trivia */', '.', 'skip', "('disabled', () => {})"].join(''),
    ['describe', '/* trivia */', '[`todo`]', '/* call */', '("disabled", () => {})'].join(''),
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
  const dynamicNamedAliasSource = [
    "const { test: check, describe: group } = await import('node:test')",
    ['check', '.skip', "('disabled', () => {})"].join(''),
  ].join('\n')
  const dynamicNamespaceAliasSource = [
    "const testApi = await import('node:test')",
    ['testApi', '.', 'suite', '[\"todo\"]', "('disabled', () => {})"].join(''),
  ].join('\n')
  const commentedStaticAliasSource = [
    "import { test as check } /* before from */ from/* source */'node:test'",
    ['check', '/* member */', '.', 'skip', "('disabled', () => {})"].join(''),
  ].join('\n')
  const commentedDynamicAliasSource = [
    "const testApi = await import/* call */('node:test')",
    ['testApi', '.', 'test', '/* member */', '[`todo`]', "('disabled', () => {})"].join(''),
  ].join('\n')
  const unrelatedAliasSource = [
    "import check from './helper.js'",
    ['check', '.skip', "('not a node:test API', () => {})"].join(''),
  ].join('\n')

  assert.ok(importedNodeTestDisabledCall(defaultAliasSource), defaultAliasSource)
  assert.ok(importedNodeTestDisabledCall(namedAliasSource), namedAliasSource)
  assert.ok(importedNodeTestDisabledCall(namespaceAliasSource), namespaceAliasSource)
  assert.ok(importedNodeTestDisabledCall(dynamicNamedAliasSource), dynamicNamedAliasSource)
  assert.ok(importedNodeTestDisabledCall(dynamicNamespaceAliasSource), dynamicNamespaceAliasSource)
  assert.ok(importedNodeTestDisabledCall(commentedStaticAliasSource), commentedStaticAliasSource)
  assert.ok(importedNodeTestDisabledCall(commentedDynamicAliasSource), commentedDynamicAliasSource)
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
  const quotedSkip = ["'", 'skip', "'", ': true'].join('')
  const quotedTodo = ['"', 'todo', '"', ': "pending regression"'].join('')
  const computedSkip = ["['", 'skip', "']", ': true'].join('')
  const computedTodo = ['[`', 'todo', '`]', ': `pending regression`'].join('')
  const conditionalQuotedSkip = ["'", 'skip', "'", ": process.platform === 'win32'"].join('')
  const conditionalComputedTodo = ['["', 'todo', '"]', ': shouldSkip'].join('')
  const commentedLiteralSkip = ["['", 'skip', "']", '/* key */', ':', '/* value */', ' true'].join('')
  const commentedConditionalTodo = ['"', 'todo', '"', '/* key */', ':', '/* value */', ' shouldSkip'].join('')

  assert.match(literalSkip, permanentlyDisabledOptionPattern)
  assert.match(literalTodo, permanentlyDisabledOptionPattern)
  assert.match(literalStringSkip, permanentlyDisabledOptionPattern)
  assert.match(literalStringTodo, permanentlyDisabledOptionPattern)
  assert.match(literalTemplateSkip, permanentlyDisabledOptionPattern)
  assert.match(literalTemplateTodo, permanentlyDisabledOptionPattern)
  assert.match(quotedSkip, permanentlyDisabledOptionPattern)
  assert.match(quotedTodo, permanentlyDisabledOptionPattern)
  assert.match(computedSkip, permanentlyDisabledOptionPattern)
  assert.match(computedTodo, permanentlyDisabledOptionPattern)
  assert.match(commentedLiteralSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(emptyStringSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(emptyTemplateSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalTemplateSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalQuotedSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalComputedTodo, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(commentedConditionalTodo, permanentlyDisabledOptionPattern)
})
