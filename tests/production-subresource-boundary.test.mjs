import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const resourceAttributes = new Map([
  ['audio', new Set(['src'])],
  ['image', new Set(['href', 'xlinkHref'])],
  ['img', new Set(['src', 'srcSet'])],
  ['link', new Set(['href'])],
  ['script', new Set(['src'])],
  ['source', new Set(['src', 'srcSet'])],
  ['track', new Set(['src'])],
  ['use', new Set(['href', 'xlinkHref'])],
  ['video', new Set(['poster', 'src'])],
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

function staticString(node) {
  if (!node) return null
  const current = unwrapExpression(node)
  if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text
  }
  return null
}

function isReactModuleSpecifier(node) {
  return ts.isStringLiteralLike(node) && node.text === 'react'
}

function bindingIdentifierNames(name, names = []) {
  if (!name) return names

  if (ts.isIdentifier(name)) {
    names.push(name.text)
    return names
  }

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        bindingIdentifierNames(element.name, names)
      }
    }
  }

  return names
}

function nearestBindingScope(node, blockScoped = true) {
  let current = node.parent

  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isFunctionLike(current) ||
      (blockScoped && (
        ts.isBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isCatchClause(current)
      ))
    ) {
      return current
    }

    current = current.parent
  }

  return null
}

function setBindingKind(bindings, scope, name, kind) {
  if (!scope || !name) return false

  const byScope = bindings.get(name) ?? new Map()
  const previous = byScope.get(scope)
  if (previous === kind) return false

  byScope.set(scope, kind)
  bindings.set(name, byScope)
  return true
}

function registerBindingName(bindings, scope, name, kind) {
  let changed = false
  for (const identifier of bindingIdentifierNames(name)) {
    changed = setBindingKind(bindings, scope, identifier, kind) || changed
  }
  return changed
}

function bindingKindAt(node, name, bindings) {
  let current = node.parent

  while (current) {
    const kind = bindings.get(name)?.get(current)
    if (kind) return kind
    current = current.parent
  }

  return name === 'React' ? 'react-namespace' : null
}

function isReactCreateElement(node, bindings) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return bindingKindAt(current, current.text, bindings) === 'react-callable'
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    bindingKindAt(base, base.text, bindings) === 'react-namespace' &&
    memberName(current) === 'createElement'
  )
}

function collectReactCreateElementBindings(sourceFile) {
  const bindings = new Map()
  const constDeclarations = []

  function collect(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const reactImport = isReactModuleSpecifier(node.moduleSpecifier)

      if (clause?.name) {
        setBindingKind(
          bindings,
          sourceFile,
          clause.name.text,
          reactImport ? 'react-namespace' : 'local',
        )
      }

      const namedBindings = clause?.namedBindings
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        setBindingKind(
          bindings,
          sourceFile,
          namedBindings.name.text,
          reactImport ? 'react-namespace' : 'local',
        )
      } else if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const sourceName = element.propertyName?.text ?? element.name.text
          setBindingKind(
            bindings,
            sourceFile,
            element.name.text,
            reactImport && sourceName === 'createElement'
              ? 'react-callable'
              : 'local',
          )
        }
      }
    }

    if (ts.isParameter(node)) {
      registerBindingName(
        bindings,
        nearestBindingScope(node, false),
        node.name,
        'local',
      )
    }

    if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const declarationList = node.parent
      const blockScoped = ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
      const scope = nearestBindingScope(node, blockScoped)

      registerBindingName(bindings, scope, node.name, 'local')

      if (
        node.initializer &&
        ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.Const) !== 0
      ) {
        constDeclarations.push({ node, scope })
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    ) {
      setBindingKind(
        bindings,
        nearestBindingScope(node, true),
        node.name.text,
        'local',
      )
    }

    if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name
    ) {
      setBindingKind(bindings, node, node.name.text, 'local')
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      registerBindingName(bindings, node, node.variableDeclaration.name, 'local')
    }

    ts.forEachChild(node, collect)
  }

  collect(sourceFile)

  let changed = true
  while (changed) {
    changed = false

    for (const { node, scope } of constDeclarations) {
      const initializer = unwrapExpression(node.initializer)

      if (ts.isIdentifier(node.name)) {
        let kind = null

        if (isReactCreateElement(initializer, bindings)) {
          kind = 'react-callable'
        } else if (ts.isIdentifier(initializer)) {
          const initializerKind = bindingKindAt(
            initializer,
            initializer.text,
            bindings,
          )
          if (initializerKind === 'react-callable') {
            kind = 'react-callable'
          } else if (initializerKind === 'react-namespace') {
            kind = 'react-namespace'
          }
        }

        if (kind) {
          changed = setBindingKind(bindings, scope, node.name.text, kind) || changed
        }
      }

      if (
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(initializer) &&
        bindingKindAt(initializer, initializer.text, bindings) === 'react-namespace'
      ) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const sourceName = staticName(element.propertyName) ?? element.name.text
          if (sourceName === 'createElement') {
            changed = setBindingKind(
              bindings,
              scope,
              element.name.text,
              'react-callable',
            ) || changed
          }
        }
      }
    }
  }

  return bindings
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

function jsxAttributeNames(node) {
  const names = new Set()
  let hasSpread = false

  for (const property of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      hasSpread = true
      continue
    }

    if (ts.isJsxAttribute(property)) {
      names.add(property.name.getText())
    }
  }

  return { names, hasSpread }
}

function resourceBearingJsxElement(node, sourceFile) {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
    return null
  }

  const tag = node.tagName.getText(sourceFile)
  const watchedAttributes = resourceAttributes.get(tag)
  if (!watchedAttributes) return null

  const { names, hasSpread } = jsxAttributeNames(node)
  if (hasSpread) {
    return {
      kind: 'resource element with spread attributes',
      text: '<' + tag + ' {...}>',
    }
  }

  for (const name of watchedAttributes) {
    if (names.has(name)) {
      return {
        kind: tag + '.' + name + ' browser subresource',
        text: '<' + tag + ' ' + name + '=...>',
      }
    }
  }

  return null
}

function findBrowserSubresource(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  const reactBindings = collectReactCreateElementBindings(sourceFile)
  let finding = null

  function visit(node) {
    if (finding) return

    const jsxFinding = resourceBearingJsxElement(node, sourceFile)
    if (jsxFinding) {
      finding = jsxFinding
      return
    }

    if (
      ts.isCallExpression(node) &&
      isReactCreateElement(node.expression, reactBindings)
    ) {
      const tag = staticString(node.arguments[0])
      if (tag !== null && resourceAttributes.has(tag)) {
        finding = {
          kind: 'React.createElement browser subresource element',
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

test('production source has no unreviewed browser subresource elements', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findBrowserSubresource(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains an unreviewed browser subresource: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('subresource boundary catches intrinsic browser resource loads', () => {
  for (const source of [
    'const view = <img src={url} alt="" />',
    'const view = <img srcSet={srcSet} alt="" />',
    'const view = <link rel="stylesheet" href={url} />',
    'const view = <script src={url}></script>',
    'const view = <script {...props}></script>',
    'const view = <video poster={posterUrl} />',
    'const view = <audio src={url} />',
    'const view = <source srcSet={srcSet} />',
    'const view = <track src={url} />',
    'const view = <image href={url} />',
    'const view = <use xlinkHref={url} />',
    'const view = <img {...props} />',
    "React.createElement('img', { src: url })",
    "React.createElement('link', props)",
    "React.createElement('script', { src: url })",
    "import Runtime from 'react'; Runtime.createElement('img', { src: url })",
    "import * as ReactApi from 'react'; ReactApi.createElement('script', { src: url })",
    "import { createElement as h } from 'react'; h('img', { src: url })",
    "const h = React.createElement; h('script', { src: url })",
    "const { createElement: h } = React; h('img', { src: url })",
    "const h = React.createElement; const render = h; render('script', { src: url })",
  ]) {
    assert.ok(findBrowserSubresource(source), source)
  }
})

test('subresource boundary respects lexical shadowing of React aliases', () => {
  for (const source of [
    "import { createElement as h } from 'react'; function local(h) { h('img', { src: url }) }",
    "import * as ReactApi from 'react'; function local(ReactApi) { ReactApi.createElement('img', { src: url }) }",
    "import React from 'react'; function local(React) { React.createElement('img', { src: url }) }",
    "const h = React.createElement; { const h = elementFactory.createElement; h('img', { src: url }) }",
    "const { createElement: h } = React; function local(h) { h('img', { src: url }) }",
    "try {} catch (React) { React.createElement('img', { src: url }) }",
  ]) {
    assert.equal(findBrowserSubresource(source), null, source)
  }
})

test('subresource boundary resumes React aliases outside a shadowing scope', () => {
  for (const source of [
    "import { createElement as h } from 'react'; function local(h) { h('div') } h('img', { src: url })",
    "import React from 'react'; { const React = elementFactory; React.createElement('div') } React.createElement('img', { src: url })",
    "const h = React.createElement; { const h = elementFactory.createElement; h('div') } h('script', { src: url })",
  ]) {
    assert.ok(findBrowserSubresource(source), source)
  }
})

test('subresource boundary preserves non-loading markup and React components', () => {
  for (const source of [
    'const view = <img alt="placeholder" />',
    'const view = <video controls />',
    'const view = <link rel="canonical" />',
    'const view = <script>const message = "inline example"</script>',
    'const view = <Script src={url} />',
    'const view = <Image src={url} />',
    'const view = <Source src={url} />',
    'const view = <div data-src={url} />',
    'const example = "<img src=/example.png>"',
    '// const view = <img src={url} />',
    'elementFactory.img({ src: url })',
    "import { createElement as h } from './factory.js'; h('img', { src: url })",
    "const h = elementFactory.createElement; h('img', { src: url })",
    "const h = React.createElement; h('div', { 'data-src': url })",
  ]) {
    assert.equal(findBrowserSubresource(source), null, source)
  }
})
