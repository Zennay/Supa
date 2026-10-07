import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const directPrivilegedNavigatorMethods = new Set(['share'])
const privilegedNavigatorMethods = new Map([
  ['bluetooth', new Set(['requestDevice'])],
  ['clipboard', new Set(['read', 'readText', 'write', 'writeText'])],
  ['contacts', new Set(['select'])],
  ['credentials', new Set(['create', 'get', 'preventSilentAccess', 'store'])],
  ['geolocation', new Set(['getCurrentPosition', 'watchPosition'])],
  ['hid', new Set(['requestDevice'])],
  ['mediaDevices', new Set(['getDisplayMedia', 'getUserMedia'])],
  ['serial', new Set(['requestPort'])],
  ['usb', new Set(['requestDevice'])],
  ['wakeLock', new Set(['request'])],
])

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

function isNavigatorObject(node, navigatorAliases = new Set()) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return current.text === 'navigator' || navigatorAliases.has(current.text)
  }

  return isBrowserGlobalMember(current, 'navigator')
}

function navigatorCapabilityName(
  node,
  navigatorAliases = new Set(),
  capabilityAliases = new Map(),
) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return capabilityAliases.get(current.text) ?? null
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null
  }

  if (!isNavigatorObject(current.expression, navigatorAliases)) return null

  const name = memberName(current)
  return privilegedNavigatorMethods.has(name) ? name : null
}

function collectNavigatorAliases(sourceFile) {
  const navigatorAliases = new Set()
  const capabilityAliases = new Map()
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

        const capability = navigatorCapabilityName(
          initializer,
          navigatorAliases,
          capabilityAliases,
        )
        if (capability && capabilityAliases.get(alias) !== capability) {
          capabilityAliases.set(alias, capability)
          changed = true
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return { navigatorAliases, capabilityAliases }
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

function findPrivilegedBrowserCapability(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
  const { navigatorAliases, capabilityAliases } = collectNavigatorAliases(sourceFile)

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isNewExpression(node) && isBrowserGlobalMember(node.expression, 'Notification')) {
      finding = {
        kind: 'Notification construction',
        text: node.expression.getText(sourceFile),
      }
      return
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const capability = navigatorCapabilityName(
        node.expression,
        navigatorAliases,
        capabilityAliases,
      )
      const method = memberName(node)

      if (
        isNavigatorObject(node.expression, navigatorAliases) &&
        directPrivilegedNavigatorMethods.has(method)
      ) {
        finding = {
          kind: 'navigator.' + method + ' reference',
          text: node.getText(sourceFile),
        }
        return
      }

      if (capability && privilegedNavigatorMethods.get(capability)?.has(method)) {
        finding = {
          kind: capability + '.' + method + ' reference',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        isBrowserGlobalMember(node.expression, 'Notification') &&
        method === 'requestPermission'
      ) {
        finding = {
          kind: 'Notification.requestPermission reference',
          text: node.getText(sourceFile),
        }
        return
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

test('production source has no unreviewed privileged browser capabilities', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findPrivilegedBrowserCapability(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains an unreviewed privileged browser capability: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('privileged-capability boundary catches direct calls and detached browser aliases', () => {
  for (const source of [
    'navigator.geolocation.getCurrentPosition(onPosition)',
    "window.navigator['geolocation']['watchPosition'](onPosition)",
    'navigator.clipboard.readText()',
    'const copy = globalThis.navigator.clipboard.writeText',
    'navigator.mediaDevices.getUserMedia({ audio: true })',
    "self.navigator['mediaDevices']['getDisplayMedia']()",
    'navigator.credentials.get(options)',
    'const store = window.navigator.credentials.store',
    'navigator.share({ title: "SUPA" })',
    'const share = globalThis.navigator.share',
    'navigator.bluetooth.requestDevice({ filters: [] })',
    "window.navigator['usb']['requestDevice']({ filters: [] })",
    'const choosePort = navigator.serial.requestPort',
    'navigator.hid.requestDevice({ filters: [] })',
    'navigator.contacts.select(["name"])',
    'const keepAwake = self.navigator.wakeLock.request',
    "new Notification('SUPA')",
    "new window['Notification']('SUPA')",
    'Notification.requestPermission()',
    'const ask = globalThis.Notification.requestPermission',
  ]) {
    assert.ok(findPrivilegedBrowserCapability(source), source)
  }
})

test('privileged-capability boundary follows navigator and capability aliases', () => {
  for (const source of [
    'const nav = navigator; nav.share({ title: "SUPA" })',
    'const nav = window.navigator; const next = nav; next.bluetooth.requestDevice({ filters: [] })',
    'const clipboard = navigator.clipboard; clipboard.readText()',
    'const nav = self.navigator; const media = nav.mediaDevices; media.getUserMedia({ audio: true })',
    'let hardware = navigator.usb; hardware.requestDevice({ filters: [] })',
  ]) {
    assert.ok(findPrivilegedBrowserCapability(source), source)
  }
})

test('privileged-capability boundary preserves unrelated local APIs and inert text', () => {
  for (const source of [
    'locationClient.geolocation.getCurrentPosition(onPosition)',
    'editor.clipboard.writeText(text)',
    'mediaDevices.getUserMedia(options)',
    'auth.credentials.get(options)',
    'sharing.share(payload)',
    'device.bluetooth.requestDevice(options)',
    'hardware.usb.requestDevice(options)',
    'ports.serial.requestPort()',
    'input.hid.requestDevice(options)',
    'directory.contacts.select(fields)',
    'screen.wakeLock.request("screen")',
    'const nav = app.navigator; nav.share(payload)',
    'const clipboard = editor.clipboard; clipboard.readText()',
    "notifications.requestPermission('local')",
    "new notifier.Notification('local')",
    "const example = \"const nav = navigator; nav.share({ title: 'SUPA' })\"",
    "// const usb = navigator.usb; usb.requestDevice({ filters: [] })",
    'const NotificationLike = class {}; new NotificationLike()',
    'navigator.language',
  ]) {
    assert.equal(findPrivilegedBrowserCapability(source), null, source)
  }
})
