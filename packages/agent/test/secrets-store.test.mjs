import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSecretRef,
  formatSecretRef,
  DEFAULT_SECRET_REF,
  EnvSecretStore,
} from '../dist/secrets/index.js';

describe('parseSecretRef', () => {
  it('parses keychain references', () => {
    const ref = parseSecretRef('keychain:traseq/api-key');
    assert.deepEqual(ref, {
      kind: 'keychain',
      service: 'traseq',
      account: 'api-key',
    });
  });

  it('parses env references', () => {
    const ref = parseSecretRef('env:MY_KEY');
    assert.deepEqual(ref, { kind: 'env', name: 'MY_KEY' });
  });

  it('parses inline references', () => {
    const ref = parseSecretRef('inline:abc123');
    assert.deepEqual(ref, { kind: 'inline', value: 'abc123' });
  });

  it('rejects malformed keychain refs', () => {
    assert.throws(() => parseSecretRef('keychain:traseq'));
    assert.throws(() => parseSecretRef('keychain:/account'));
  });

  it('rejects unknown schemes', () => {
    assert.throws(() => parseSecretRef('vault:traseq/api-key'));
  });
});

describe('formatSecretRef', () => {
  it('round-trips keychain refs', () => {
    assert.equal(
      formatSecretRef(DEFAULT_SECRET_REF),
      'keychain:traseq/api-key',
    );
  });

  it('redacts inline values', () => {
    assert.equal(
      formatSecretRef({ kind: 'inline', value: 'super-secret' }),
      'inline:<redacted>',
    );
  });
});

describe('EnvSecretStore', () => {
  it('reads env vars constructed from service+account', async () => {
    process.env.TRASEQ_API_KEY = 'env-stored';
    const store = new EnvSecretStore();
    const value = await store.get('traseq', 'api-key');
    assert.equal(value, 'env-stored');
    delete process.env.TRASEQ_API_KEY;
  });

  it('refuses writes', async () => {
    const store = new EnvSecretStore();
    await assert.rejects(() => store.set('s', 'a', 'v'));
  });
});
