/**
 * Regression test: verifies that the repository exposes a SECURITY.md
 * defining responsible security-reporting and authorized-testing boundaries,
 * without depending on workflow, product, or evidence code.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('Security reporting boundary', () => {
  const securityMdPath = join(REPO_ROOT, 'SECURITY.md');
  const content = readFileSync(securityMdPath, 'utf8');

  it('must exist at repository root', () => {
    assert.ok(existsSync(securityMdPath), 'SECURITY.md should be present at the repository root');
  });

  it('should reference GitHub private vulnerability reporting / security advisories', () => {
    const lower = content.toLowerCase();
    assert.ok(
      lower.includes('security/advisories') || lower.includes('private vulnerability reporting'),
      'SECURITY.md must describe GitHub private advisory / private vulnerability reporting usage'
    );
  });

  it('should request minimal reproducible impact without credentials or personal data', () => {
    const lower = content.toLowerCase();
    assert.ok(
      /credential|personal data|pi.i|token|secret/.test(lower),
      'SECURITY.md should mention avoiding credentials, personal data, tokens, or secrets in reports'
    );
    assert.ok(
      /reproduc|minimal|step/i.test(lower),
      'SECURITY.md should request minimal reproduction / context'
    );
  });

  it('should explicitly forbid unauthorized testing of third-party retailers or external systems', () => {
    const lower = content.toLowerCase();
    assert.ok(
      /third.party|external system|retailer/i.test(lower),
      'SECURITY.md should reference third-party retailers / external systems'
    );
    assert.ok(
      /not grant|no permission|without explicit authoriz|actively test|do not.*test/i.test(lower),
      'SECURITY.md must state that active testing of third-party systems requires authorization'
    );
  });

  it('should not claim a response SLA or bounty/reward', () => {
    const lower = content.toLowerCase();
    assert.ok(
      !/guarantee.*sl.a|promise.*response|bounty|reward/.test(lower),
      'SECURITY.md must not claim an SLA guarantee or offer bounties/rewards'
    );
  });
});
