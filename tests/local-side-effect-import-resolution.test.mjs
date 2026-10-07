import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const executableExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const resolutionExtensions = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.json']
const sideEffectImportPattern =
  /^\s*import\s+(['"])(\.[^'"\n]+)\1\s*;?\s*$/gm

async function collectExecutableFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectExecutableFiles(absolutePath)))
      continue
    }

    if (entry.isFile() && executableExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

function extractRelativeSideEffectImports(source) {
  return [...source.matchAll(sideEffectImportPattern)].map((match) => match[2])
}

function candidatePaths(importerPath, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0]
  const base = path.resolve(path.dirname(importerPath), cleanSpecifier)

  if (path.extname(cleanSpecifier)) {
    return [base]
  }

  return [
    base,
    ...resolutionExtensions.map((extension) => base + extension),
    ...resolutionExtensions.map((extension) => path.join(base, 'index' + extension)),
  ]
}

async function resolvesToFile(importerPath, specifier) {
  for (const candidate of candidatePaths(importerPath, specifier)) {
    try {
      if ((await stat(candidate)).isFile()) {
        return true
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        throw error
      }
    }
  }

  return false
}

test('extractor selects relative side-effect imports without binding imports', () => {
  const source = [
    "import './styles.css'",
    '  import "../setup" ;',
    "import { value } from './bound'",
    "import type { Thing } from './types'",
    "import 'external-package'",
  ].join('\n')

  assert.deepEqual(extractRelativeSideEffectImports(source), [
    './styles.css',
    '../setup',
  ])
})

test('every relative source side-effect import resolves to a real file', async () => {
  const files = (await collectExecutableFiles(sourceRoot)).sort()
  assert.ok(files.length > 0, 'expected executable source files under src/')

  for (const file of files) {
    const source = await readFile(file, 'utf8')

    for (const specifier of extractRelativeSideEffectImports(source)) {
      assert.equal(
        await resolvesToFile(file, specifier),
        true,
        `${path.relative(sourceRoot, file)} has unresolved side-effect import ${specifier}`,
      )
    }
  }
})
