import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOL_REGISTRY,
  buildResearchArtifactBundle,
  evaluateResearchResult,
  formatResearchReport,
  runAgentTool,
} from '../dist/index.js';

const VALIDATION_OK = {
  valid: true,
  summary: { errors: 0, warnings: 0 },
  issues: {},
};

function draft() {
  return {
    name: 'Agent strategy',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [],
      strategy: { kind: 'strategy' },
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

function makeClient() {
  const calls = [];
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
      return {
        protocol: 'traseq.capabilities',
        version: 1,
        signalGraph: { nodes: [], bindings: [] },
        indicators: [],
        operators: { compare: [], cross: [] },
      };
    },
    async validateStrategy() {
      calls.push('validateStrategy');
      return VALIDATION_OK;
    },
    async createStrategy() {
      calls.push('createStrategy');
      return { id: 'strategy-1', versions: [{ version: 1 }] };
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

const EXPECTED_REPORT_SNAPSHOT = `# Traseq Research Report

## Summary

- **Run ID:** run-1
- **Prompt:** Research a BTCUSDT trend strategy.
- **Instrument:** BTCUSDT
- **Timeframe:** 4h
- **Runner status:** completed
- **Evaluation confidence:** Robust (\`robust\`)
- **Champion round:** 1

## Verdict

- **Confidence:** Robust (\`robust\`)
- **Decision:** Keep candidate (\`keep_candidate\`)
- **Summary:** Champion round meets the first-pass research robustness bar.
- **Next action:** Keep this candidate and move to baseline or robustness evaluation next.

## Risk Flags

- None

## Round 1

- **Confidence:** Robust (\`robust\`)
- **Decision:** Keep candidate (\`keep_candidate\`)
- **Score:** 24.00
- **Return:** 14.00%
- **Sharpe:** 0.90
- **Profit factor:** 1.50
- **Max drawdown:** 16.00%
- **Trades:** 24

Strengths:
- Round meets the research robustness threshold.
- Trade sample is large enough for first-pass comparison.
- Profit factor shows a constructive profit/loss structure.
- Risk-adjusted return is usable for early research.

Weaknesses:
- No major first-pass evidence risks were detected.
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

    assert.match(report, /Confidence:\*\* Robust \(`robust`\)/);
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

describe('agent workflow MCP tools', () => {
  it('registers runner, evaluator, and report tools for MCP clients', () => {
    const names = AGENT_TOOL_REGISTRY.map((tool) => tool.name);

    assert.ok(names.includes('run_research_draft'));
    assert.ok(names.includes('evaluate_research_result'));
    assert.ok(names.includes('format_research_report'));
  });

  it('publishes typed enum and minLength constraints for run_research_draft inputs', () => {
    const tool = AGENT_TOOL_REGISTRY.find(
      (entry) => entry.name === 'run_research_draft',
    );
    assert.ok(tool, 'run_research_draft tool must be registered');

    const props = tool.input_schema.properties;
    assert.deepEqual(props.timeframe, {
      type: 'string',
      enum: ['15m', '1h', '4h', '1d'],
    });
    assert.deepEqual(props.positionStyle, {
      type: 'string',
      enum: ['single', 'pyramid', 'accumulate'],
    });
    assert.deepEqual(props.prompt, { type: 'string', minLength: 12 });
  });

  it('rejects short prompts at the tool boundary with a clear error', async () => {
    const client = makeClient();
    await assert.rejects(
      runAgentTool(
        'run_research_draft',
        { prompt: 'short', draft: draft() },
        { client },
      ),
      /at least 12 characters/,
    );
  });

  it('rejects unknown timeframe values at the tool boundary', async () => {
    const client = makeClient();
    await assert.rejects(
      runAgentTool(
        'run_research_draft',
        {
          prompt: 'Research a BTCUSDT trend strategy.',
          draft: draft(),
          timeframe: '2h',
        },
        { client },
      ),
      /timeframe must be one of/,
    );
  });

  it('rejects unknown positionStyle values at the tool boundary', async () => {
    const client = makeClient();
    await assert.rejects(
      runAgentTool(
        'run_research_draft',
        {
          prompt: 'Research a BTCUSDT trend strategy.',
          draft: draft(),
          positionStyle: 'martingale',
        },
        { client },
      ),
      /positionStyle must be one of/,
    );
  });

  it('rejects clients missing research runner methods', async () => {
    await assert.rejects(
      runAgentTool(
        'run_research_draft',
        { prompt: 'Research a BTCUSDT trend strategy.', draft: draft() },
        { client: { getCapabilities: async () => ({}) } },
      ),
      /requires a Traseq client/,
    );
  });

  it('runs evaluate_research_result without a platform client', async () => {
    const output = await runAgentTool('evaluate_research_result', {
      result: researchResult(),
    });

    assert.equal(output.confidence, 'robust');
    assert.equal(output.verdict.decision, 'keep_candidate');
  });

  it('runs format_research_report without a platform client', async () => {
    const output = await runAgentTool('format_research_report', {
      result: researchResult(),
    });

    assert.match(output.report, /Traseq Research Report/);
    assert.match(output.report, /Verdict/);
  });

  it('runs run_research_draft through the research runner using the supplied client', async () => {
    const client = makeClient();
    const output = await runAgentTool(
      'run_research_draft',
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
    assert.equal(output.evaluation.confidence, 'robust');
    assert.match(output.report, /Traseq Research Report/);
    assert.ok(client.calls.includes('runBacktest'));
  });

  it('runs run_research_draft through the CLI run command with a platform client', async () => {
    const result = await runCli(
      [
        'run',
        '--tool',
        'run_research_draft',
        '--input',
        JSON.stringify({
          prompt: 'Research a BTCUSDT trend strategy.',
          draft: draft(),
          instrument: 'BTCUSDT',
          timeframe: '4h',
          pollIntervalMs: 1,
          timeoutMs: 1_000,
        }),
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
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'completed');
    assert.equal(parsed.result.rounds[0].backtest.id, 'bt-1');
    assert.match(parsed.report, /Traseq Research Report/);
  });
});

describe('report CLI', () => {
  it('formats a research report from stdin', async () => {
    const result = await runCli(['report', '--stdin'], {
      input: JSON.stringify(researchResult()),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^# Traseq Research Report/);
    assert.match(result.stdout, /Verdict/);
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
    assert.match(result.stderr, /schemaVersion mismatch/);
    assert.equal(result.stdout, '');
  });
});
