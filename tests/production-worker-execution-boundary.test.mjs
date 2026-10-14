import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const workerConstructors = new Set(['SharedWorker', 'Worker'])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticName(node.expression)
  return null
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return staticName(node.argumentExpression)
  return null
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function isBrowserGlobalMember(node, expectedName) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return current.text === expectedName
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === expectedName
  )
}

function isNavigatorObject(node, navigatorAliases = new Set()) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) {
    return current.text === 'navigator' || navigatorAliases.has(current.text)
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === 'navigator'
  )
}

function isServiceWorkerObject(
  node,
  navigatorAliases = new Set(),
  serviceWorkerAliases = new Set(),
) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) {
    return serviceWorkerAliases.has(current.text)
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isNavigatorObject(current.expression, navigatorAliases) &&
    memberName(current) === 'serviceWorker'
  )
}

function workerConstructorName(node, workerAliases = new Map()) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current) && workerAliases.has(current.text)) {
    return workerAliases.get(current.text)
  }

  for (const constructorName of workerConstructors) {
    if (isBrowserGlobalMember(current, constructorName)) return constructorName
  }
  return null
}

function isImportScriptsReference(node, importScriptsAliases = new Set()) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current) && importScriptsAliases.has(current.text)) {
    return true
  }
  return isBrowserGlobalMember(current, 'importScripts')
}

function collectExecutionAliases(sourceFile) {
  const navigatorAliases = new Set()
  const serviceWorkerAliases = new Set()
  const workerAliases = new Map()
  const importScriptsAliases = new Set()
  let changed = true

  while (changed) {
    changed = false

    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const alias = node.name.text
        const initializer = unwrapExpression(node.initializer)

        if (!navigatorAliases.has(alias) && isNavigatorObject(initializer, navigatorAliases)) {
          navigatorAliases.add(alias)
          changed = true
        }

        if (
          !serviceWorkerAliases.has(alias) &&
          isServiceWorkerObject(initializer, navigatorAliases, serviceWorkerAliases)
        ) {
          serviceWorkerAliases.add(alias)
          changed = true
        }

        const constructorName = workerConstructorName(initializer, workerAliases)
        if (constructorName && workerAliases.get(alias) !== constructorName) {
          workerAliases.set(alias, constructorName)
          changed = true
        }

        if (
          !importScriptsAliases.has(alias) &&
          isImportScriptsReference(initializer, importScriptsAliases)
        ) {
          importScriptsAliases.add(alias)
          changed = true
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return {
    navigatorAliases,
    serviceWorkerAliases,
    workerAliases,
    importScriptsAliases,
  }
}

function scriptKindFor(filename) {
  switch (path.extname(filename)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function findSecondaryBrowserExecution(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
  const {
    navigatorAliases,
    serviceWorkerAliases,
    workerAliases,
    importScriptsAliases,
  } = collectExecutionAliases(sourceFile)

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      for (const constructorName of workerConstructors) {
        if (isBrowserGlobalMember(node, constructorName)) {
          finding = {
            kind: constructorName + ' browser-global reference',
            text: node.getText(sourceFile),
          }
          return
        }
      }

      if (isBrowserGlobalMember(node, 'importScripts')) {
        finding = {
          kind: 'worker importScripts reference',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        isServiceWorkerObject(
          node.expression,
          navigatorAliases,
          serviceWorkerAliases,
        ) &&
        memberName(node) === 'register'
      ) {
        finding = {
          kind: 'service-worker registration reference',
          text: node.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isNewExpression(node)) {
      const constructorName = workerConstructorName(node.expression, workerAliases)
      if (constructorName) {
        finding = {
          kind: constructorName + ' construction',
          text: node.expression.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)

      if (isImportScriptsReference(callee, importScriptsAliases)) {
        finding = {
          kind: 'worker importScripts call',
          text: callee.getText(sourceFile),
        }
        return
      }

      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        if (
          isServiceWorkerObject(
            callee.expression,
            navigatorAliases,
            serviceWorkerAliases,
          ) &&
          memberName(callee) === 'register'
        ) {
          finding = {
            kind: 'service-worker registration',
            text: callee.getText(sourceFile),
          }
          return
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listProductionSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listProductionSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('production source has no secondary browser execution contexts', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findSecondaryBrowserExecution(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden secondary browser execution: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('worker execution boundary catches direct browser execution primitives', () => {
  for (const source of [
    "new Worker('/worker.js')",
    "new window['Worker']('/worker.js')",
    "new SharedWorker('/shared.js')",
    "new globalThis.SharedWorker('/shared.js')",
    "navigator.serviceWorker.register('/sw.js')",
    "window.navigator['serviceWorker']['register']('/sw.js')",
    "importScripts('/runtime.js')",
    "self['importScripts']('/runtime.js')",
    "const WorkerCtor = window.Worker",
    "const register = navigator.serviceWorker.register",
    "const loader = self.importScripts",
  ]) {
    assert.ok(findSecondaryBrowserExecution(source), source)
  }
})

test('worker execution boundary follows execution-context aliases', () => {
  for (const source of [
    "const W = Worker; new W('/worker.js')",
    "const W = window.Worker; const Next = W; new Next('/worker.js')",
    "let Shared = SharedWorker; new Shared('/shared.js')",
    "const loader = importScripts; loader('/runtime.js')",
    "const loader = self.importScripts; const nextLoader = loader; nextLoader('/runtime.js')",
    "const nav = navigator; nav.serviceWorker.register('/sw.js')",
    "const nav = window.navigator; const sw = nav.serviceWorker; sw.register('/sw.js')",
  ]) {
    assert.ok(findSecondaryBrowserExecution(source), source)
  }
})

test('worker execution boundary ignores inert text and unrelated local APIs', () => {
  for (const source of [
    "// new Worker('/example.js')",
    "const example = \"navigator.serviceWorker.register('/example.js')\"",
    "pool.Worker('/local')",
    "new runtime.Worker('/local')",
    "serviceWorker.register('/local')",
    "registry.serviceWorker.register('/local')",
    "loader.importScripts('/local')",
    "const W = runtime.Worker; new W('/local')",
    "const loader = runtime.importScripts; loader('/local')",
    "const nav = app.navigator; nav.serviceWorker.register('/local')",
    "const sw = registry.serviceWorker; sw.register('/local')",
  ]) {
    assert.equal(findSecondaryBrowserExecution(source), null, source)
  }
})
