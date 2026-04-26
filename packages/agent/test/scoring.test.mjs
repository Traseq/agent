import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreBreakdown } from '../dist/scoring.js';

describe('buildScoreBreakdown', () => {
  it('scores a profitable backtest positively', () => {
    const summary = {
      returnPct: 0.15,
      sharpeRatio: 1.2,
      sortinoRatio: 1.5,
      maxDrawdown: 0.08,
      profitFactor: 1.8,
      totalPositions: 30,
      systemQualityNumber: 1.5,
    };

    const score = buildScoreBreakdown(summary);
    assert.ok(score.total > 0, `expected positive total, got ${score.total}`);
    assert.ok(score.returnScore > 0, 'return score should be positive');
    assert.ok(score.sharpeScore > 0, 'sharpe score should be positive');
    assert.ok(score.profitFactorScore > 0, 'profit factor score should be positive');
    assert.ok(score.drawdownPenalty >= 0, 'drawdown penalty should be non-negative');
    assert.ok(score.consistencyScore > 0, 'consistency score should be positive');
    assert.ok(score.activityScore > 0, 'activity score should be positive');
  });

  it('scores a losing backtest negatively', () => {
    const summary = {
      returnPct: -0.2,
      sharpeRatio: -0.5,
      sortinoRatio: -0.3,
      maxDrawdown: 0.35,
      profitFactor: 0.6,
      totalPositions: 50,
      systemQualityNumber: -1,
    };

    const score = buildScoreBreakdown(summary);
    assert.ok(score.total < 0, `expected negative total, got ${score.total}`);
    assert.ok(score.returnScore < 0, 'return score should be negative');
    assert.ok(score.drawdownPenalty > 0, 'drawdown penalty should be positive for large DD');
  });

  it('handles undefined summary gracefully', () => {
    const score = buildScoreBreakdown(undefined);
    assert.equal(typeof score.total, 'number');
    assert.ok(Array.isArray(score.notes));
  });

  it('handles empty summary gracefully', () => {
    const score = buildScoreBreakdown({});
    assert.equal(typeof score.total, 'number');
    assert.ok(score.notes.length > 0, 'should have notes about low sample');
  });

  it('generates appropriate notes for low trade count', () => {
    const score = buildScoreBreakdown({ totalPositions: 3 });
    assert.ok(
      score.notes.some((n) => n.includes('limited confidence') || n.includes('small')),
      'should note low sample size',
    );
  });

  it('generates appropriate notes for high trade count', () => {
    const score = buildScoreBreakdown({ totalPositions: 30 });
    assert.ok(
      score.notes.some((n) => n.includes('comparable')),
      'should note comparable sample size',
    );
  });

  it('generates notes for good sharpe', () => {
    const score = buildScoreBreakdown({ sharpeRatio: 1.5 });
    assert.ok(
      score.notes.some((n) => n.includes('usable level')),
      'should note good sharpe',
    );
  });

  it('generates notes for excessive drawdown', () => {
    const score = buildScoreBreakdown({ maxDrawdown: 0.3 });
    assert.ok(
      score.notes.some((n) => n.includes('excessive') || n.includes('priority')),
      'should note excessive drawdown',
    );
  });

  it('clamps extreme values', () => {
    const extreme = {
      returnPct: 100,
      sharpeRatio: 50,
      profitFactor: 100,
      maxDrawdown: 10,
      sortinoRatio: 100,
      totalPositions: 10000,
      systemQualityNumber: 100,
    };

    const score = buildScoreBreakdown(extreme);
    assert.ok(score.returnScore <= 45, 'return score clamped');
    assert.ok(score.sharpeScore <= 40, 'sharpe score clamped');
    assert.ok(score.profitFactorScore <= 36, 'PF score clamped');
    assert.ok(score.drawdownPenalty <= 40, 'drawdown penalty clamped');
    assert.ok(score.consistencyScore <= 28, 'consistency score clamped');
    assert.ok(score.activityScore <= 14, 'activity score clamped');
  });
});
