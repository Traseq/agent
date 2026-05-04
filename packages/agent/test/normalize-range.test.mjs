import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxIndicatorPeriod,
  resolveBacktestRangeInPlace,
  resolveRangePoint,
} from '../dist/normalize.js';

const REFERENCE_MS = Date.UTC(2026, 0, 1); // 2026-01-01

describe('resolveRangePoint', () => {
  it('passes through 13-digit epoch milliseconds unchanged', () => {
    const result = resolveRangePoint(1704067200000, {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.resolved, 1704067200000);
    assert.equal(result.changed, false);
  });

  it('scales 10-digit epoch seconds into milliseconds', () => {
    const result = resolveRangePoint(1704067200, { referenceMs: REFERENCE_MS });
    assert.equal(result.resolved, 1704067200000);
    assert.equal(result.changed, true);
  });

  it('parses ISO date strings to epoch ms (UTC)', () => {
    const result = resolveRangePoint('2024-01-01', {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.resolved, Date.UTC(2024, 0, 1));
    assert.equal(result.changed, true);
  });

  it('parses ISO date-times with explicit Z as UTC epoch ms', () => {
    const result = resolveRangePoint('2024-01-01T12:00:00Z', {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.resolved, Date.UTC(2024, 0, 1, 12, 0));
    assert.equal(result.changed, true);
  });

  it('preserves "now" and "inception" as symbolic tokens (lowercased)', () => {
    const now = resolveRangePoint('NOW', { referenceMs: REFERENCE_MS });
    assert.equal(now.resolved, 'now');
    const inception = resolveRangePoint('Inception', {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(inception.resolved, 'inception');
  });

  it('resolves "ytd" to Jan 1 UTC of the reference year', () => {
    const result = resolveRangePoint('ytd', { referenceMs: REFERENCE_MS });
    assert.equal(result.resolved, REFERENCE_MS);
    assert.equal(result.changed, true);
  });

  it('resolves relative durations relative to reference (subtracting backwards)', () => {
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    const result = resolveRangePoint('1y', { referenceMs: REFERENCE_MS });
    assert.equal(result.resolved, REFERENCE_MS - yearMs);
    assert.equal(result.changed, true);
  });

  it('returns undefined for null / undefined / empty string', () => {
    assert.equal(
      resolveRangePoint(undefined, { referenceMs: REFERENCE_MS }).resolved,
      undefined,
    );
    assert.equal(
      resolveRangePoint(null, { referenceMs: REFERENCE_MS }).resolved,
      undefined,
    );
    assert.equal(
      resolveRangePoint('', { referenceMs: REFERENCE_MS }).resolved,
      undefined,
    );
  });

  it('returns the original string when nothing recognizable matches', () => {
    const result = resolveRangePoint('the moon', {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.resolved, 'the moon');
    assert.equal(result.changed, false);
  });
});

describe('resolveBacktestRangeInPlace', () => {
  it('mutates the config range and returns audit patches', () => {
    const config = {
      timeframe: '4h',
      range: { start: '2024-01-01', end: 'now' },
    };
    const result = resolveBacktestRangeInPlace(config, {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.changed, true);
    // ISO date is resolved to epoch ms; symbolic "now" is dropped because
    // omitting range.end is equivalent to the API default ("now").
    assert.equal(config.range.start, Date.UTC(2024, 0, 1));
    assert.equal('end' in config.range, false);
    assert.ok(
      result.patches.some((line) => line.includes('range.start')),
      'patches must record the start mutation',
    );
  });

  it('omits endpoints whose resolved value is undefined or a symbolic token', () => {
    const config = {
      range: { start: 'inception', end: '' },
    };
    const result = resolveBacktestRangeInPlace(config, {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.changed, true);
    // Both endpoints get dropped (empty string → undefined, "inception" →
    // omitted because the API default IS "inception"). When `range` ends up
    // with no remaining keys, the helper deletes `range` itself so the SDK
    // sees the field as absent rather than `range: {}`.
    assert.equal('range' in config, false);
  });

  it('is a no-op when config has no range', () => {
    const config = { timeframe: '4h' };
    const result = resolveBacktestRangeInPlace(config, {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.changed, false);
    assert.deepEqual(result.patches, []);
  });

  it('is a no-op when range endpoints are already epoch ms', () => {
    const config = {
      range: { start: 1704067200000, end: 1735603200000 },
    };
    const result = resolveBacktestRangeInPlace(config, {
      referenceMs: REFERENCE_MS,
    });
    assert.equal(result.changed, false);
    assert.equal(config.range.start, 1704067200000);
  });
});

describe('maxIndicatorPeriod', () => {
  it('extracts the longest length from indicator nodes', () => {
    const period = maxIndicatorPeriod({
      nodes: [
        { kind: 'indicator', indicator: 'rsi', args: { length: 14 } },
        { kind: 'indicator', indicator: 'sma', args: { length: 200 } },
      ],
    });
    assert.equal(period, 200);
  });

  it('reads top-level period on rolling-style nodes', () => {
    const period = maxIndicatorPeriod({
      nodes: [
        { kind: 'rolling', period: 50 },
        { kind: 'indicator', indicator: 'rsi', args: { length: 14 } },
      ],
    });
    assert.equal(period, 50);
  });

  it('considers args.fastLength / args.slowLength on multi-period indicators', () => {
    const period = maxIndicatorPeriod({
      nodes: [
        {
          kind: 'indicator',
          indicator: 'macd',
          args: { fastLength: 12, slowLength: 26, signalLength: 9 },
        },
      ],
    });
    assert.equal(period, 26);
  });

  it('returns undefined when no period-bearing nodes exist', () => {
    assert.equal(maxIndicatorPeriod({ nodes: [] }), undefined);
    assert.equal(maxIndicatorPeriod(null), undefined);
    assert.equal(
      maxIndicatorPeriod({ nodes: [{ kind: 'pattern' }] }),
      undefined,
    );
  });
});
