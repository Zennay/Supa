import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

// Independent QA #992: compile synthetic source with actual application options,
// not a second copy of the source-level tsconfig property assertion.
const root = fileURLToPath(new URL('../', import.meta.url))
const configPath = path.join(root, 'tsconfig.app.json')
const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
assert.equal(loaded.error, undefined, 'application TypeScript config must parse')
const project = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root)
assert.deepEqual(project.errors, [], 'actual application TypeScript options must resolve')
const fixturePath = path.join(root, '__qa_app_switch_fallthrough_virtual__.ts')

function diagnosticsFromSource(code) {
  const options = { ...project.options, noEmit: true }
  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  host.fileExists = file => file === fixturePath || originalFileExists(file)
  host.readFile = file => file === fixturePath ? code : originalReadFile(file)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNew) => {
    if (file === fixturePath) {
      return ts.createSourceFile(file, code, languageVersion, true)
    }
    return originalGetSourceFile(file, languageVersion, onError, shouldCreateNew)
  }

  const program = ts.createProgram([fixturePath], options, host)
  return ts.getPreEmitDiagnostics(program)
}

test('QA #992: actual app TypeScript compiler rejects three fallthrough styles', () => {
  assert.equal(project.options.noFallthroughCasesInSwitch, true)
  const code = `
export function first(value: string) {
  switch (value) {
    case 'a':
      console.log('one')
    case 'b':
      return 2
    default:
      return 3
  }
}
export function second(value: string) {
  switch (value) {
    case 'a': {
      console.log('block')
    }
    case 'b':
      break
  }
}
export function third(value: string) {
  switch (value) {
    case 'a':
      if (value === 'a') console.log('condition')
    default:
      break
  }
}
`
  const diagnostics = diagnosticsFromSource(code)
  const failures = diagnostics.filter(diagnostic => diagnostic.code === 7029)
  assert.equal(failures.length, 3,
    'expected TS7029 for unintentional adjacent-case, block-case and default fallthrough; ' +
    'got ' + diagnostics.map(item => item.code + ':' + ts.flattenDiagnosticMessageText(item.messageText, ' ')).join(' | '))
})

test('QA #992: terminating and shared-label switch arms remain valid', () => {
  const code = `
export function safe(value: string) {
  switch (value) {
    case 'a':
      break
    case 'b':
      return 2
    case 'c':
      throw Error('synthetic expected failure')
    default:
      return 3
  }
}
export function sharedLabels(value: string) {
  switch (value) {
    case 'a':
    case 'b':
      return 1
    default:
      return 2
  }
}
`
  const diagnostics = diagnosticsFromSource(code)
  assert.deepEqual(
    diagnostics.filter(diagnostic => diagnostic.code === 7029).map(item => item.code),
    [],
    'explicit break/return/throw and empty grouped case labels must remain usable',
  )
})
