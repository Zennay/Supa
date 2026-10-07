import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const messagingConstructors = new Set(['BroadcastChannel', 'MessageChannel'])

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

  if (ts.isIdentifier(current)) return current.text === expectedName

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

function isQualifiedWindowProxy(node) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    new Set(['opener', 'parent', 'top']).has(memberName(current))
  )
}

function isBrowserPostMessageReference(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) return current.text === 'postMessage'

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  if (memberName(current) !== 'postMessage') return false

  const base = unwrapExpression(current.expression)
  if (ts.isIdentifier(base) && browserRoots.has(base.text)) return true
  return isQualifiedWindowProxy(base)
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

function findCrossContextMessaging(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (isBrowserPostMessageReference(node)) {
        finding = {
          kind: 'browser postMessage reference',
          text: node.getText(sourceFile),
        }
        return
      }

      for (const constructorName of messagingConstructors) {
        if (isBrowserGlobalMember(node, constructorName)) {
          finding = {
            kind: constructorName + ' browser-global reference',
            text: node.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isCallExpression(node) && isBrowserPostMessageReference(node.expression)) {
      finding = {
        kind: 'browser postMessage call',
        text: node.expression.getText(sourceFile),
      }
      return
    }

    if (ts.isNewExpression(node)) {
      for (const constructorName of messagingConstructors) {
        if (isBrowserGlobalMember(node.expression, constructorName)) {
          finding = {
            kind: constructorName + ' construction',
            text: node.expression.getText(sourceFile),
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

test('production source has no unreviewed cross-context browser messaging', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findCrossContextMessaging(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains unreviewed cross-context browser messaging: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('messaging boundary catches direct browser messaging primitives', () => {
  for (const source of [
    "postMessage({ type: 'state' }, '*')",
    "window.postMessage({ type: 'state' }, '*')",
    "self['postMessage']({ type: 'state' })",
    "globalThis.parent.postMessage({ type: 'state' }, '*')",
    "window['top']['postMessage']({ type: 'state' }, '*')",
    'const send = window.postMessage',
    "new BroadcastChannel('supa')",
    "new window['BroadcastChannel']('supa')",
    'const Channel = globalThis.BroadcastChannel',
    'new MessageChannel()',
    'new self.MessageChannel()',
  ]) {
    assert.ok(findCrossContextMessaging(source), source)
  }
})

test('messaging boundary preserves local APIs and inert text', () => {
  for (const source of [
    "bridge.postMessage({ type: 'local' })",
    "channelFactory.BroadcastChannel('local')",
    "new runtime.MessageChannel()",
    "const postMessage = () => {}; postMessage('local')",
    "const example = \"window.postMessage({ ok: true }, '*')\"",
    "// new BroadcastChannel('example')",
    'const messageChannelCount = 1',
  ]) {
    assert.equal(findCrossContextMessaging(source), null, source)
  }
})
