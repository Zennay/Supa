import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const storageNames = new Set(['localStorage', 'sessionStorage'])
const keyedMethods = new Set(['getItem', 'removeItem', 'setItem'])

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

function storageName(node) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current) && storageNames.has(current.text)) {
    return current.text
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null
  }

  const base = unwrapExpression(current.expression)
  if (!ts.isIdentifier(base) || !browserRoots.has(base.text)) return null

  const name = memberName(current)
  return storageNames.has(name) ? name : null
}

function isBrowserGlobalObject(node, expectedName) {
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

function staticString(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text
  }
  return null
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

function parseSource(source, filename = 'candidate.tsx') {
  return ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
}

function isConstVariableDeclaration(node) {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    (node.parent.flags & ts.NodeFlags.Const) !== 0
  )
}

function collectScopedStorageKeyBindings(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  const bindings = new Set()

  function visit(node) {
    if (
      isConstVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = staticString(node.initializer)
      if (value?.startsWith('supa:')) bindings.add(node.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}

function collectExportedScopedStorageKeyBindings(
  source,
  filename = 'candidate.tsx',
) {
  const sourceFile = parseSource(source, filename)
  const bindings = new Set()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if (
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      continue
    }

    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const value = staticString(declaration.initializer)
      if (value?.startsWith('supa:')) bindings.add(declaration.name.text)
    }
  }

  return bindings
}

function collectRelativeNamedImports(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  const imports = []

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      continue
    }

    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue

    for (const element of namedBindings.elements) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        importedName: element.propertyName?.text ?? element.name.text,
        localName: element.name.text,
      })
    }
  }

  return imports
}

function collectValueBindingCounts(source, filename = 'candidate.tsx') {
  const sourceFile = parseSource(source, filename)
  const counts = new Map()

  function addBinding(name) {
    if (!name) return
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      addBinding(node.name.text)
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      addBinding(node.name.text)
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      addBinding(node.name.text)
    } else if (ts.isImportSpecifier(node)) {
      addBinding(node.name.text)
    } else if (ts.isImportClause(node) && node.name) {
      addBinding(node.name.text)
    } else if (ts.isNamespaceImport(node)) {
      addBinding(node.name.text)
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node.name
    ) {
      addBinding(node.name.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return counts
}

function normalizedSourcePath(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function resolveRelativeSource(importerPath, specifier, sourcePaths) {
  const importer = normalizedSourcePath(importerPath)
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  )
  const candidates = [
    base,
    ...[...sourceExtensions].map((extension) => base + extension),
    ...[...sourceExtensions].map(
      (extension) => path.posix.join(base, 'index' + extension),
    ),
  ]

  return candidates.find((candidate) => sourcePaths.has(candidate)) ?? null
}

function buildScopedStorageKeyBindingsByFile(sources) {
  const normalizedSources = sources.map((file) => ({
    ...file,
    relativePath: normalizedSourcePath(file.relativePath),
  }))
  const sourcePaths = new Set(
    normalizedSources.map((file) => file.relativePath),
  )
  const exportedBindings = new Map(
    normalizedSources.map((file) => [
      file.relativePath,
      collectExportedScopedStorageKeyBindings(file.source, file.relativePath),
    ]),
  )
  const bindingsByFile = new Map(
    normalizedSources.map((file) => [
      file.relativePath,
      collectScopedStorageKeyBindings(file.source, file.relativePath),
    ]),
  )

  for (const file of normalizedSources) {
    const bindings = bindingsByFile.get(file.relativePath)

    for (const imported of collectRelativeNamedImports(
      file.source,
      file.relativePath,
    )) {
      const resolved = resolveRelativeSource(
        file.relativePath,
        imported.specifier,
        sourcePaths,
      )
      if (
        resolved &&
        exportedBindings.get(resolved)?.has(imported.importedName)
      ) {
        bindings.add(imported.localName)
      }
    }

    const bindingCounts = collectValueBindingCounts(
      file.source,
      file.relativePath,
    )
    for (const name of [...bindings]) {
      if (bindingCounts.get(name) !== 1) bindings.delete(name)
    }
  }

  return bindingsByFile
}

function storageKeyIsScoped(node, scopedKeyBindings) {
  const value = staticString(node)
  if (value !== null) return value.startsWith('supa:')

  const current = node ? unwrapExpression(node) : null
  return (
    current !== null &&
    ts.isIdentifier(current) &&
    scopedKeyBindings.has(current.text)
  )
}

function findUnsafeStorageAccess(
  source,
  filename = 'candidate.tsx',
  scopedKeyBindings = new Set(),
) {
  const sourceFile = parseSource(source, filename)
  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node)

      if (name === 'cookie' && isBrowserGlobalObject(node.expression, 'document')) {
        finding = {
          kind: 'document.cookie access',
          text: node.getText(sourceFile),
        }
        return
      }

      if (
        isBrowserGlobalObject(node, 'cookieStore') ||
        isBrowserGlobalObject(node.expression, 'cookieStore')
      ) {
        finding = {
          kind: 'client cookieStore access',
          text: node.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression)
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const storage = storageName(callee.expression)
        const method = memberName(callee)

        if (storage && method === 'clear') {
          finding = {
            kind: 'origin-wide storage clear',
            text: callee.getText(sourceFile),
          }
          return
        }

        if (
          storage &&
          keyedMethods.has(method) &&
          !storageKeyIsScoped(node.arguments[0], scopedKeyBindings)
        ) {
          finding = {
            kind: 'unscoped or unverifiable storage key',
            text: node.getText(sourceFile),
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

test('production browser storage stays scoped to SUPA data', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  const sources = await Promise.all(
    files.map(async (file) => ({
      ...file,
      source: await readFile(file.url, 'utf8'),
    })),
  )
  const scopedKeyBindingsByFile =
    buildScopedStorageKeyBindingsByFile(sources)

  for (const file of sources) {
    const relativePath = normalizedSourcePath(file.relativePath)
    const finding = findUnsafeStorageAccess(
      file.source,
      relativePath,
      scopedKeyBindingsByFile.get(relativePath) ?? new Set(),
    )

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains unsafe browser storage access: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('storage guard keeps scoped key trust module-bound and import-proven', () => {
  const sources = [
    {
      relativePath: 'keys.ts',
      source: "export const sharedKey = 'supa:shared:v1'",
    },
    {
      relativePath: 'consumer.ts',
      source:
        "import { sharedKey as importedKey } from './keys'\n" +
        'localStorage.getItem(importedKey)',
    },
    {
      relativePath: 'collision.ts',
      source:
        'const sharedKey = getRuntimeKey()\n' +
        'localStorage.getItem(sharedKey)',
    },
    {
      relativePath: 'private-key.ts',
      source: "const privateKey = 'supa:private:v1'",
    },
    {
      relativePath: 'private-consumer.ts',
      source:
        "import { privateKey } from './private-key'\n" +
        'localStorage.getItem(privateKey)',
    },
    {
      relativePath: 'dynamic-key.ts',
      source: 'export const dynamicKey = buildRuntimeKey()',
    },
    {
      relativePath: 'dynamic-consumer.ts',
      source:
        "import { dynamicKey } from './dynamic-key'\n" +
        'localStorage.getItem(dynamicKey)',
    },
  ]
  const bindingsByFile = buildScopedStorageKeyBindingsByFile(sources)
  const sourceByPath = new Map(
    sources.map((file) => [file.relativePath, file.source]),
  )

  assert.equal(
    findUnsafeStorageAccess(
      sourceByPath.get('consumer.ts'),
      'consumer.ts',
      bindingsByFile.get('consumer.ts'),
    ),
    null,
  )

  for (const relativePath of [
    'collision.ts',
    'private-consumer.ts',
    'dynamic-consumer.ts',
  ]) {
    assert.ok(
      findUnsafeStorageAccess(
        sourceByPath.get(relativePath),
        relativePath,
        bindingsByFile.get(relativePath),
      ),
      relativePath,
    )
  }
})

test('storage guard does not trust mutable scoped key bindings', () => {
  const sources = [
    {
      relativePath: 'mutable-local.ts',
      source:
        "let storageKey = 'supa:local:v1'\n" +
        'storageKey = getRuntimeKey()\n' +
        'localStorage.getItem(storageKey)',
    },
    {
      relativePath: 'mutable-keys.ts',
      source: "export let sharedKey = 'supa:shared:v1'",
    },
    {
      relativePath: 'mutable-consumer.ts',
      source:
        "import { sharedKey } from './mutable-keys'\n" +
        'localStorage.getItem(sharedKey)',
    },
  ]
  const bindingsByFile = buildScopedStorageKeyBindingsByFile(sources)
  const sourceByPath = new Map(
    sources.map((file) => [file.relativePath, file.source]),
  )

  for (const relativePath of ['mutable-local.ts', 'mutable-consumer.ts']) {
    assert.ok(
      findUnsafeStorageAccess(
        sourceByPath.get(relativePath),
        relativePath,
        bindingsByFile.get(relativePath),
      ),
      relativePath,
    )
  }
})

test('storage guard revokes trust when a proven key name is shadowed', () => {
  const sources = [
    {
      relativePath: 'keys.ts',
      source: "export const sharedKey = 'supa:shared:v1'",
    },
    {
      relativePath: 'local-shadow.ts',
      source:
        "const storageKey = 'supa:local:v1'\n" +
        'function read(storageKey) { return localStorage.getItem(storageKey) }',
    },
    {
      relativePath: 'import-shadow.ts',
      source:
        "import { sharedKey as importedKey } from './keys'\n" +
        'function read(importedKey) { return localStorage.getItem(importedKey) }',
    },
    {
      relativePath: 'safe-import.ts',
      source:
        "import { sharedKey as importedKey } from './keys'\n" +
        'localStorage.getItem(importedKey)',
    },
  ]
  const bindingsByFile = buildScopedStorageKeyBindingsByFile(sources)
  const sourceByPath = new Map(
    sources.map((file) => [file.relativePath, file.source]),
  )

  for (const relativePath of ['local-shadow.ts', 'import-shadow.ts']) {
    assert.ok(
      findUnsafeStorageAccess(
        sourceByPath.get(relativePath),
        relativePath,
        bindingsByFile.get(relativePath),
      ),
      relativePath,
    )
  }

  assert.equal(
    findUnsafeStorageAccess(
      sourceByPath.get('safe-import.ts'),
      'safe-import.ts',
      bindingsByFile.get('safe-import.ts'),
    ),
    null,
  )
})

test('storage guard rejects origin-wide clears and unscoped or unverifiable keys', () => {
  for (const source of [
    'localStorage.clear()',
    "window['localStorage']['clear']()",
    'globalThis.sessionStorage.clear()',
    "localStorage.setItem('planner', '{}')",
    'window.localStorage.getItem("shopping-list")',
    "self['sessionStorage'].removeItem(`draft`)",
    'localStorage.setItem(storageKey, payload)',
    'window.localStorage.getItem(buildStorageKey())',
    "document.cookie = 'session=unsafe'",
    "const raw = window['document'].cookie",
    "cookieStore.set('session', 'unsafe')",
    "window.cookieStore.get('session')",
    "globalThis['cookieStore']['delete']('session')",
  ]) {
    const bindings = collectScopedStorageKeyBindings(source)
    assert.ok(findUnsafeStorageAccess(source, 'candidate.tsx', bindings), source)
  }
})

test('storage guard permits proven SUPA keys and unrelated storage objects', () => {
  for (const source of [
    "localStorage.setItem('supa:planner-preferences:v2', '{}')",
    "window.localStorage.getItem('supa:shopping-list:v1')",
    "sessionStorage.removeItem('supa:temporary:v1')",
    "const storageKey = 'supa:planner:v1'; localStorage.setItem(storageKey, payload)",
    "const storageKey = 'supa:list:v1'; window.localStorage.getItem(storageKey)",
    'cache.clear()',
    "storage.setItem('planner', '{}')",
    "jar.cookie = 'local-only'",
    "const cookie = 'local label'",
    "cookies.set('session', 'local-only')",
    "jar.cookieStore.get('session')",
    "// document.cookie = 'example=1'",
    "// localStorage.clear()",
    "const example = \"localStorage.setItem('planner', '{}')\"",
  ]) {
    const bindings = collectScopedStorageKeyBindings(source)
    assert.equal(
      findUnsafeStorageAccess(source, 'candidate.tsx', bindings),
      null,
      source,
    )
  }
})
