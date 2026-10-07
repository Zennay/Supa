import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [packageJson, packageLock] = await Promise.all([
  readFile('package.json', 'utf8').then(JSON.parse),
  readFile('package-lock.json', 'utf8').then(JSON.parse),
])

test('package lock root mirrors the declared dependency contract', () => {
  assert.equal(packageLock.lockfileVersion, 3)
  assert.equal(packageLock.requires, true)

  const root = packageLock.packages?.['']
  assert.ok(root, 'package-lock.json must contain the root package entry')
  assert.equal(root.name, packageJson.name)
  assert.equal(root.version, packageJson.version)
  assert.deepEqual(root.dependencies ?? {}, packageJson.dependencies ?? {})
  assert.deepEqual(root.devDependencies ?? {}, packageJson.devDependencies ?? {})
})

test('locked packages stay registry-backed and integrity-pinned', () => {
  const violations = []

  for (const [location, entry] of Object.entries(packageLock.packages ?? {})) {
    if (!location.startsWith('node_modules/')) {
      continue
    }

    if (!entry || typeof entry !== 'object') {
      violations.push(`${location}: package metadata is not an object`)
      continue
    }

    if (entry.link === true) {
      violations.push(`${location}: linked/path package is not allowed`)
      continue
    }

    if (
      typeof entry.resolved !== 'string' ||
      !entry.resolved.startsWith('https://registry.npmjs.org/')
    ) {
      violations.push(
        `${location}: resolved source must be an HTTPS npm registry tarball`,
      )
    }

    if (
      typeof entry.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
    ) {
      violations.push(`${location}: missing or non-SHA-512 integrity metadata`)
    }
  }

  assert.deepEqual(violations, [])
})

test('dependency install-script surface stays explicitly bounded', () => {
  const installScriptPackages = Object.entries(packageLock.packages ?? {})
    .filter(
      ([location, entry]) =>
        location.startsWith('node_modules/') &&
        entry &&
        typeof entry === 'object' &&
        entry.hasInstallScript === true,
    )
    .map(([location]) => location.slice('node_modules/'.length))
    .sort()

  assert.deepEqual(installScriptPackages, ['esbuild', 'fsevents'])
})

test('root package does not execute install-time lifecycle hooks', () => {
  const installLifecycleHooks = [
    'preinstall',
    'install',
    'postinstall',
    'prepublish',
    'preprepare',
    'prepare',
    'postprepare',
  ]

  const presentHooks = installLifecycleHooks.filter((hook) =>
    Object.hasOwn(packageJson.scripts ?? {}, hook),
  )

  assert.deepEqual(presentHooks, [])
})
