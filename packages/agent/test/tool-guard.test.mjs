import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TraseqApiError } from '@traseq/sdk';
import {
  augmentToolError,
  preflightToolArgs,
} from '../dist/mcp/tool-guard.js';

describe('preflightToolArgs', () => {
  it('passes through tools without registered preconditions', () => {
    assert.equal(preflightToolArgs('get_capabilities', {}), null);
    assert.equal(preflightToolArgs('list_strategies', { page: 1 }), null);
  });

  it('rejects run_backtest when strategyVersionId is missing', () => {
    const result = preflightToolArgs('run_backtest', {});
    assert.ok(result, 'expected preflight to fail');
    assert.equal(result.code, 'PREFLIGHT_MISSING_STRATEGY_VERSION_ID');
    assert.ok(
      result.nextSteps.some((step) =>
        step.includes('run_guided_research_round'),
      ),
      'next steps must point at the guided flow',
    );
  });

  it('rejects run_backtest when strategyVersionId is not a UUID', () => {
    const result = preflightToolArgs('run_backtest', {
      strategyVersionId: 'not-a-uuid',
    });
    assert.ok(result);
    assert.equal(result.code, 'PREFLIGHT_INVALID_STRATEGY_VERSION_ID');
    assert.ok(
      result.message.includes('strategyId'),
      'message must call out the common strategyId-vs-strategyVersionId mistake',
    );
  });

  it('accepts run_backtest with a well-formed UUID', () => {
    assert.equal(
      preflightToolArgs('run_backtest', {
        strategyVersionId: '0192f3a0-deef-7c00-aa11-22b3344c5566',
      }),
      null,
    );
  });
});

describe('augmentToolError', () => {
  function makeApiError(body) {
    return new TraseqApiError(
      'Bad Request',
      400,
      'POST',
      '/public/v1/backtests',
      JSON.stringify(body),
    );
  }

  it('returns no augmentation for non-Traseq errors', () => {
    const result = augmentToolError('run_backtest', new Error('network down'));
    assert.equal(result.extraNextSteps.length, 0);
    assert.equal(result.hintCode, null);
  });

  it('returns no augmentation for unrelated tools even with matching message', () => {
    const error = makeApiError({ message: 'strategy version is not finalized' });
    const result = augmentToolError('get_capabilities', error);
    assert.equal(
      result.extraNextSteps.length,
      0,
      'augmentation should only fire on state-gated tools',
    );
  });

  it('augments run_backtest failure when API says version not finalized', () => {
    const error = makeApiError({
      message: 'Strategy version is not finalized',
      errorCode: 'STRATEGY_NOT_FINALIZED',
    });
    const result = augmentToolError('run_backtest', error);
    assert.equal(result.hintCode, 'STRATEGY_VERSION_NOT_FINALIZED');
    assert.ok(
      result.extraNextSteps.some((step) =>
        step.includes('run_guided_research_round'),
      ),
      'next steps must name the guided recovery tool',
    );
  });

  it('augments fork-required errors with forkedFromVersionId guidance', () => {
    const error = makeApiError({
      message: 'forkedFromVersionId is required for this strategy',
    });
    const result = augmentToolError('create_strategy_version', error);
    assert.equal(result.hintCode, 'STRATEGY_VERSION_FORK_REQUIRED');
    assert.ok(
      result.extraNextSteps.some((step) =>
        step.toLowerCase().includes('fork'),
      ),
    );
  });

  it('matches publicAgent.code in addition to message body', () => {
    const error = makeApiError({
      message: 'Generic error',
      publicAgent: {
        code: 'STRATEGY_VERSION_NOT_FINALIZED',
        category: 'validation',
        title: 'Cannot backtest a draft',
        explanation: 'The version is not finalized.',
        nextSteps: [],
        links: [],
        retryable: false,
      },
    });
    const result = augmentToolError('run_backtest', error);
    assert.equal(result.hintCode, 'STRATEGY_VERSION_NOT_FINALIZED');
  });

  it('returns no augmentation when error matches no known state pattern', () => {
    const error = makeApiError({ message: 'Internal server error' });
    const result = augmentToolError('run_backtest', error);
    assert.equal(result.extraNextSteps.length, 0);
    assert.equal(result.hintCode, null);
  });
});
