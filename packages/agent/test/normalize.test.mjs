import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDraft,
  normalizeBacktest,
  normalizeValidation,
  normalizeChange,
  isJsonObject,
  asString,
  asNumber,
  asStringArray,
  parseJsonObject,
} from '../dist/normalize.js';

describe('isJsonObject', () => {
  it('returns true for plain objects', () => {
    assert.ok(isJsonObject({}));
    assert.ok(isJsonObject({ a: 1 }));
  });

  it('returns false for non-objects', () => {
    assert.ok(!isJsonObject(null));
    assert.ok(!isJsonObject(undefined));
    assert.ok(!isJsonObject(42));
    assert.ok(!isJsonObject('str'));
    assert.ok(!isJsonObject([1, 2]));
  });
});

describe('asString', () => {
  it('returns trimmed string', () => {
    assert.equal(asString('  hello  '), 'hello');
  });

  it('returns fallback for non-string', () => {
    assert.equal(asString(42, 'fb'), 'fb');
    assert.equal(asString(null, 'fb'), 'fb');
    assert.equal(asString('', 'fb'), 'fb');
    assert.equal(asString('   ', 'fb'), 'fb');
  });
});

describe('asNumber', () => {
  it('returns finite numbers', () => {
    assert.equal(asNumber(42), 42);
    assert.equal(asNumber(0), 0);
    assert.equal(asNumber(-3.14), -3.14);
  });

  it('returns undefined for non-finite', () => {
    assert.equal(asNumber(NaN), undefined);
    assert.equal(asNumber(Infinity), undefined);
    assert.equal(asNumber('42'), undefined);
    assert.equal(asNumber(null), undefined);
  });
});

describe('asStringArray', () => {
  it('extracts string elements', () => {
    const result = asStringArray(['a', 'b', 'c']);
    assert.deepEqual(result, ['a', 'b', 'c']);
  });

  it('limits and filters', () => {
    const result = asStringArray(['a', '', 'b', '  ', 'c', 'd', 'e'], 3);
    assert.equal(result.length, 3);
  });

  it('returns empty for non-array', () => {
    assert.deepEqual(asStringArray(null), []);
    assert.deepEqual(asStringArray('str'), []);
  });
});

describe('parseJsonObject', () => {
  it('parses valid JSON', () => {
    const result = parseJsonObject('{"a": 1}');
    assert.deepEqual(result, { a: 1 });
  });

  it('extracts JSON from surrounding text', () => {
    const result = parseJsonObject('some text {"a": 1} more text');
    assert.deepEqual(result, { a: 1 });
  });

  it('throws for non-object JSON', () => {
    assert.throws(() => parseJsonObject('"str"'));
  });

  it('throws for no JSON', () => {
    assert.throws(() => parseJsonObject('no json here'));
  });
});

describe('normalizeDraft', () => {
  it('normalizes a valid draft', () => {
    const draft = normalizeDraft({
      name: 'Test',
      description: 'A test strategy',
      signalGraph: { nodes: [] },
      settings: { warmupPeriod: 100 },
      backtest: {
        timeframe: '4h',
        signalInstrument: { symbol: 'BTCUSDT' },
      },
    });

    assert.equal(draft.name, 'Test');
    assert.equal(draft.description, 'A test strategy');
    assert.deepEqual(draft.signalGraph, { nodes: [] });
    assert.equal(draft.settings.warmupPeriod, 100);
    assert.equal(draft.backtest.timeframe, '4h');
  });

  it('provides defaults for missing fields', () => {
    const draft = normalizeDraft({});
    assert.equal(draft.name, 'Untitled strategy');
    assert.deepEqual(draft.signalGraph, {});
    assert.deepEqual(draft.settings, { positionStyle: 'single' });
  });

  it('handles null/undefined input', () => {
    const draft = normalizeDraft(null);
    assert.equal(draft.name, 'Untitled strategy');
  });
});

describe('normalizeValidation', () => {
  it('normalizes a valid validation result', () => {
    const result = normalizeValidation({
      valid: true,
      summary: { errors: 0, warnings: 1 },
      issues: {
        tokens: [{ message: 'test warning', severity: 'warning' }],
        settings: [],
        conflicts: [],
      },
    });

    assert.equal(result.valid, true);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.warnings, 1);
    assert.equal(result.issues.tokens.length, 1);
    assert.equal(result.issues.tokens[0].message, 'test warning');
    assert.equal(result.issues.tokens[0].severity, 'warning');
  });

  it('handles empty/null input', () => {
    const result = normalizeValidation(null);
    assert.equal(result.valid, false);
    assert.equal(result.summary.errors, 0);
  });
});

describe('normalizeBacktest', () => {
  it('normalizes a backtest result', () => {
    const result = normalizeBacktest({
      id: 'bt-123',
      status: 'completed',
      summaryJson: { returnPct: 0.15 },
    });

    assert.equal(result.id, 'bt-123');
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.summary, { returnPct: 0.15 });
  });

  it('handles nested result structure', () => {
    const result = normalizeBacktest({
      id: 'bt-456',
      status: 'completed',
      result: {
        summaryJson: { returnPct: 0.1 },
        artifactUrls: { equity: 'https://example.com/equity.png' },
      },
    });

    assert.deepEqual(result.summary, { returnPct: 0.1 });
    assert.deepEqual(result.artifactUrls, {
      equity: 'https://example.com/equity.png',
    });
  });

  it('handles null/undefined input', () => {
    const result = normalizeBacktest(null);
    assert.equal(result.id, 'unknown-backtest');
    assert.equal(result.status, 'unknown');
  });
});

describe('normalizeChange', () => {
  it('normalizes a valid change', () => {
    const change = normalizeChange(
      {
        category: 'entry',
        title: 'Add RSI filter',
        before: 'No RSI filter',
        after: 'RSI < 30',
        reason: 'Avoid overbought entries',
        expectedImpact: 'Better win rate',
      },
      0,
    );

    assert.ok(change !== null);
    assert.equal(change.category, 'entry');
    assert.equal(change.title, 'Add RSI filter');
  });

  it('returns null for non-object', () => {
    assert.equal(normalizeChange(null, 0), null);
    assert.equal(normalizeChange('str', 0), null);
  });

  it('defaults unknown category to other', () => {
    const change = normalizeChange(
      {
        category: 'unknown',
        title: 'Test',
        reason: 'Test reason',
      },
      0,
    );

    assert.ok(change !== null);
    assert.equal(change.category, 'other');
  });
});
