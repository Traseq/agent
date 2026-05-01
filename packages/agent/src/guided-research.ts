import { TraseqClient } from '@traseq/sdk';

import { evaluateResearchResult } from './evaluation.js';
import { readEnv, requireEnv } from './env.js';
import { asJsonObject } from './normalize.js';
import { formatResearchReport, representativeBacktest } from './report.js';
import { normalizeRequest, runResearch } from './research.js';
import { runResearchRunner } from './research-runner.js';
import { summarizeUsageHints, type UsageStatus } from './usage-hints.js';
import type {
  GuidedResearchEvidence,
  GuidedResearchRoundInput,
  GuidedResearchRoundResult,
  ResearchContextClient,
  ResearchDecisionPoint,
  ResearchEngagementBrief,
  ResearchEngagementInput,
  ResearchResultEvaluation,
  ResearchRiskTolerance,
  ResearchRunnerClient,
  ResearchRunnerResult,
  ServiceMessage,
  StrategyDraftLike,
} from './types.js';

const RISK_TOLERANCE_VALUES: readonly ResearchRiskTolerance[] = [
  'conservative',
  'moderate',
  'aggressive',
];

function createClient(): TraseqClient {
  return new TraseqClient({
    apiKey: requireEnv('TRASEQ_API_KEY'),
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
  });
}

function normalizeRiskTolerance(value: unknown): ResearchRiskTolerance {
  return typeof value === 'string' &&
    (RISK_TOLERANCE_VALUES as readonly string[]).includes(value)
    ? (value as ResearchRiskTolerance)
    : 'moderate';
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
): ServiceMessage[] {
  return [
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
  return {
    completedRounds: result.summary.completedRounds,
    totalRounds: result.summary.totalRounds,
    ...(result.championRound !== undefined
      ? { championRound: result.championRound }
      : {}),
    riskFlagCount: evaluation.riskFlags.length,
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
    messages.push({
      level: 'critical',
      title: 'Research stopped before usable evidence',
      message:
        result.stopReason === 'validation_failed'
          ? 'Validation failed, so no strategy write or backtest execution should be treated as completed research.'
          : `The research run stopped with reason: ${result.stopReason ?? 'unknown'}.`,
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

export async function startResearchEngagement(
  input: ResearchEngagementInput,
  options: { client?: ResearchContextClient } = {},
): Promise<ResearchEngagementBrief> {
  const normalized = normalizeRequest(input);
  const riskTolerance = normalizeRiskTolerance(input.riskTolerance);
  const research = await runResearch(input, undefined, {
    ...(options.client ? { client: options.client } : {}),
  });

  const usageStatus = summarizeUsageHints({
    usage: research.live.usage,
    workspace: research.live.workspace,
    manifest: research.live.manifest,
  });
  const serviceMessages = buildEngagementMessages(normalized, riskTolerance);
  const usageMessage = buildUsageStatusMessage(usageStatus);
  if (usageMessage) {
    serviceMessages.push(usageMessage);
  }

  return {
    runId: research.runId,
    startedAt: research.startedAt,
    completedAt: research.completedAt,
    input: normalized,
    riskTolerance,
    assumptions: buildAssumptions(input, normalized, riskTolerance),
    serviceMessages,
    decisionPoints: buildDecisionPoints(normalized, riskTolerance),
    authoringInstructions: research.prompts.authoring,
    live: research.live,
    usageStatus,
    recommendedWorkflow: research.recommendedWorkflow,
    evidenceBoundaries: buildEvidenceBoundaries(),
  };
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

  const client = options.client ?? createClient();
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
