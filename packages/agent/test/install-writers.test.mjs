import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseTarget,
  getWriter,
  resolveDefaultInputs,
  redactEntry,
} from '../dist/install/index.js';
import { parseSecretRef, DEFAULT_SECRET_REF } from '../dist/secrets/index.js';

describe('parseTarget', () => {
  it('parses claude-code:user', () => {
    const t = parseTarget('claude-code:user');
    assert.equal(t.client, 'claude-code');
    assert.equal(t.location, 'user');
  });

  it('parses file:./path', () => {
    const t = parseTarget('file:./mcp.json');
    assert.equal(t.client, 'file');
    assert.equal(t.location, './mcp.json');
  });

  it('rejects unknown clients', () => {
    assert.throws(() => parseTarget('hypeclient:user'));
  });

  it('rejects missing location', () => {
    assert.throws(() => parseTarget('claude-code:'));
  });
});

describe('claude-code writer', () => {
  it('writes user-scope entry to a fake home', () => {
    const home = mkdtempSync(join(tmpdir(), 'tcc-'));
    const claudeJson = join(home, '.claude.json');
    try {
      const target = parseTarget('claude-code:user');
      const writer = getWriter(target);
      const input = resolveDefaultInputs(target, {
        secretRef: DEFAULT_SECRET_REF,
      });
      const plan = writer.plan(input);
      assert.ok(plan.entry.command === 'npx');
      assert.ok(plan.entry.args.includes('--package'));
      const pkgArg = plan.entry.args[plan.entry.args.indexOf('--package') + 1];
      assert.match(pkgArg, /^@traseq\/agent@\^\d+\.\d+\.\d+$/);
      assert.ok(
        !plan.entry.args.some((arg) => arg.startsWith('--profile=')),
        'default hybrid profile should not be written explicitly',
      );
      assert.equal(
        plan.entry.env.TRASEQ_API_KEY_REF,
        'keychain:traseq/api-key',
      );
      assert.equal(plan.entry.env.TRASEQ_API_KEY, undefined);
      assert.equal(plan.entry.env.TRASEQ_BASE_URL, undefined);
    } finally {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
      if (existsSync(claudeJson)) rmSync(claudeJson, { force: true });
    }
  });

  it('writes explicit non-default profile flags', () => {
    const target = parseTarget('claude-code:user');
    const writer = getWriter(target);
    const input = resolveDefaultInputs(target, {
      secretRef: DEFAULT_SECRET_REF,
      profile: 'authoring',
    });
    const plan = writer.plan(input);
    assert.ok(plan.entry.args.includes('--profile=authoring'));
  });

  it('throws on inlined project secrets without acknowledgement', () => {
    const target = parseTarget('claude-code:project');
    const writer = getWriter(target);
    const input = resolveDefaultInputs(target, {
      secretRef: DEFAULT_SECRET_REF,
      inline: 'trsq_live_test',
    });
    assert.throws(() => writer.plan(input), /i-know-this-is-shared/);
  });
});

describe('redactEntry', () => {
  it('replaces inlined keys with <redacted>', () => {
    const entry = {
      command: 'npx',
      args: ['-y', '--package', '@traseq/agent@^0.11.0', 'traseq-agent', 'mcp'],
      env: {
        TRASEQ_API_KEY: 'trsq_live_secret_value',
      },
    };
    const redacted = redactEntry(entry);
    assert.equal(redacted.env.TRASEQ_API_KEY, '<redacted>');
    assert.equal(redacted.env.TRASEQ_BASE_URL, undefined);
    assert.deepEqual(redacted.args, entry.args);
  });

  it('does not touch reference-form env', () => {
    const entry = {
      command: 'npx',
      args: [],
      env: { TRASEQ_API_KEY_REF: 'keychain:traseq/api-key' },
    };
    const redacted = redactEntry(entry);
    assert.equal(redacted.env.TRASEQ_API_KEY_REF, 'keychain:traseq/api-key');
  });
});

describe('parseSecretRef integration with install input', () => {
  it('round-trips through resolveDefaultInputs', () => {
    const ref = parseSecretRef('env:MY_KEY');
    const target = parseTarget('file:./mcp.json');
    const input = resolveDefaultInputs(target, { secretRef: ref });
    assert.equal(input.secretRef.kind, 'env');
  });
});
