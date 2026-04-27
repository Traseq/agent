import { randomUUID } from 'node:crypto';
import { TraseqClient } from '@traseq/sdk';

import { readEnv, requireEnv } from './env.js';
import { asJsonObject, asNumber, asString } from './normalize.js';
import type {
  AutoAgentRequest,
  AutoAgentResearchResult,
  EmitResearchEvent,
  JsonObject,
  ResearchWorkflowStep,
  Timeframe,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function createClient(): TraseqClient {
  return new TraseqClient({
    apiKey: requireEnv('TRASEQ_API_KEY'),
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
  });
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function capabilitySummary(capabilities: unknown): JsonObject {
  const source = asJsonObject(capabilities) ?? {};
  const signalGraph = asJsonObject(source.signalGraph) ?? {};
  const operators = asJsonObject(source.operators) ?? {};

  return {
    protocol: source.protocol,
    version: source.version,
    subscriptionTier: source.subscriptionTier,
    limits: asJsonObject(source.limits),
    nodeKinds: countArray(signalGraph.nodes),
    bindings: countArray(signalGraph.bindings),
    indicators: countArray(source.indicators),
    compareOperators: countArray(operators.compare),
    crossOperators: countArray(operators.cross),
  };
}

// ---------------------------------------------------------------------------
// Request normalization
// ---------------------------------------------------------------------------

function normalizeTimeframe(value: unknown): Timeframe {
  return value === '15m' || value === '1h' || value === '4h' || value === '1d'
    ? value
    : '4h';
}

function normalizePositionStyle(
  value: unknown,
  maxConcurrentPositions: number,
): AutoAgentRequest['positionStyle'] {
  if (value === 'single' || value === 'pyramid' || value === 'accumulate') {
    return value;
  }

  return maxConcurrentPositions > 1 ? 'pyramid' : 'single';
}

function sanitizePrompt(value: unknown): string {
  const prompt = asString(value);
  if (prompt.length < 12) {
    throw new Error('Prompt must be at least 12 characters long.');
  }

  return prompt;
}

export function normalizeRequest(input: unknown): AutoAgentRequest {
  const source = asJsonObject(input);
  if (!source) {
    throw new Error('Request body must be a JSON object.');
  }

  const instrument = asString(source.instrument, 'BTCUSDT').toUpperCase();
  if (!/^[A-Z0-9:_-]{3,20}$/.test(instrument)) {
    throw new Error('Instrument format is invalid.');
  }

  const rounds = Math.round(asNumber(source.rounds) ?? 3);
  const initialBalance = asNumber(source.initialBalance) ?? 10_000;
  const warmupPeriod = Math.round(asNumber(source.warmupPeriod) ?? 200);
  const maxConcurrentPositions = Math.round(
    asNumber(source.maxConcurrentPositions) ?? 1,
  );
  const clampedMaxConcurrentPositions = clamp(maxConcurrentPositions, 1, 10);

  return {
    prompt: sanitizePrompt(source.prompt),
    instrument,
    timeframe: normalizeTimeframe(source.timeframe),
    rounds: clamp(rounds, 1, 3),
    objective: asString(
      source.objective,
      'Improve risk-adjusted returns while keeping drawdown controlled and the logic explainable.',
    ),
    initialBalance:
      initialBalance > 0 ? roundNumber(initialBalance, 2) : 10_000,
    warmupPeriod: clamp(warmupPeriod, 10, 2_000),
    positionStyle: normalizePositionStyle(
      source.positionStyle,
      clampedMaxConcurrentPositions,
    ),
    maxConcurrentPositions: clampedMaxConcurrentPositions,
  };
}

// ---------------------------------------------------------------------------
// Brief builders
// ---------------------------------------------------------------------------

function buildAuthoringPrompt(input: AutoAgentRequest): string {
  return [
    'You are an external AI agent using @traseq/agent MCP tools.',
    'Author a minimal, explainable, backtestable Traseq signalGraph strategy.',
    '',
    'User brief:',
    input.prompt,
    '',
    'Hard constraints:',
    `- instrument: ${input.instrument}`,
    `- timeframe: ${input.timeframe}`,
    `- positionStyle: ${input.positionStyle}`,
    `- maxConcurrentPositions: ${input.maxConcurrentPositions}`,
    `- warmupPeriod: ${input.warmupPeriod}`,
    `- initialBalance: ${input.initialBalance}`,
    '',
    'Optimization objective:',
    input.objective,
    '',
    'Use get_capabilities before authoring. Resolve intent with resolve_strategy_semantics before writing signalGraph JSON.',
    'Explain the semantic facets you inferred, compare 2-3 resolver candidates, then assemble the smallest complete signalGraph.',
    'Validate with validate_strategy before create/finalize.',
    'Prefer a few strong conditions over many weak filters.',
  ].join('\n');
}

function buildRevisionPromptTemplate(input: AutoAgentRequest): string {
  return [
    'You are revising a Traseq strategy after a completed backtest.',
    `Keep instrument ${input.instrument} and timeframe ${input.timeframe} fixed unless the user explicitly asks otherwise.`,
    '',
    'Use these inputs:',
    '- previous draft',
    '- validate_strategy issues',
    '- resolve_strategy_semantics output when changing strategy semantics',
    '- get_backtest summary/result',
    '- get_backtest_chart_data or get_backtest_price_preview when visual evidence is useful',
    '- score output from traseq-agent score when available',
    '',
    'Make one targeted revision at a time. Re-validate, finalize, run_backtest, wait_backtest, and compare results.',
  ].join('\n');
}

function buildWorkflow(): ResearchWorkflowStep[] {
  return [
    {
      phase: 'discover',
      tools: [
        'get_manifest',
        'get_workspace_context',
        'get_usage',
        'get_capabilities',
        'resolve_strategy_semantics',
      ],
      goal: 'Understand auth scopes, limits, live authoring contract, semantic implementation candidates, and workspace budget before writes.',
    },
    {
      phase: 'seed',
      tools: ['list_system_strategies', 'get_system_strategy', 'list_blocks'],
      goal: 'Find templates or reusable blocks that match the research brief.',
    },
    {
      phase: 'author',
      tools: [
        'resolve_strategy_semantics',
        'validate_strategy',
        'validate_conflicts',
      ],
      goal: 'Resolve intent into fragments, draft signalGraph/settings locally, and repair all blocking validation issues before persisting.',
    },
    {
      phase: 'persist',
      tools: [
        'create_strategy',
        'create_strategy_version',
        'finalize_strategy_version',
      ],
      goal: 'Create or update a strategy version only after validation succeeds.',
    },
    {
      phase: 'backtest',
      tools: [
        'run_backtest',
        'get_backtest_progress',
        'wait_backtest',
        'get_backtest',
      ],
      goal: 'Run the finalized version and wait for terminal results.',
    },
    {
      phase: 'analyze',
      tools: [
        'get_backtest_chart_data',
        'get_backtest_price_preview',
        'preview_robustness_analysis',
        'create_robustness_analysis',
        'create_comparison_set',
      ],
      goal: 'Inspect evidence, stress test the candidate, and compare viable revisions.',
    },
    {
      phase: 'iterate',
      tools: [
        'update_strategy_version',
        'finalize_strategy_version',
        'run_backtest',
        'wait_backtest',
      ],
      goal: 'Repeat focused revisions for the requested number of research rounds.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Main research brief
// ---------------------------------------------------------------------------

export async function runResearch(
  rawInput: unknown,
  emit: EmitResearchEvent = () => undefined,
): Promise<AutoAgentResearchResult> {
  const input = normalizeRequest(rawInput);
  const runId = randomUUID();
  const startedAt = toIsoNow();
  const client = createClient();

  await emit({
    type: 'meta',
    runId,
    startedAt,
    input,
  });

  await emit({
    type: 'status',
    at: toIsoNow(),
    phase: 'live_context',
    message:
      'Reading Traseq workspace context, usage, manifest, and capabilities.',
  });

  const [manifest, workspace, usage, capabilities] = await Promise.all([
    client.getManifest(),
    client.getWorkspaceContext(),
    client.getUsage(),
    client.getCapabilities(),
  ]);

  const completedAt = toIsoNow();
  const result: AutoAgentResearchResult = {
    runId,
    startedAt,
    completedAt,
    input,
    live: {
      manifest,
      workspace,
      usage,
      capabilitySummary: capabilitySummary(capabilities),
    },
    prompts: {
      authoring: buildAuthoringPrompt(input),
      revision: buildRevisionPromptTemplate(input),
    },
    recommendedWorkflow: buildWorkflow(),
    notes: [
      '@traseq/agent is tool-first: it does not call an AI provider or generate strategy JSON by itself.',
      'Use the MCP tools to author, validate, persist, backtest, analyze, and iterate from your external agent.',
      'Destructive tools require confirm=true and should only be used after presenting the impact to the user.',
    ],
  };

  await emit({ type: 'completed', result });

  return result;
}
