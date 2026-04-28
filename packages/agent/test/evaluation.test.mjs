import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResearchVerdict,
  evaluateResearchResult,
  evaluateResearchRound,
} from '../dist/index.js';

function score(total) {
  return {
    total,
    returnScore: 0,
    sharpeScore: 0,
    profitFactorScore: 0,
    drawdownPenalty: 0,
    consistencyScore: 0,
    activityScore: 0,
    notes: [],
  };
}

function completedRound(round, summary, total = 10) {
  return {
    round,
    label: `Round ${round}`,
    objective: 'Improve risk-adjusted returns.',
    inputPrompt: 'Research a BTCUSDT strategy.',
    status: 'completed',
    draft: {
      name: `Round ${round}`,
      signalGraph: {},
      settings: { positionStyle: 'single' },
      backtest: {
        timeframe: '4h',
        signalInstrument: { symbol: 'BTCUSDT' },
      },
    },
    validation: {
      valid: true,
      summary: { errors: 0, warnings: 0 },
      issues: {},
    },
    validationAttempts: 1,
    finalizedStrategyVersionId: `version-${round}`,
    backtest: {
      id: `bt-${round}`,
      status: 'completed',
      summary,
      raw: { id: `bt-${round}`, status: 'completed', summaryJson: summary },
    },
    score: score(total),
    logs: [],
  };
}

function runnerResult(rounds, championRound = undefined) {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    input: {
      prompt: 'Research a BTCUSDT strategy.',
      instrument: 'BTCUSDT',
      timeframe: '4h',
      rounds: rounds.length,
      objective: 'Improve risk-adjusted returns.',
      initialBalance: 10_000,
      warmupPeriod: 200,
      positionStyle: 'single',
      maxConcurrentPositions: 1,
    },
    live: {
      manifest: {},
      workspace: {},
      usage: {},
      capabilitySummary: {},
    },
    rounds,
    summary: {
      headline: 'Research run complete.',
      completedRounds: rounds.filter((round) => round.status === 'completed')
        .length,
      totalRounds: rounds.length,
      topStrengths: [],
      nextFocus: [],
    },
    ...(championRound ? { championRound } : {}),
    status: rounds.some((round) => round.status === 'completed')
      ? 'completed'
      : 'failed',
  };
}

function runCli(args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

describe('evaluateResearchRound', () => {
  it('classifies a strong early research candidate as robust', () => {
    const evaluation = evaluateResearchRound(
      completedRound(
        1,
        {
          returnPct: 0.18,
          sharpeRatio: 1.1,
          sortinoRatio: 1.4,
          maxDrawdown: 0.14,
          profitFactor: 1.7,
          totalPositions: 28,
        },
        42,
      ),
    );

    assert.equal(evaluation.confidence, 'robust');
    assert.equal(evaluation.decision, 'keep_candidate');
    assert.equal(evaluation.metrics.totalPositions, 28);
  });

  it('classifies a viable but early candidate as promising', () => {
    const evaluation = evaluateResearchRound(
      completedRound(
        1,
        {
          returnPct: 0.07,
          sharpeRatio: 0.5,
          sortinoRatio: 0.8,
          maxDrawdown: 0.24,
          profitFactor: 1.18,
          totalPositions: 12,
        },
        8,
      ),
    );

    assert.equal(evaluation.confidence, 'promising');
    assert.equal(evaluation.decision, 'continue_iterating');
  });

  it('classifies thin or high-drawdown evidence as weak', () => {
    const evaluation = evaluateResearchRound(
      completedRound(
        1,
        {
          returnPct: 0.04,
          sharpeRatio: 0.6,
          maxDrawdown: 0.38,
          profitFactor: 1.2,
          totalPositions: 9,
        },
        4,
      ),
    );

    assert.equal(evaluation.confidence, 'weak');
    assert.equal(evaluation.decision, 'continue_iterating');
    assert.ok(
      evaluation.riskFlags.some((flag) => flag.code === 'small_sample'),
    );
  });

  it('returns weaknesses as {code, message} pairs', () => {
    const evaluation = evaluateResearchRound(
      completedRound(
        1,
        {
          returnPct: 0.04,
          sharpeRatio: 0.6,
          maxDrawdown: 0.38,
          profitFactor: 1.2,
          totalPositions: 9,
        },
        4,
      ),
    );

    assert.ok(evaluation.weaknesses.length > 0);
    for (const weakness of evaluation.weaknesses) {
      assert.equal(typeof weakness.code, 'string');
      assert.equal(typeof weakness.message, 'string');
    }
    assert.ok(evaluation.weaknesses.some((w) => w.code === 'small_sample'));
  });

  it('returns no_major_risk weakness when the round has no flags', () => {
    const evaluation = evaluateResearchRound(
      completedRound(
        1,
        {
          totalPositions: 28,
          profitFactor: 1.7,
          sharpeRatio: 1.1,
          maxDrawdown: 0.14,
          returnPct: 0.18,
          sortinoRatio: 1.4,
        },
        42,
      ),
    );

    assert.deepEqual(evaluation.weaknesses, [
      {
        code: 'no_major_risk',
        message: 'No major first-pass evidence risks were detected.',
      },
    ]);
  });

  it('rejects zero-trade and structurally negative candidates', () => {
    const zeroTrade = evaluateResearchRound(
      completedRound(1, { totalPositions: 0, maxDrawdown: 0 }, -4),
    );
    const negativeEdge = evaluateResearchRound(
      completedRound(
        2,
        {
          totalPositions: 22,
          profitFactor: 0.8,
          sharpeRatio: -0.2,
          maxDrawdown: 0.2,
        },
        -12,
      ),
    );
    const highDrawdown = evaluateResearchRound(
      completedRound(
        3,
        {
          totalPositions: 25,
          profitFactor: 1.4,
          sharpeRatio: 0.9,
          maxDrawdown: 0.5,
        },
        10,
      ),
    );

    assert.equal(zeroTrade.confidence, 'reject');
    assert.equal(negativeEdge.confidence, 'reject');
    assert.equal(highDrawdown.confidence, 'reject');
    assert.equal(highDrawdown.decision, 'reject_candidate');
  });
});

describe('evaluateResearchResult', () => {
  it('handles failed-only runner results without claiming strategy evidence', () => {
    const failedRound = {
      round: 1,
      label: 'Round 1',
      objective: 'Improve risk-adjusted returns.',
      inputPrompt: 'Research a BTCUSDT strategy.',
      status: 'failed',
      draft: {},
      validation: {
        valid: false,
        summary: { errors: 1, warnings: 0 },
        issues: {
          tokens: [{ message: 'Entry trigger is required.' }],
        },
      },
      validationAttempts: 1,
      logs: [],
      stopReason: 'validation_failed',
    };

    const evaluation = evaluateResearchResult(runnerResult([failedRound]));

    assert.equal(evaluation.confidence, 'reject');
    assert.equal(evaluation.verdict.decision, 'reject_candidate');
    assert.ok(
      evaluation.riskFlags.some((flag) => flag.code === 'validation_failed'),
    );
    assert.match(evaluation.verdict.nextAction, /validation/i);
  });

  it('downgrades a weak champion instead of overclaiming robustness', () => {
    const evaluation = evaluateResearchResult(
      runnerResult(
        [
          completedRound(
            1,
            {
              totalPositions: 6,
              profitFactor: 1.2,
              sharpeRatio: 0.5,
              maxDrawdown: 0.2,
            },
            4,
          ),
        ],
        1,
      ),
    );

    assert.equal(evaluation.championRound, 1);
    assert.equal(evaluation.confidence, 'weak');
    assert.notEqual(evaluation.verdict.confidence, 'robust');
  });

  it('recommends rethinking thesis when all completed rounds are weak or rejected', () => {
    const evaluation = evaluateResearchResult(
      runnerResult(
        [
          completedRound(
            1,
            {
              totalPositions: 8,
              profitFactor: 1.05,
              sharpeRatio: 0.1,
              maxDrawdown: 0.32,
            },
            -1,
          ),
          completedRound(
            2,
            {
              totalPositions: 20,
              profitFactor: 0.8,
              sharpeRatio: -0.1,
              maxDrawdown: 0.25,
            },
            -8,
          ),
        ],
        1,
      ),
    );

    assert.equal(evaluation.verdict.decision, 'rethink_thesis');
    assert.equal(evaluation.confidence, 'weak');
  });
});

describe('buildResearchVerdict', () => {
  it('summarizes the top-level decision from an evaluation', () => {
    const evaluation = evaluateResearchResult(
      runnerResult(
        [
          completedRound(
            1,
            {
              totalPositions: 24,
              profitFactor: 1.5,
              sharpeRatio: 0.9,
              maxDrawdown: 0.18,
            },
            20,
          ),
        ],
        1,
      ),
    );

    const verdict = buildResearchVerdict(evaluation);

    assert.equal(evaluation.confidence, 'robust');
    assert.equal(verdict.decision, 'keep_candidate');
    assert.equal(verdict.confidence, undefined);
    assert.ok(verdict.summary.length > 0);
  });

  it('accepts an Omit<ResearchResultEvaluation, "verdict"> payload directly', () => {
    const verdict = buildResearchVerdict({
      schemaVersion: 1,
      status: 'completed',
      confidence: 'reject',
      rounds: [],
      riskFlags: [],
      stopReasons: [],
    });

    assert.equal(verdict.decision, 'reject_candidate');
    assert.match(verdict.summary, /No completed research rounds/);
  });
});

describe('evaluate CLI', () => {
  it('evaluates a runner result from stdin and exits zero for reject verdicts', async () => {
    const result = await runCli(['evaluate', '--stdin'], {
      input: JSON.stringify(
        runnerResult(
          [
            completedRound(
              1,
              {
                totalPositions: 0,
                profitFactor: 0,
                sharpeRatio: 0,
                maxDrawdown: 0,
              },
              -5,
            ),
          ],
          1,
        ),
      ),
    });

    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.confidence, 'reject');
    assert.equal(parsed.verdict.decision, 'reject_candidate');
  });

  it('exits non-zero for invalid JSON input', async () => {
    const result = await runCli(['evaluate', '--stdin'], {
      input: '{not-json',
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Invalid JSON input/);
  });

  it('rejects JSON arrays at the top level', async () => {
    const result = await runCli(['evaluate', '--stdin'], {
      input: '[]',
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Expected an object/);
  });

  it('rejects unknown schemaVersion in runner result', async () => {
    const result = await runCli(['evaluate', '--stdin'], {
      input: JSON.stringify({
        ...runnerResult([], undefined),
        schemaVersion: 999,
      }),
    });

    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /does not look like a research-run result.*got 999.*expected schemaVersion=1/s,
    );
  });
});
