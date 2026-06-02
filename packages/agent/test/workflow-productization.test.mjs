import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOL_REGISTRY,
  buildResearchArtifactBundle,
  evaluateResearchResult,
  formatResearchEngagementBrief,
  formatResearchReport,
  runAgentTool,
  runGuidedResearchRound,
  startResearchEngagement,
} from '../dist/index.js';

const VALIDATION_OK = {
  valid: true,
  summary: { errors: 0, warnings: 0 },
  issues: [],
};

const CRYPTO_CAPABILITIES = {
  protocol: 'traseq.capabilities',
  version: 1,
  signalGraph: { nodes: [], bindings: [] },
  indicators: [],
  operators: { compare: [], cross: [] },
  instruments: [
    { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', dataStart: '2017-08-17' },
    { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', dataStart: '2017-08-17' },
    { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', dataStart: '2020-08-11' },
  ],
};

function draft() {
  return {
    name: 'Agent strategy',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [{ id: 'entry_signal', kind: 'pattern', name: 'inside_bar' }],
      strategy: {
        kind: 'strategy',
        entry: {
          kind: 'entry',
          trigger: { ref: 'entry_signal' },
          action: {
            side: 'long',
            sizing: { mode: 'percent_equity', value: 10 },
          },
        },
      },
    },
    settings: { positionStyle: 'single', warmupPeriod: 200 },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10_000,
    },
  };
}

function completedRound(round = 1) {
  return {
    round,
    label: `Round ${round}`,
    objective: 'Improve risk-adjusted returns.',
    inputPrompt: 'Research a BTCUSDT trend strategy.',
    status: 'completed',
    draft: draft(),
    validation: VALIDATION_OK,
    validationAttempts: 1,
    createdStrategyId: 'strategy-1',
    finalizedStrategyVersionId: `version-${round}`,
    backtest: {
      id: `bt-${round}`,
      status: 'completed',
      appLinks: {
        backtest: `https://app.traseq.test/backtests/bt-${round}`,
        backtestCharts: `https://app.traseq.test/backtests/bt-${round}?view=charts`,
        backtestTrades: `https://app.traseq.test/backtests/bt-${round}?view=trades`,
        backtestAnalytics: `https://app.traseq.test/backtests/bt-${round}?view=analytics`,
        strategy: 'https://app.traseq.test/strategies/strategy-1?version=1',
      },
      runContext: {
        instrument: { symbol: 'BTCUSDT' },
        timeframe: '4h',
        range: {
          start: 1704067200000,
          end: 1735689600000,
        },
        initialBalance: 10_000,
        strategyId: 'strategy-1',
        strategyVersionId: `version-${round}`,
        strategyVersionNumber: round,
      },
      summary: {
        returnPct: 0.14,
        sharpeRatio: 0.9,
        sortinoRatio: 1.1,
        maxDrawdown: 0.16,
        profitFactor: 1.5,
        totalPositions: 24,
      },
      raw: { id: `bt-${round}`, status: 'completed' },
    },
    score: {
      total: 24,
      returnScore: 0,
      sharpeScore: 0,
      profitFactorScore: 0,
      drawdownPenalty: 0,
      consistencyScore: 0,
      activityScore: 0,
      notes: [],
    },
    logs: [],
  };
}

function researchResult() {
  return {
    schemaVersion: 2,
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    input: {
      prompt: 'Research a BTCUSDT trend strategy.',
      instrument: 'BTCUSDT',
      timeframe: '4h',
      rounds: 1,
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
    rounds: [completedRound()],
    summary: {
      headline: 'Round 1 is the current champion.',
      completedRounds: 1,
      totalRounds: 1,
      topStrengths: [],
      nextFocus: [],
    },
    championRound: 1,
    status: 'completed',
  };
}

function makeClient(options = {}) {
  const calls = [];
  const capabilities = options.capabilities ?? {
    protocol: 'traseq.capabilities',
    version: 1,
    signalGraph: { nodes: [], bindings: [] },
    indicators: [],
    operators: { compare: [], cross: [] },
  };
  return {
    calls,
    async getManifest() {
      calls.push('getManifest');
      return { name: 'Traseq Agent API', version: 'v1' };
    },
    async getWorkspaceContext() {
      calls.push('getWorkspaceContext');
      return { workspace: { id: 'workspace-1' }, apiKey: { scopes: [] } };
    },
    async getUsage() {
      calls.push('getUsage');
      return { usage: {}, limits: {} };
    },
    async getCapabilities() {
      calls.push('getCapabilities');
      return capabilities;
    },
    async validateStrategy() {
      calls.push('validateStrategy');
      return VALIDATION_OK;
    },
    async createStrategy() {
      calls.push('createStrategy');
      return { id: 'strategy-1', versions: [{ version: 1 }] };
    },
    async getStrategy(strategyId) {
      calls.push('getStrategy');
      return {
        id: strategyId,
        versions: [
          {
            id: 'version-ready-default',
            version: 1,
            status: 'ready',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
    },
    async createStrategyVersion() {
      calls.push('createStrategyVersion');
      return { id: 'draft-v2', version: 2 };
    },
    async finalizeStrategyVersion() {
      calls.push('finalizeStrategyVersion');
      return { id: 'version-1', version: 1, status: 'ready' };
    },
    async runBacktest() {
      calls.push('runBacktest');
      return { id: 'bt-1', status: 'queued' };
    },
    async waitForBacktestCompletion() {
      calls.push('waitForBacktestCompletion');
      return {
        id: 'bt-1',
        status: 'completed',
        appLinks: {
          backtest: 'https://app.traseq.test/backtests/bt-1',
          backtestCharts: 'https://app.traseq.test/backtests/bt-1?view=charts',
          backtestTrades: 'https://app.traseq.test/backtests/bt-1?view=trades',
          backtestAnalytics:
            'https://app.traseq.test/backtests/bt-1?view=analytics',
          strategy: 'https://app.traseq.test/strategies/strategy-1?version=1',
        },
        runContext: {
          instrument: { symbol: 'BTCUSDT' },
          timeframe: '4h',
          range: {
            start: 1704067200000,
            end: 1735689600000,
          },
          initialBalance: 10_000,
          strategyId: 'strategy-1',
          strategyVersionId: 'version-1',
          strategyVersionNumber: 1,
        },
        summaryJson: {
          returnPct: 0.14,
          sharpeRatio: 0.9,
          sortinoRatio: 1.1,
          maxDrawdown: 0.16,
          profitFactor: 1.5,
          totalPositions: 24,
        },
      };
    },
  };
}

function runCli(args, { env, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env },
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

const EXPECTED_REPORT_SNAPSHOT = `# Traseq Guided Research Memo

This memo summarizes historical research evidence only. It is not investment advice, trade execution guidance, or live-trading approval.

## Executive Verdict

- **Run ID:** run-1
- **Runner status:** completed
- **Evaluation confidence:** Robust (\`robust\`)
- **Champion round:** 1

## Open in Traseq

- **Backtest:** [Open](https://app.traseq.test/backtests/bt-1)
- **Charts:** [Open](https://app.traseq.test/backtests/bt-1?view=charts)
- **Trades:** [Open](https://app.traseq.test/backtests/bt-1?view=trades)
- **Analytics:** [Open](https://app.traseq.test/backtests/bt-1?view=analytics)
- **Strategy:** [Open](https://app.traseq.test/strategies/strategy-1?version=1)

## What We Tested

- **Prompt:** Research a BTCUSDT trend strategy.
- **Instrument:** BTCUSDT
- **Timeframe:** 4h
- **Backtest range:** 2024-01-01T00:00:00.000Z to 2025-01-01T00:00:00.000Z
- **Initial balance:** 10000
- **Strategy version:** version-1
- **Position style:** single
- **Objective:** Improve risk-adjusted returns.

## Evidence

### Round 1

- Confidence: Robust (\`robust\`)
- Decision: Keep candidate (\`keep_candidate\`)
- Score: 24.00
- Return: 14.00%
- Sharpe: 0.90
- Profit factor: 1.50
- Max drawdown: 16.00%
- Trades: 24

Strengths
- Round meets the research robustness threshold.
- Trade sample is large enough for first-pass comparison.
- Profit factor shows a constructive profit/loss structure.
- Risk-adjusted return is usable for early research.

Weaknesses
- No major first-pass evidence risks were detected.

## Risk Flags

- None

## Decision

- **Decision:** Keep candidate (\`keep_candidate\`)
- **Summary:** Champion round meets the first-pass research robustness bar.

## Next Step

Keep this candidate and move to baseline or robustness evaluation next.
`;

describe('research report formatting', () => {
  it('formats a deterministic human-readable Markdown report', () => {
    const result = researchResult();
    const evaluation = evaluateResearchResult(result);
    const report = formatResearchReport(result, evaluation);

    assert.equal(report, EXPECTED_REPORT_SNAPSHOT);
  });

  it('humanizes confidence and decision enums while preserving the raw value', () => {
    const report = formatResearchReport(researchResult());

    assert.match(report, /Evaluation confidence:\*\* Robust \(`robust`\)/);
    assert.match(report, /Decision:\*\* Keep candidate \(`keep_candidate`\)/);
  });

  it('builds a deterministic artifact bundle without writing files', () => {
    const result = researchResult();
    const bundle = buildResearchArtifactBundle(result);

    assert.equal(bundle.root, '.traseq/research/run-1');
    assert.deepEqual(
      bundle.files.map((file) => file.path),
      [
        '.traseq/research/run-1/result.json',
        '.traseq/research/run-1/evaluation.json',
        '.traseq/research/run-1/report.md',
      ],
    );
    assert.equal(bundle.files[2].mediaType, 'text/markdown');
    assert.equal(bundle.files[2].contents, EXPECTED_REPORT_SNAPSHOT);
  });
});

describe('guided research service', () => {
  it('starts a service engagement with explicit defaults and no AI provider requirement', async () => {
    const client = makeClient();
    const brief = await startResearchEngagement(
      { prompt: 'Research a BTCUSDT trend strategy.' },
      { client },
    );
    const rendered = formatResearchEngagementBrief(brief);

    assert.equal(brief.input.instrument, 'BTCUSDT');
    assert.equal(brief.input.timeframe, '4h');
    assert.equal(brief.input.positionStyle, 'single');
    assert.equal(brief.riskTolerance, 'moderate');
    assert.ok(
      brief.assumptions.some((item) =>
        item.includes('Instrument defaults to BTCUSDT'),
      ),
    );
    assert.ok(
      brief.assumptions.some((item) =>
        item.includes('Timeframe defaults to 4h'),
      ),
    );
    assert.ok(
      brief.assumptions.some((item) =>
        item.includes('Risk tolerance defaults to moderate'),
      ),
    );
    assert.doesNotMatch(
      rendered,
      /get_manifest|validate_strategy|run_backtest/,
    );
    assert.doesNotMatch(
      brief.serviceMessages.map((message) => message.message).join('\n'),
      /get_manifest|validate_strategy|run_backtest/,
    );
    assert.ok(brief.authoringInstructions.includes('external AI agent'));
  });

  it('routes vague prompts toward template/block authoring', async () => {
    const brief = await startResearchEngagement(
      { prompt: 'I have no strategy idea yet. Recommend a BTCUSDT template.' },
      { client: makeClient() },
    );

    assert.equal(brief.intentMaturity, 'vague');
    assert.match(brief.recommendedMode, /template|block/);
    assert.ok(
      brief.recommendedToolPath.some((tool) =>
        [
          'compose_strategy_from_template',
          'assemble_strategy_from_blocks',
        ].includes(tool),
      ),
    );
    assert.ok(brief.referenceTools.includes('get_authoring_examples'));
  });

  it('keeps vague market copy limited to supported instruments', async () => {
    const brief = await startResearchEngagement(
      { prompt: 'I have no strategy idea yet.' },
      { client: makeClient({ capabilities: CRYPTO_CAPABILITIES }) },
    );
    const rendered = [
      formatResearchEngagementBrief(brief),
      JSON.stringify(brief.decisionPoints),
      JSON.stringify(brief.serviceMessages),
    ].join('\n');

    assert.doesNotMatch(rendered, /\bSPY\b|\bAAPL\b/);
    assert.match(rendered, /BTCUSDT/);
  });

  it('surfaces explicit unsupported instruments before authoring', async () => {
    const brief = await startResearchEngagement(
      {
        prompt: 'Research a SPY trend strategy.',
        instrument: 'SPY',
      },
      { client: makeClient({ capabilities: CRYPTO_CAPABILITIES }) },
    );

    assert.equal(brief.input.instrument, 'SPY');
    assert.equal(brief.live.instrumentResolution.status, 'unsupported');
    assert.ok(
      brief.serviceMessages.some(
        (message) =>
          message.title === 'Instrument is not supported' &&
          message.nextAction.includes('BTCUSDT'),
      ),
    );
  });

  it('routes concrete strategy conditions toward SG v2 authoring', async () => {
    const brief = await startResearchEngagement(
      {
        prompt:
          'Use RSI crossing above 30, price above EMA100, and a 2% stop loss.',
      },
      { client: makeClient() },
    );

    assert.equal(brief.intentMaturity, 'concrete');
    assert.match(brief.recommendedMode, /sg_v2|hybrid/);
    assert.ok(brief.recommendedToolPath.includes('assemble_signal_graph'));
    assert.ok(brief.recommendedToolPath.includes('preflight_strategy_draft'));
    assert.ok(brief.fallbackToolPath.includes('assemble_strategy_from_blocks'));
  });

  it('routes expert graph/API prompts directly to SG v2', async () => {
    const brief = await startResearchEngagement(
      {
        prompt:
          'Author a custom SignalGraph v2 JSON draft with explicit node refs for my API workflow.',
      },
      { client: makeClient() },
    );

    assert.equal(brief.intentMaturity, 'expert');
    assert.equal(brief.recommendedMode, 'sg_v2');
    assert.ok(brief.routingRationale.includes('SG v2'));
  });

  it('honors authoringPreference overrides', async () => {
    const brief = await startResearchEngagement(
      {
        prompt:
          'Use RSI crossing above 30, price above EMA100, and a 2% stop loss.',
        authoringPreference: 'template',
      },
      { client: makeClient() },
    );

    assert.equal(brief.recommendedMode, 'template');
    assert.ok(
      brief.recommendedToolPath.includes('compose_strategy_from_template'),
    );
    assert.ok(!brief.recommendedToolPath.includes('assemble_signal_graph'));
  });

  it('update_research_engagement patches in-memory state without re-fetching context (P2-G)', async () => {
    // Why this test exists: the user transcript shows the agent re-running
    // start_research_engagement (= 4 API calls) every time the user said
    // "actually use conservative". P2-G stores the brief and lets a patch
    // recompute assumptions/decisionPoints/serviceMessages with no client
    // calls. We assert exactly that: zero new client method invocations
    // between start and update.
    let manifestCalls = 0;
    let workspaceCalls = 0;
    let usageCalls = 0;
    let capabilityCalls = 0;
    const trackingClient = {
      async getManifest() {
        manifestCalls += 1;
        return { name: 'Traseq Agent API', version: 'v1' };
      },
      async getWorkspaceContext() {
        workspaceCalls += 1;
        return {
          workspace: { id: 'workspace-1' },
          subscription: { tier: 'plus' },
          apiKey: { scopes: ['workspace_read'] },
        };
      },
      async getUsage() {
        usageCalls += 1;
        return { usage: {}, limits: {} };
      },
      async getCapabilities() {
        capabilityCalls += 1;
        return {
          protocol: 'traseq.capabilities',
          version: 1,
          signalGraph: { nodes: [], bindings: [] },
          indicators: [],
          operators: { compare: [], cross: [] },
        };
      },
    };
    const brief = await startResearchEngagement(
      { prompt: 'Research a BTC trend strategy.' },
      { client: trackingClient },
    );
    assert.equal(brief.riskTolerance, 'moderate');
    assert.equal(
      manifestCalls + workspaceCalls + usageCalls + capabilityCalls,
      4,
    );

    const patched = await runAgentTool('update_research_engagement', {
      runId: brief.runId,
      riskTolerance: 'conservative',
      timeframe: '1d',
    });
    // Critical assertion: zero new client calls.
    assert.equal(
      manifestCalls + workspaceCalls + usageCalls + capabilityCalls,
      4,
    );
    assert.equal(patched.runId, brief.runId);
    assert.equal(patched.riskTolerance, 'conservative');
    assert.equal(patched.input.timeframe, '1d');
    // Assumptions and decisionPoints must reflect the new risk tolerance.
    assert.ok(
      patched.assumptions.some((item) =>
        item.toLowerCase().includes('conservative'),
      ),
      'patched assumptions should mention the new conservative tolerance',
    );
  });

  it('update_research_engagement throws on an unknown runId (P2-G)', async () => {
    await assert.rejects(
      () =>
        runAgentTool('update_research_engagement', {
          runId: 'definitely-not-a-real-runid',
          riskTolerance: 'aggressive',
        }),
      /unknown runId/,
    );
  });

  it('runs a guided research round and returns service messages plus a memo', async () => {
    const client = makeClient();
    const output = await runGuidedResearchRound(
      {
        prompt: 'Research a BTCUSDT trend strategy.',
        draft: draft(),
        instrument: 'BTCUSDT',
        timeframe: '4h',
      },
      { client },
    );

    assert.equal(output.status, 'completed');
    assert.equal(output.result.rounds[0].backtest.id, 'bt-1');
    assert.deepEqual(output.nextIterationSeed, {
      strategyId: 'strategy-1',
      forkedFromVersionId: 'version-1',
      round: 1,
      strategyVersionNumber: 1,
      backtestId: 'bt-1',
    });
    assert.deepEqual(output.result.nextIterationSeed, output.nextIterationSeed);
    assert.equal(output.evaluation.confidence, 'robust');
    assert.equal(output.verdict.decision, 'keep_candidate');
    assert.match(output.report, /Traseq Guided Research Memo/);
    assert.ok(
      output.serviceMessages.some(
        (message) =>
          message.title === 'Candidate passed the first evidence bar',
      ),
    );
    assert.ok(
      output.serviceMessages.some(
        (message) =>
          message.links?.backtest === 'https://app.traseq.test/backtests/bt-1',
      ),
    );
    assert.ok(
      output.serviceMessages.some(
        (message) => message.title === 'Next iteration seed ready',
      ),
    );
  });

  it('does not run a guided round for explicit unsupported instruments', async () => {
    const client = makeClient({ capabilities: CRYPTO_CAPABILITIES });
    const output = await runGuidedResearchRound(
      {
        prompt: 'Research a SPY trend strategy.',
        draft: draft(),
        instrument: 'SPY',
        timeframe: '4h',
      },
      { client },
    );

    assert.equal(output.status, 'failed');
    assert.equal(output.result.failure.phase, 'validate');
    assert.equal(output.result.live.instrumentResolution.status, 'unsupported');
    assert.ok(
      output.result.failure.issues.some(
        (issue) => issue.code === 'instrument_unavailable',
      ),
    );
    assert.deepEqual(
      client.calls.filter((name) =>
        [
          'validateStrategy',
          'createStrategy',
          'createStrategyVersion',
          'finalizeStrategyVersion',
          'runBacktest',
        ].includes(name),
      ),
      [],
    );
  });
});

describe('agent workflow MCP tools', () => {
  it('registers guided research tools for MCP clients', () => {
    const names = AGENT_TOOL_REGISTRY.map((tool) => tool.name);

    assert.ok(names.includes('start_research_engagement'));
    assert.ok(names.includes('run_guided_research_round'));
    assert.ok(names.includes('summarize_research_engagement'));
  });

  it('publishes schemas for guided research tools', () => {
    const start = AGENT_TOOL_REGISTRY.find(
      (entry) => entry.name === 'start_research_engagement',
    );
    const run = AGENT_TOOL_REGISTRY.find(
      (entry) => entry.name === 'run_guided_research_round',
    );

    assert.ok(start, 'start_research_engagement tool must be registered');
    assert.ok(run, 'run_guided_research_round tool must be registered');
    assert.deepEqual(start.input_schema.required, ['prompt']);
    assert.deepEqual(run.input_schema.required, ['prompt', 'draft']);
    assert.deepEqual(start.input_schema.properties.timeframe, {
      type: 'string',
      enum: ['15m', '1h', '4h', '1d'],
    });
    assert.deepEqual(run.input_schema.properties.riskTolerance, {
      type: 'string',
      enum: ['conservative', 'moderate', 'aggressive'],
    });
  });

  it('runs guided tools through the local tool registry', async () => {
    const client = makeClient();
    const brief = await runAgentTool(
      'start_research_engagement',
      { prompt: 'Research a BTCUSDT trend strategy.' },
      { client },
    );

    assert.equal(brief.input.instrument, 'BTCUSDT');

    const output = await runAgentTool(
      'run_guided_research_round',
      {
        prompt: 'Research a BTCUSDT trend strategy.',
        draft: draft(),
        instrument: 'BTCUSDT',
        timeframe: '4h',
      },
      { client },
    );

    assert.equal(output.status, 'completed');
    assert.match(output.report, /Traseq Guided Research Memo/);

    const summary = await runAgentTool('summarize_research_engagement', {
      result: output.result,
      evaluation: output.evaluation,
    });
    assert.match(summary.report, /## Next Step/);
  });
});

describe('report CLI', () => {
  it('formats a research report from stdin', async () => {
    const result = await runCli(['report', '--stdin'], {
      input: JSON.stringify(researchResult()),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^# Traseq Guided Research Memo/);
    assert.match(result.stdout, /Executive Verdict/);
  });

  it('exits non-zero for invalid JSON input', async () => {
    const result = await runCli(['report', '--stdin'], {
      input: '{not-json',
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Invalid JSON input/);
  });

  it('rejects runner JSON from an unknown schema version', async () => {
    const result = await runCli(['report', '--stdin'], {
      input: JSON.stringify({ ...researchResult(), schemaVersion: 999 }),
    });

    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /does not look like a research-run result.*got 999.*expected schemaVersion=2/s,
    );
    assert.equal(result.stdout, '');
  });
});

describe('guided CLI', () => {
  it('prints a service-style engagement brief by default', async () => {
    const result = await runCli(
      [
        'guide',
        '--prompt',
        'Research a BTCUSDT trend strategy.',
        '--instrument',
        'BTCUSDT',
      ],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^# Traseq Research Engagement Brief/);
    assert.match(result.stdout, /Assumptions/);
    assert.doesNotMatch(result.stdout, /get_manifest|validate_strategy/);
  });

  it('prints guided engagement JSON with defaults when requested', async () => {
    const result = await runCli(
      ['guide', '--prompt', 'Research a BTCUSDT trend strategy.', '--json'],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.input.instrument, 'BTCUSDT');
    assert.equal(parsed.input.timeframe, '4h');
    assert.equal(parsed.riskTolerance, 'moderate');
    assert.ok(Array.isArray(parsed.decisionPoints));
  });

  it('prints a guided service memo for guide-run', async () => {
    const result = await runCli(
      [
        'guide-run',
        '--prompt',
        'Research a BTCUSDT trend strategy.',
        '--draft',
        JSON.stringify(draft()),
        '--report',
      ],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_AGENT_TEST_VALIDATION: 'ok',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^# Traseq Guided Research Memo/);
    assert.match(result.stdout, /Executive Verdict/);
  });

  it('returns guided JSON and exits non-zero when validation stops the round', async () => {
    const result = await runCli(
      [
        'guide-run',
        '--prompt',
        'Research a BTCUSDT trend strategy.',
        '--draft',
        JSON.stringify(draft()),
        '--json',
      ],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_AGENT_TEST_VALIDATION: 'fail',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.notEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'failed');
    assert.equal(parsed.result.failure.reason, 'validation_failed');
    assert.equal(parsed.result.rounds[0].backtest, undefined);
    assert.ok(
      parsed.serviceMessages.some(
        (message) =>
          message.title === 'Research stopped before usable evidence',
      ),
    );
  });
});
