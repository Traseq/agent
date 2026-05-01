import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  explainValidationIssues,
  suggestMinimalRepairs,
} from '../dist/index.js';

function validation(issues) {
  let errors = 0;
  let warnings = 0;
  for (const list of Object.values(issues)) {
    for (const issue of list ?? []) {
      if (issue.severity === 'warning') warnings++;
      else errors++;
    }
  }
  return {
    valid: errors === 0,
    summary: { errors, warnings },
    issues,
  };
}

function baseDraft() {
  return {
    name: 'Sample',
    signalGraph: { nodes: [] },
    settings: { positionStyle: 'single', warmupPeriod: 200 },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10_000,
    },
  };
}

describe('explainValidationIssues', () => {
  it('produces humanReason and suggestedFix per known code', () => {
    const result = explainValidationIssues({
      validation: validation({
        signalGraph: [
          {
            code: 'unsupported_indicator',
            path: 'signalGraph.nodes[0]',
            message: 'Indicator not in capabilities.',
            severity: 'error',
          },
        ],
        settings: [
          {
            code: 'invalid_position_style',
            path: 'settings.positionStyle',
            message: 'positionStyle must be one of single|pyramid|accumulate.',
            severity: 'error',
          },
        ],
      }),
    });
    assert.equal(result.errorCount, 2);
    assert.equal(result.warningCount, 0);
    assert.equal(result.issues.length, 2);
    const ind = result.issues.find((i) => i.code === 'unsupported_indicator');
    assert.match(ind.humanReason, /not present in capabilities/);
    assert.match(ind.suggestedFix, /supported indicator/);
    assert.ok(
      result.guidance.some((line) => /resolve_strategy_semantics/.test(line)),
      'should hint resolver for unsupported indicator',
    );
  });

  it('falls back gracefully when code is unknown', () => {
    const result = explainValidationIssues({
      validation: validation({
        signalGraph: [
          {
            code: 'mystery_code',
            message: 'Mystery error.',
            severity: 'error',
          },
        ],
      }),
    });
    assert.equal(
      result.issues[0].humanReason,
      'Validation rejected this part of the draft. The engine will not accept the strategy until it is addressed.',
    );
  });
});

describe('suggestMinimalRepairs', () => {
  it('emits a positionStyle replace patch for invalid_position_style', () => {
    const draft = baseDraft();
    draft.settings.positionStyle = 'long-only';
    const v = validation({
      settings: [
        {
          code: 'invalid_position_style',
          path: 'settings.positionStyle',
          message: 'Bad style.',
          severity: 'error',
        },
      ],
    });
    const repair = suggestMinimalRepairs({ draft, validation: v });
    assert.equal(repair.patches.length, 1);
    assert.deepEqual(repair.patches[0], {
      op: 'replace',
      path: '/settings/positionStyle',
      value: 'single',
      rationale: "Reset positionStyle to 'single' with explicit entry sizing.",
    });
  });

  it('adds entry sizing default for missing_qty', () => {
    const draft = baseDraft();
    const v = validation({
      settings: [
        {
          code: 'missing_qty',
          message: 'Missing qty.',
          severity: 'error',
        },
      ],
    });
    const repair = suggestMinimalRepairs({ draft, validation: v });
    assert.equal(repair.patches[0].op, 'add');
    assert.equal(
      repair.patches[0].path,
      '/signalGraph/strategy/entry/action/sizing',
    );
    assert.deepEqual(repair.patches[0].value, {
      mode: 'percent_equity',
      value: 10,
    });
  });

  it('proposes accumulation schedule when accumulate mode is missing config', () => {
    const draft = baseDraft();
    draft.settings = { positionStyle: 'accumulate' };
    const v = validation({
      settings: [
        {
          code: 'missing_qty',
          message: 'Accumulate needs schedule.',
          severity: 'error',
        },
      ],
    });
    const repair = suggestMinimalRepairs({ draft, validation: v });
    assert.equal(repair.patches[0].path, '/settings/accumulation');
    assert.equal(repair.patches[0].value.triggerMode, 'scheduled');
    assert.equal(repair.patches[0].value.schedule.cadence, 'weekly');
  });

  it('puts structural issues into unaddressedIssues', () => {
    const draft = baseDraft();
    const v = validation({
      signalGraph: [
        {
          code: 'missing_entry_rules',
          message: 'No entries.',
          severity: 'error',
        },
      ],
    });
    const repair = suggestMinimalRepairs({ draft, validation: v });
    assert.equal(repair.patches.length, 0);
    assert.equal(repair.unaddressedIssues.length, 1);
    assert.equal(repair.unaddressedIssues[0].code, 'missing_entry_rules');
    assert.ok(repair.notes.length > 0);
  });

  it('skips warnings in patches', () => {
    const draft = baseDraft();
    const v = validation({
      settings: [
        {
          code: 'invalid_position_style',
          message: 'Style warning.',
          severity: 'warning',
        },
      ],
    });
    const repair = suggestMinimalRepairs({ draft, validation: v });
    assert.equal(repair.patches.length, 0);
  });
});
