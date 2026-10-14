import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function assertNotPublishable(packageJson) {
  assert.equal(packageJson?.private, true, 'root package must remain private to prevent accidental npm publication');
  assert.equal(Object.hasOwn(packageJson, 'publishConfig'), false, 'root package must not configure npm publication');
}

test('root Supa package is explicitly private and has no publish configuration', () => {
  assertNotPublishable(manifest);
});

test('publishing protection fails closed if private is omitted or false', () => {
  for (const privateValue of [undefined, false, 'true', null, 1]) {
    const candidate = { ...manifest };
    if (privateValue === undefined) delete candidate.private;
    else candidate.private = privateValue;
    assert.throws(() => assertNotPublishable(candidate));
  }
});

test('publishing protection rejects injected publishConfig while allowing regular scripts', () => {
  assert.throws(() => assertNotPublishable({
    ...manifest,
    publishConfig: { registry: 'https://registry.npmjs.org/' },
  }));
  assert.doesNotThrow(() => assertNotPublishable({
    ...manifest,
    scripts: { ...manifest.scripts, 'm3:assess-observed-week': 'node scripts/m3-assess-observed-week.mjs' },
  }));
});
