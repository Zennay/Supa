import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function validateLockfile(value, pkg) {
  const errors = [];
  if (value.lockfileVersion !== 3 || value.requires !== true) errors.push('npm v3 lockfile required');
  if (!value.packages || typeof value.packages !== 'object') return [...errors, 'packages missing'];
  const root = value.packages[''];
  if (!root || root.name !== pkg.name || root.version !== pkg.version) errors.push('root identity mismatch');
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (JSON.stringify(root?.[section] ?? {}) !== JSON.stringify(pkg[section] ?? {})) errors.push(`root ${section} differs from manifest`);
  }
  const entries = Object.entries(value.packages).filter(([path]) => path !== '');
  if (entries.length === 0) errors.push('empty dependency graph');
  for (const [path, dependency] of entries) {
    if (!path.startsWith('node_modules/') || !dependency || typeof dependency !== 'object') {
      errors.push(`invalid dependency entry: ${path}`);
      continue;
    }
    const resolved = dependency.resolved;
    if (typeof resolved !== 'string' || !/^https:\/\/registry\.npmjs\.org\//.test(resolved)) {
      errors.push(`non-registry source: ${path}`);
    }
    if (typeof dependency.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dependency.integrity) || Buffer.from(dependency.integrity.slice(7), 'base64').length !== 64) {
      errors.push(`missing sha512 integrity: ${path}`);
    }
  }
  return errors;
}

test('committed npm lockfile pins registry tarballs and cryptographic integrity', () => {
  assert.deepEqual(validateLockfile(lock, manifest), []);
});

test('reject tampered registry URL, weakened integrity and manifest drift', () => {
  const fixture = {lockfileVersion: 3, requires: true, packages: {
    '': {name: 'demo', version: '1.0.0', dependencies: {react: '^19.0.0'}},
    'node_modules/react': {version: '19.0.0', resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz', integrity: `sha512-${Buffer.alloc(64, 42).toString('base64')}`},
  }};
  const pkg = {name: 'demo', version: '1.0.0', dependencies: {react: '^19.0.0'}};
  assert.deepEqual(validateLockfile(fixture, pkg), []);
  const copy = () => structuredClone(fixture);
  const outside = copy(); outside.packages['node_modules/react'].resolved = 'https://example.com/react.tgz';
  assert.match(validateLockfile(outside, pkg).join(' '), /non-registry source/);
  const shortHash = copy(); shortHash.packages['node_modules/react'].integrity = 'sha512-YWJjZA==';
  assert.match(validateLockfile(shortHash, pkg).join(' '), /missing sha512 integrity/);
  const weak = copy(); weak.packages['node_modules/react'].integrity = 'sha1-YWJjZA==';
  assert.match(validateLockfile(weak, pkg).join(' '), /missing sha512 integrity/);
  assert.match(validateLockfile(fixture, {...pkg, dependencies: {react: '^18.0.0'}}).join(' '), /differs from manifest/);
  assert.match(validateLockfile({...fixture, packages: {'': fixture.packages['']}}, pkg).join(' '), /empty dependency graph/);
});
