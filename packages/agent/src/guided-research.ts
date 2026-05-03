import type { InstrumentResolution } from '@traseq/sdk';

import { evaluateResearchResult } from './evaluation.js';
import { createTraseqClient } from './internal/runtime.js';
import { isRiskTolerance } from './internal/literals.js';
import { asJsonObject } from './normalize.js';
import { formatResearchReport, representativeBacktest } from './report.js';
import {
  normalizeRequest,
  resolveRequestInstrument,
  runResearch,
} from './research.js';
import { runResearchRunner } from './research-runner.js';
import { summarizeUsageHints, type UsageStatus } from './usage-hints.js';
import {
  AUTHORING_PREFERENCE_VALUES,
  type AuthoringPreference,
  type GuidedResearchEvidence,
  type GuidedResearchRoundInput,
  type GuidedResearchRoundResult,
  type ResearchContextClient,
  type ResearchDecisionPoint,
  type ResearchEngagementBrief,
  type ResearchEngagementInput,
  type ResearchIntentMaturity,
  type ResearchRecommendedMode,
  type ResearchResultEvaluation,
  type ResearchRiskTolerance,
  type ResearchRunnerClient,
  type ResearchRunnerResult,
  type ServiceMessage,
  type StrategyDraftLike,
} from './types.js';

interface AuthoringRoute {
  intentMaturity: ResearchIntentMaturity;
  recommendedMode: ResearchRecommendedMode;
  recommendedToolPath: string[];
  fallbackToolPath: string[];
  referenceTools: string[];
  routingRationale: string;
}

// Keyword tables for intent-maturity inference. Keep core routing
// locale-neutral; language-specific normalization belongs outside this runtime.
const EXPERT_PATTERNS_EN =
  /\b(signalgraph|sg\s*v?2|json|api|custom graph|node refs?|explicit refs?)\b/;

const VAGUE_PATTERNS_EN =
  /\b(no idea|no strategy idea|recommend|template|example|ideas?|find .*strategy)\b/;

const INDICATOR_PATTERNS_EN =
  /\b(rsi|ema|sma|macd|atr|bollinger|bbands?|volume|close|price|pivot|breakout|stop loss|take profit)\b/;

const OPERATOR_PATTERNS_EN =
  /\b(above|below|cross(?:es|ing)?|greater than|less than|over|under|reclaim)\b/;

const THRESHOLD_PATTERN = /\b\d+(?:\.\d+)?\s*%?\b/;
const STRATEGY_FAMILY_PATTERN = /\b(trend|momentum|breakout|mean reversion)\b/;

// Mode lookup keyed by intent maturity. Updating routing semantics is a
// one-line change here instead of a nested ternary.
const MODE_BY_MATURITY: Record<
  ResearchIntentMaturity,
  ResearchRecommendedMode
> = {
  expert: 'sg_v2',
  concrete: 'sg_v2',
  exploratory: 'block',
  vague: 'template',
};

// Recommended path is the user-narrative chain a human would follow in the UI.
// We deliberately collapse internal helpers (materialize_token_ast,
// validate_token_grammar_candidate, validate_token_block) into the higher-level
// composers — the agent never needs to see them as separate steps.
const RECOMMENDED_PATH_BY_MODE: Record<ResearchRecommendedMode, string[]> = {
  template: [
    'list_system_strategies',
    'get_system_strategy',
    'compose_strategy_from_template',
    'run_guided_research_round',
  ],
  block: [
    'compose_token_block',
    'assemble_strategy_from_blocks',
    'run_guided_research_round',
  ],
  hybrid: [
    'resolve_strategy_semantics',
    'assemble_signal_graph',
    'preflight_strategy_draft',
    'run_guided_research_round',
  ],
  sg_v2: [
    'resolve_strategy_semantics',
    'assemble_signal_graph',
    'preflight_strategy_draft',
    'run_guided_research_round',
  ],
};

const SG_V2_FALLBACK_PATH = [
  'get_authoring_examples',
  'compose_token_block',
  'assemble_strategy_from_blocks',
  'run_guided_research_round',
];
const TEMPLATE_FALLBACK_PATH = [
  'resolve_strategy_semantics',
  'assemble_signal_graph',
  'preflight_strategy_draft',
  'run_guided_research_round',
];
const FALLBACK_PATH_BY_MODE: Record<ResearchRecommendedMode, string[]> = {
  template: TEMPLATE_FALLBACK_PATH,
  block: TEMPLATE_FALLBACK_PATH,
  hybrid: SG_V2_FALLBACK_PATH,
  sg_v2: SG_V2_FALLBACK_PATH,
};

const RATIONALE_BY_MODE: Record<ResearchRecommendedMode, string> = {
  sg_v2:
    'Concrete or expert intent should be authored directly as SG v2 so the strategy logic is preserved.',
  hybrid:
    'Concrete intent should be authored as SG v2 first; recipes are only applied when they exactly preserve a facet.',
  block:
    'Exploratory intent has enough structure for editable token blocks but not enough precision to require direct SG v2.',
  template:
    'Vague intent benefits from templates or curated blocks before custom SG v2 authoring.',
};

const REFERENCE_TOOLS_FOR_BRIEF: readonly string[] = [
  'get_authoring_examples',
  'get_token_semantics',
  'get_token_grammar',
];

function normalizeRiskTolerance(value: unknown): ResearchRiskTolerance {
  return isRiskTolerance(value) ? value : 'moderate';
}

function normalizeAuthoringPreference(value: unknown): AuthoringPreference {
  return typeof value === 'string' &&
    (AUTHORING_PREFERENCE_VALUES as readonly string[]).includes(value)
    ? (value as AuthoringPreference)
    : 'auto';
}

function inferIntentMaturity(prompt: string): ResearchIntentMaturity {
  const lower = prompt.toLowerCase();

  if (EXPERT_PATTERNS_EN.test(lower)) {
    return 'expert';
  }

  const indicator = INDICATOR_PATTERNS_EN.test(lower);
  const operator = OPERATOR_PATTERNS_EN.test(lower);
  const threshold = THRESHOLD_PATTERN.test(lower);
  const concreteScore =
    (indicator ? 1 : 0) + (operator ? 1 : 0) + (threshold ? 1 : 0);

  // Concrete logic always wins: if the user names two of {indicator, operator,
  // threshold} we treat that as actionable strategy logic even when they hedge
  // it with vague phrasing ("I have no idea, maybe RSI < 30").
  if (concreteScore >= 2) return 'concrete';

  const vague = VAGUE_PATTERNS_EN.test(lower);
  if (vague) return 'vague';

  // Single concrete signal or a strategy family keyword is enough to call this
  // exploratory rather than vague — the user has a direction, just not a rule.
  if (indicator || operator || STRATEGY_FAMILY_PATTERN.test(lower)) {
    return 'exploratory';
  }
  return 'vague';
}

function buildAuthoringRoute(input: ResearchEngagementInput): AuthoringRoute {
  const intentMaturity = inferIntentMaturity(input.prompt);
  const preference = normalizeAuthoringPreference(input.authoringPreference);
  const recommendedMode: ResearchRecommendedMode =
    preference === 'auto' ? MODE_BY_MATURITY[intentMaturity] : preference;
  const routingRationale =
    preference === 'auto'
      ? RATIONALE_BY_MODE[recommendedMode]
      : `Authoring preference ${preference} overrides automatic routing.`;

  return {
    intentMaturity,
    recommendedMode,
    recommendedToolPath: [...RECOMMENDED_PATH_BY_MODE[recommendedMode]],
    fallbackToolPath: [...FALLBACK_PATH_BY_MODE[recommendedMode]],
    referenceTools: [...REFERENCE_TOOLS_FOR_BRIEF],
    routingRationale,
  };
}

function sourceHasMeaningfulValue(
  source: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const value = source?.[key];
  return value !== undefined && value !== null && value !== '';
}

function buildAssumptions(
  rawInput: ResearchEngagementInput,
  normalized: ReturnType<typeof normalizeRequest>,
  riskTolerance: ResearchRiskTolerance,
): string[] {
  const source = asJsonObject(rawInput) as Record<string, unknown> | undefined;
  const assumptions: string[] = [];

  if (!sourceHasMeaningfulValue(source, 'instrument')) {
    assumptions.push(
      `Instrument defaults to ${normalized.instrument} until the user chooses a market.`,
    );
  }
  if (!sourceHasMeaningfulValue(source, 'timeframe')) {
    assumptions.push(
      `Timeframe defaults to ${normalized.timeframe} for the first research pass.`,
    );
  }
  if (!sourceHasMeaningfulValue(source, 'positionStyle')) {
    assumptions.push(
      `Position style defaults to ${normalized.positionStyle} for a clean baseline.`,
    );
  }
  if (!sourceHasMeaningfulValue(source, 'riskTolerance')) {
    assumptions.push(
      `Risk tolerance defaults to ${riskTolerance}; stops and sizing should stay explainable.`,
    );
  }
  if (!sourceHasMeaningfulValue(source, 'rounds')) {
    assumptions.push(
      `Research depth defaults to ${normalized.rounds} pass${normalized.rounds === 1 ? '' : 'es'} before revisiting the thesis.`,
    );
  }

  return assumptions.length > 0
    ? assumptions
    : ['All core research constraints were supplied by the user.'];
}

function buildDecisionPoints(
  input: ReturnType<typeof normalizeRequest>,
  riskTolerance: ResearchRiskTolerance,
): ResearchDecisionPoint[] {
  return [
    {
      id: 'market_and_timeframe',
      question: 'Confirm the market and timeframe before authoring the draft.',
      recommended: `${input.instrument} on ${input.timeframe}`,
      options: [
        `${input.instrument} on ${input.timeframe}`,
        'Choose a different instrument',
        'Choose a different timeframe',
      ],
      required: false,
      rationale:
        'A stable market/timeframe frame keeps the first backtest comparable.',
    },
    {
      id: 'risk_profile',
      question: 'Confirm the risk posture for the first candidate.',
      recommended: riskTolerance,
      options: ['conservative', 'moderate', 'aggressive'],
      required: false,
      rationale:
        'Risk posture affects stop distance, sizing, and how strictly drawdown is judged.',
    },
    {
      id: 'run_permission',
      question:
        'Approve writes and backtest execution after the draft is reviewed.',
      recommended:
        'Validate first, then create/finalize/backtest only after the user understands the impact.',
      options: ['approve after review', 'revise draft first', 'stay read-only'],
      required: true,
      rationale:
        'The guided service keeps destructive steps explicit and auditable.',
    },
  ];
}

function buildEngagementMessages(
  input: ReturnType<typeof normalizeRequest>,
  riskTolerance: ResearchRiskTolerance,
  instrumentResolution?: InstrumentResolution,
): ServiceMessage[] {
  const messages: ServiceMessage[] = [
    {
      level: 'info',
      title: 'Research engagement initialized',
      message: `The first pass is framed as ${input.instrument} ${input.timeframe} research with ${input.positionStyle} positioning and ${riskTolerance} risk posture.`,
      nextAction:
        'Review the assumptions, then let the external agent author a draft strategy.',
    },
    {
      level: 'info',
      title: 'Provider boundary',
      message:
        '@traseq/agent will guide, validate, persist, backtest, evaluate, and report. It will not call an AI provider or place live orders.',
    },
    {
      level: 'warning',
      title: 'Evidence boundary',
      message:
        'Backtests are research evidence only. The memo must show return and risk together and must not present results as investment advice.',
    },
  ];

  if (
    instrumentResolution &&
    (instrumentResolution.status === 'unsupported' ||
      instrumentResolution.status === 'ambiguous')
  ) {
    const { status, suggestions } = instrumentResolution;
    messages.unshift({
      level: 'warning',
      title:
        status === 'ambiguous'
          ? 'Instrument needs disambiguation'
          : 'Instrument is not supported',
      message:
        status === 'ambiguous'
          ? `${input.instrument} maps to multiple supported instruments. Choose an exact symbol from capabilities.instruments before authoring.`
          : `${input.instrument} is not in the supported instrument universe. Traseq currently supports Binance spot, USDT-quoted instruments exposed by capabilities.instruments.`,
      nextAction:
        suggestions.length > 0
          ? `Use one of: ${suggestions.join(', ')}.`
          : 'Read traseq://instruments and choose an exact supported symbol.',
    });
  }

  return messages;
}

function buildEvidenceBoundaries(): string[] {
  return [
    'The service evaluates historical backtest evidence only.',
    'A passing verdict is not approval to trade live capital.',
    'Small samples, high drawdown, weak profit factor, and failed validation remain visible in the final memo.',
    'Out-of-sample, robustness, and baseline comparisons should be handled as follow-up research before deployment.',
  ];
}

function buildUsageStatusMessage(
  usageStatus: UsageStatus,
): ServiceMessage | undefined {
  if (usageStatus.level === 'ok') {
    return undefined;
  }

  // Prefer the cleanup deeplink for count bottlenecks at the cap (cheaper and
  // reversible than upgrade); otherwise fall back to billing_plan, then to
  // whatever the first link is. Keeps the surfaced "Next" suggestion aligned
  // with `nextSteps[0]` ordering.
  const exhaustedStrategies = usageStatus.bottlenecks.some(
    (b) => b.level === 'exhausted' && b.resource === 'strategies',
  );
  const exhaustedSavedResults = usageStatus.bottlenecks.some(
    (b) => b.level === 'exhausted' && b.resource === 'savedResults',
  );
  const preferredRel = exhaustedStrategies
    ? 'manage_strategies'
    : exhaustedSavedResults
      ? 'manage_backtests'
      : 'billing_plan';

  const link =
    usageStatus.links.find((candidate) => candidate.rel === preferredRel) ??
    usageStatus.links[0];

  return {
    level: usageStatus.level === 'exhausted' ? 'critical' : 'warning',
    title:
      usageStatus.level === 'exhausted'
        ? 'Workspace usage exhausted'
        : 'Workspace usage running low',
    message: usageStatus.message,
    ...(link ? { nextAction: `${link.label}: ${link.href}` } : {}),
  };
}

function buildGuidedEvidence(
  result: ResearchRunnerResult,
  evaluation: ResearchResultEvaluation,
): GuidedResearchEvidence {
  const warningCount = result.rounds.reduce(
    (count, round) => count + (round.warnings?.length ?? 0),
    result.warnings?.length ?? 0,
  );
  return {
    completedRounds: result.summary.completedRounds,
    totalRounds: result.summary.totalRounds,
    ...(result.championRound !== undefined
      ? { championRound: result.championRound }
      : {}),
    riskFlagCount: evaluation.riskFlags.length,
    ...(warningCount > 0 ? { warningCount } : {}),
    headline: result.summary.headline,
  };
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function buildCostOverageMessage(
  result: ResearchRunnerResult,
): ServiceMessage | undefined {
  // First overage takes precedence — guided round runs a single round, but
  // research-runner can carry multi-round results and we want the earliest signal.
  const overaged = result.rounds.find(
    (round) => round.costEstimate?.wouldCauseOverage,
  );
  const estimate = overaged?.costEstimate;
  if (!estimate) {
    return undefined;
  }
  return {
    level: 'warning',
    title: 'Pre-flight cost estimate exceeded remaining budget',
    message: `Estimated cost $${estimate.estimatedCostUsd.toFixed(4)} exceeds remaining $${estimate.currentBalanceUsd.toFixed(2)} (overage $${estimate.overageAmountUsd.toFixed(4)}). The backend will hard-block on Free/Plus API keys; on higher tiers the run continues with overage tracked.`,
    nextAction:
      'Reduce the backtest range or move to a higher timeframe to lower cost, or upgrade for more research credits.',
  };
}

function buildRoundMessages(
  result: ResearchRunnerResult,
  evaluation: ResearchResultEvaluation,
): ServiceMessage[] {
  const messages: ServiceMessage[] = [];
  const linkedBacktest = representativeBacktest(result, evaluation);

  if (result.status === 'failed') {
    const failure = result.failure;
    const topIssues = (failure?.issues ?? []).slice(0, 3);
    const issueLines = topIssues
      .map((issue) => {
        const code = issue.code ? `[${issue.code}] ` : '';
        const path = issue.path ? `${issue.path}: ` : '';
        return `- ${code}${path}${issue.message}`;
      })
      .join('\n');
    const baseMessage = failure
      ? `The research run stopped during ${failure.phase} (${failure.reason}): ${failure.message}`
      : 'The research run stopped before producing a structured failure.';
    const fullMessage =
      issueLines.length > 0
        ? `${baseMessage}\n\nTop issues (read \`result.failure.issues\` for the full list):\n${issueLines}`
        : baseMessage;
    messages.push({
      level: 'critical',
      title: 'Research stopped before usable evidence',
      message: fullMessage,
      nextAction: evaluation.verdict.nextAction,
    });
  } else if (evaluation.confidence === 'robust') {
    messages.push({
      level: 'success',
      title: 'Candidate passed the first evidence bar',
      message: evaluation.verdict.summary,
      nextAction: evaluation.verdict.nextAction,
    });
  } else {
    messages.push({
      level: 'warning',
      title: 'Candidate needs more research',
      message: evaluation.verdict.summary,
      nextAction: evaluation.verdict.nextAction,
    });
  }

  messages.push({
    level: 'info',
    title: 'Evidence memo ready',
    message:
      'The memo separates tested assumptions, observed evidence, risk flags, and the recommended next step.',
    ...(linkedBacktest?.appLinks?.backtest
      ? {
          nextAction: `Open the backtest in Traseq: ${linkedBacktest.appLinks.backtest}`,
          links: linkedBacktest.appLinks,
        }
      : {}),
  });

  return messages;
}

// P2-G: in-memory engagement store. Caches the brief so callers can patch
// riskTolerance / instrument / timeframe / positionStyle without re-running
// the 4-API-call context fetch (manifest, workspace, usage, capabilities).
// State is per-process and lost on MCP restart — adequate for single-session
// LLM clients and a clean swap point for a future backend-persisted store.
const engagementStore = new Map<string, ResearchEngagementBrief>();

export interface ResearchEngagementPatch {
  riskTolerance?: ResearchRiskTolerance;
  instrument?: string;
  timeframe?: string;
  positionStyle?: string;
  objective?: string;
  initialBalance?: number;
  maxConcurrentPositions?: number;
  authoringPreference?: AuthoringPreference;
}

function rebuildBrief(
  base: ResearchEngagementBrief,
  patch: ResearchEngagementPatch,
): ResearchEngagementBrief {
  // Build the overlay one field at a time so exactOptionalPropertyTypes never
  // sees an undefined assignment — only set keys that are explicitly patched.
  const overlay: Record<string, unknown> = {};
  if (patch.instrument !== undefined) overlay.instrument = patch.instrument;
  if (patch.timeframe !== undefined) overlay.timeframe = patch.timeframe;
  if (patch.positionStyle !== undefined)
    overlay.positionStyle = patch.positionStyle;
  if (patch.objective !== undefined) overlay.objective = patch.objective;
  if (patch.initialBalance !== undefined)
    overlay.initialBalance = patch.initialBalance;
  if (patch.maxConcurrentPositions !== undefined)
    overlay.maxConcurrentPositions = patch.maxConcurrentPositions;
  if (patch.authoringPreference !== undefined)
    overlay.authoringPreference = patch.authoringPreference;

  const mergedRawInput = {
    ...base.input,
    ...overlay,
  } as ResearchEngagementInput;
  const resolved = resolveRequestInstrument(
    normalizeRequest(mergedRawInput),
    base.live.capabilities,
  );
  const normalized = resolved.input;
  const riskTolerance = normalizeRiskTolerance(
    patch.riskTolerance ?? base.riskTolerance,
  );
  const route = buildAuthoringRoute(mergedRawInput);

  const serviceMessages = buildEngagementMessages(
    normalized,
    riskTolerance,
    resolved.resolution,
  );
  const usageMessage = buildUsageStatusMessage(base.usageStatus);
  if (usageMessage) {
    serviceMessages.push(usageMessage);
  }

  return {
    ...base,
    input: normalized,
    riskTolerance,
    assumptions: buildAssumptions(mergedRawInput, normalized, riskTolerance),
    serviceMessages,
    decisionPoints: buildDecisionPoints(normalized, riskTolerance),
    authoringInstructions: base.authoringInstructions,
    intentMaturity: route.intentMaturity,
    recommendedMode: route.recommendedMode,
    recommendedToolPath: route.recommendedToolPath,
    fallbackToolPath: route.fallbackToolPath,
    referenceTools: route.referenceTools,
    routingRationale: route.routingRationale,
    live: {
      ...base.live,
      instrumentResolution: resolved.resolution,
    },
    completedAt: new Date().toISOString(),
  };
}

export async function startResearchEngagement(
  input: ResearchEngagementInput,
  options: { client?: ResearchContextClient } = {},
): Promise<ResearchEngagementBrief> {
  const riskTolerance = normalizeRiskTolerance(input.riskTolerance);
  const route = buildAuthoringRoute(input);
  const research = await runResearch(input, undefined, {
    ...(options.client ? { client: options.client } : {}),
  });
  const normalized = research.input;

  const usageStatus = summarizeUsageHints({
    usage: research.live.usage,
    workspace: research.live.workspace,
    manifest: research.live.manifest,
  });
  const serviceMessages = buildEngagementMessages(
    normalized,
    riskTolerance,
    research.live.instrumentResolution,
  );
  const usageMessage = buildUsageStatusMessage(usageStatus);
  if (usageMessage) {
    serviceMessages.push(usageMessage);
  }

  const brief: ResearchEngagementBrief = {
    runId: research.runId,
    startedAt: research.startedAt,
    completedAt: research.completedAt,
    input: normalized,
    riskTolerance,
    assumptions: buildAssumptions(input, normalized, riskTolerance),
    serviceMessages,
    decisionPoints: buildDecisionPoints(normalized, riskTolerance),
    authoringInstructions: research.prompts.authoring,
    intentMaturity: route.intentMaturity,
    recommendedMode: route.recommendedMode,
    recommendedToolPath: route.recommendedToolPath,
    fallbackToolPath: route.fallbackToolPath,
    referenceTools: route.referenceTools,
    routingRationale: route.routingRationale,
    live: research.live,
    usageStatus,
    recommendedWorkflow: research.recommendedWorkflow,
    evidenceBoundaries: buildEvidenceBoundaries(),
  };

  engagementStore.set(brief.runId, brief);
  return brief;
}

export function updateResearchEngagement(
  runId: string,
  patch: ResearchEngagementPatch,
): ResearchEngagementBrief {
  const existing = engagementStore.get(runId);
  if (!existing) {
    throw new Error(
      `update_research_engagement: unknown runId "${runId}". Call start_research_engagement first; engagement state lives in-memory and resets when the MCP server restarts.`,
    );
  }
  const updated = rebuildBrief(existing, patch);
  engagementStore.set(runId, updated);
  return updated;
}

export function getResearchEngagement(
  runId: string,
): ResearchEngagementBrief | undefined {
  return engagementStore.get(runId);
}

// Test-only escape hatch so unit tests can reset the singleton between cases.
export function _clearEngagementStore(): void {
  engagementStore.clear();
}

export function formatResearchEngagementBrief(
  brief: ResearchEngagementBrief,
): string {
  const lines = [
    '# Traseq Research Engagement Brief',
    '',
    '## Research Task',
    '',
    `- Prompt: ${brief.input.prompt}`,
    `- Market: ${brief.input.instrument}`,
    `- Timeframe: ${brief.input.timeframe}`,
    `- Position style: ${brief.input.positionStyle}`,
    `- Risk posture: ${brief.riskTolerance}`,
    '',
    '## Assumptions',
    '',
    ...brief.assumptions.map((item) => `- ${item}`),
    '',
    '## Service Guidance',
    '',
    ...brief.serviceMessages.map(
      (message) =>
        `- ${message.title}: ${message.message}${
          message.nextAction ? ` Next: ${message.nextAction}` : ''
        }`,
    ),
    '',
    '## Decisions',
    '',
    ...brief.decisionPoints.map(
      (point) =>
        `- ${point.question} Recommended: ${sentence(point.recommended)} Rationale: ${point.rationale}`,
    ),
    '',
    '## Authoring Route',
    '',
    `- Intent maturity: ${brief.intentMaturity}`,
    `- Recommended mode: ${brief.recommendedMode}`,
    `- Recommended tool path: ${brief.recommendedToolPath.join(' -> ')}`,
    `- Fallback tool path: ${brief.fallbackToolPath.join(' -> ')}`,
    `- Reference tools: ${brief.referenceTools.join(', ')}`,
    `- Rationale: ${brief.routingRationale}`,
    '',
    '## Evidence Boundaries',
    '',
    ...brief.evidenceBoundaries.map((item) => `- ${item}`),
  ];

  return `${lines.join('\n').trim()}\n`;
}

export async function runGuidedResearchRound(
  input: GuidedResearchRoundInput,
  options: { client?: ResearchRunnerClient } = {},
): Promise<GuidedResearchRoundResult> {
  const draft = asJsonObject(input.draft);
  if (!draft) {
    throw new Error('runGuidedResearchRound requires a draft object.');
  }

  const client = options.client ?? createTraseqClient();
  const result = await runResearchRunner({
    client,
    input: {
      prompt: input.prompt,
      ...(input.instrument ? { instrument: input.instrument } : {}),
      ...(input.timeframe ? { timeframe: input.timeframe } : {}),
      ...(input.objective ? { objective: input.objective } : {}),
      ...(typeof input.initialBalance === 'number'
        ? { initialBalance: input.initialBalance }
        : {}),
      ...(typeof input.warmupPeriod === 'number'
        ? { warmupPeriod: input.warmupPeriod }
        : {}),
      ...(input.positionStyle ? { positionStyle: input.positionStyle } : {}),
      ...(typeof input.maxConcurrentPositions === 'number'
        ? { maxConcurrentPositions: input.maxConcurrentPositions }
        : {}),
      rounds: 1,
    },
    draftProducer: () => draft as unknown as StrategyDraftLike,
    ...(typeof input.pollIntervalMs === 'number'
      ? { pollIntervalMs: input.pollIntervalMs }
      : {}),
    ...(typeof input.timeoutMs === 'number'
      ? { timeoutMs: input.timeoutMs }
      : {}),
    ...(typeof input.producerTimeoutMs === 'number'
      ? { producerTimeoutMs: input.producerTimeoutMs }
      : {}),
    ...(typeof input.strategyId === 'string' && input.strategyId.length > 0
      ? { strategyId: input.strategyId }
      : {}),
    ...(typeof input.forkedFromVersionId === 'string' &&
    input.forkedFromVersionId.length > 0
      ? { forkedFromVersionId: input.forkedFromVersionId }
      : {}),
  });
  const evaluation = evaluateResearchResult(result);
  const usageStatus = summarizeUsageHints({
    usage: result.live.usage,
    workspace: result.live.workspace,
    manifest: result.live.manifest,
  });
  const report = formatResearchReport(result, evaluation, { usageStatus });
  const serviceMessages = buildRoundMessages(result, evaluation);
  const overageMessage = buildCostOverageMessage(result);
  if (overageMessage) {
    serviceMessages.push(overageMessage);
  }
  const usageMessage = buildUsageStatusMessage(usageStatus);
  if (usageMessage) {
    serviceMessages.push(usageMessage);
  }

  return {
    status: result.status,
    serviceMessages,
    evidence: buildGuidedEvidence(result, evaluation),
    verdict: evaluation.verdict,
    usageStatus,
    result,
    evaluation,
    report,
  };
}

export function summarizeResearchEngagement(
  value: ResearchRunnerResult | GuidedResearchRoundResult,
  evaluation?: ResearchResultEvaluation,
): string {
  const result = 'result' in value ? value.result : value;
  const resolvedEvaluation =
    evaluation ?? ('evaluation' in value ? value.evaluation : undefined);
  return resolvedEvaluation
    ? formatResearchReport(result, resolvedEvaluation)
    : formatResearchReport(result);
}
