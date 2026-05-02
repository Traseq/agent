import { randomUUID } from 'node:crypto';
import {
  TraseqApiError,
  TraseqClient,
  preflightStrategyDraft,
} from '@traseq/sdk';

import { analyzeRound } from './analysis.js';
import { readEnv, requireEnv } from './env.js';
import {
  asJsonObject,
  asNumber,
  asString,
  isJsonObject,
  normalizeBacktest,
  normalizeDraft,
  normalizeValidation,
} from './normalize.js';
import { normalizeStrategyDraft } from './semantics/normalize-draft.js';
import { buildScoreBreakdown } from './scoring.js';
import { normalizeRequest } from './research.js';
import type {
  AgentStepLog,
  AutoAgentRequest,
  BacktestConfigLike,
  JsonObject,
  ResearchDraftContext,
  ResearchRepairContext,
  ResearchRunnerClient,
  ResearchRunnerCostEstimate,
  ResearchRunnerLiveContext,
  ResearchRunnerOptions,
  ResearchRunnerResult,
  ResearchRunnerRound,
  ResearchRunnerStatus,
  ResearchRunnerSummary,
  RepairAttemptRecord,
  ScoreBreakdown,
  StrategyDraftLike,
  StrategySettings,
  Timeframe,
  ValidationIssueLike,
  ValidationSummaryLike,
} from './types.js';

type AccumulateSettings = Extract<
  StrategySettings,
  { positionStyle: 'accumulate' }
>;
type AccumulationConfig = AccumulateSettings['accumulation'];
type AccumulationTriggerMode = AccumulationConfig['triggerMode'];
type AccumulationSchedule = NonNullable<AccumulationConfig['schedule']>;

export const RUNNER_SCHEMA_VERSION = 1;

const DEFAULT_MAX_REPAIR_ATTEMPTS = 4;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_PRODUCER_TIMEOUT_MS = 120_000;

function toIsoNow(): string {
  return new Date().toISOString();
}

function createClient(): ResearchRunnerClient {
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

function metric(summary: JsonObject | undefined, key: string): number {
  const value = summary?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface ValidationAttemptInfo {
  validation: number;
  repair?: number;
}

function createLog(
  round: number,
  step: string,
  message: string,
  attempts?: ValidationAttemptInfo,
): AgentStepLog {
  return {
    at: toIsoNow(),
    round,
    source: 'system',
    step,
    message,
    ...(attempts?.validation !== undefined
      ? { validationAttempt: attempts.validation }
      : {}),
    ...(attempts?.repair !== undefined
      ? { repairAttempt: attempts.repair }
      : {}),
  };
}

function flattenValidationIssues(
  validation: ValidationSummaryLike,
): ValidationIssueLike[] {
  return [
    ...(validation.issues.signalGraph ?? []),
    ...(validation.issues.settings ?? []),
    ...(validation.issues.conflicts ?? []),
  ];
}

function formatIssueMessage(issue: ValidationIssueLike): string {
  const parts: string[] = [];
  if (issue.code) {
    parts.push(`[${issue.code}]`);
  }
  if (issue.path) {
    parts.push(`${issue.path}:`);
  }
  parts.push(issue.message);
  return parts.join(' ');
}

function buildAuthoringPayload(draft: StrategyDraftLike) {
  return {
    signalGraph: draft.signalGraph,
    settings: draft.settings,
  };
}

interface ValidatedDraftForResearch {
  draft: StrategyDraftLike;
  validation: ValidationSummaryLike;
}

async function validateDraftForResearch(
  client: ResearchRunnerClient,
  draft: StrategyDraftLike,
  capabilities: unknown,
): Promise<ValidatedDraftForResearch> {
  // P-Vocab: pre-normalize indicator-arg vocabulary drift (period→length,
  // misplaced args.output, etc.) so the producer doesn't have to spend a
  // repair cycle on mechanical schema fixes. The normalized draft is what
  // we hand back to the runner, so persist/backtest also see the clean
  // version.
  const normalized = normalizeStrategyDraft(draft, capabilities);
  const effective = normalized.changed ? normalized.draft : draft;

  const preflight = normalizeValidation(
    preflightStrategyDraft(effective, capabilities),
  );
  if (!preflight.valid) {
    return { draft: effective, validation: preflight };
  }
  const remote = normalizeValidation(
    await client.validateStrategy(buildAuthoringPayload(effective)),
  );
  return { draft: effective, validation: remote };
}

function versionNumberFrom(value: unknown): number | undefined {
  const source = asJsonObject(value);
  if (!source) {
    return undefined;
  }

  const direct = asNumber(source.version);
  if (direct !== undefined) {
    return Math.round(direct);
  }

  const versions = Array.isArray(source.versions) ? source.versions : [];
  const firstVersion = asJsonObject(versions[0]);
  const nested = asNumber(firstVersion?.version);
  return nested !== undefined ? Math.round(nested) : undefined;
}

function idFrom(value: unknown, context: string): string {
  const source = asJsonObject(value);
  if (!source) {
    throw new Error(
      `Traseq response for ${context} was not a JSON object; cannot read id.`,
    );
  }

  const rawId = source.id;
  if (rawId === undefined || rawId === null) {
    throw new Error(`Traseq response for ${context} did not include an id.`);
  }

  if (typeof rawId !== 'string') {
    throw new Error(
      `Traseq response for ${context} returned a non-string id (${typeof rawId}).`,
    );
  }

  if (rawId.trim().length === 0) {
    throw new Error(`Traseq response for ${context} returned an empty id.`);
  }

  return rawId;
}

function createDraftContext(
  runId: string,
  round: number,
  input: AutoAgentRequest,
  live: ResearchRunnerLiveContext,
  rounds: ResearchRunnerRound[],
): ResearchDraftContext {
  const previousRound = rounds.at(-1);
  return {
    runId,
    round,
    input,
    live,
    previousRounds: rounds,
    ...(previousRound ? { previousRound } : {}),
  };
}

function createRepairContext(
  base: ResearchDraftContext,
  attempt: number,
  draft: StrategyDraftLike,
  validation: ValidationSummaryLike,
): ResearchRepairContext {
  return {
    ...base,
    attempt,
    draft,
    validation,
  };
}

function resultStatus(
  rounds: readonly ResearchRunnerRound[],
  stopReason?: string,
): ResearchRunnerStatus {
  if (!stopReason) {
    return 'completed';
  }

  return rounds.some((round) => round.status === 'completed')
    ? 'partial'
    : 'failed';
}

function buildSummary(
  input: AutoAgentRequest,
  rounds: readonly ResearchRunnerRound[],
  champion: ResearchRunnerRound | undefined,
): ResearchRunnerSummary {
  const completedRounds = rounds.filter(
    (round) => round.status === 'completed',
  ).length;

  if (!champion) {
    return {
      headline: 'No completed research rounds produced comparable evidence.',
      completedRounds,
      totalRounds: input.rounds,
      topStrengths: [],
      nextFocus: ['Repair validation issues before running a backtest.'],
    };
  }

  return {
    headline: `Round ${champion.round} is the current champion for this research run.`,
    completedRounds,
    totalRounds: input.rounds,
    championRound: champion.round,
    championReason: `Selected by score ${champion.score?.total ?? 0}, then drawdown and sample size.`,
    topStrengths: champion.analysis?.strengths.slice(0, 3) ?? [],
    nextFocus: champion.analysis?.weaknesses.slice(0, 3) ?? [],
  };
}

function completeResult(args: {
  runId: string;
  startedAt: string;
  input: AutoAgentRequest;
  live: ResearchRunnerLiveContext;
  rounds: ResearchRunnerRound[];
  stopReason?: string;
  errors?: string[];
  validationIssues?: ValidationIssueLike[];
  repairAttempts?: RepairAttemptRecord[];
}): ResearchRunnerResult {
  const champion = selectChampionRound(args.rounds);
  const status = resultStatus(args.rounds, args.stopReason);
  const summary = buildSummary(args.input, args.rounds, champion);

  return {
    schemaVersion: RUNNER_SCHEMA_VERSION,
    runId: args.runId,
    startedAt: args.startedAt,
    completedAt: toIsoNow(),
    input: args.input,
    live: {
      manifest: args.live.manifest,
      workspace: args.live.workspace,
      usage: args.live.usage,
      capabilitySummary: args.live.capabilitySummary,
    },
    rounds: args.rounds,
    summary,
    ...(champion ? { championRound: champion.round } : {}),
    status,
    ...(args.stopReason ? { stopReason: args.stopReason } : {}),
    ...(args.errors && args.errors.length > 0 ? { errors: args.errors } : {}),
    ...(args.validationIssues && args.validationIssues.length > 0
      ? { validationIssues: args.validationIssues }
      : {}),
    ...(args.repairAttempts && args.repairAttempts.length > 0
      ? { repairAttempts: args.repairAttempts }
      : {}),
  };
}

const ACCUMULATION_TRIGGER_MODES: readonly AccumulationTriggerMode[] = [
  'scheduled',
  'signal',
  'scheduled_and_signal',
];

const ACCUMULATION_CADENCES: readonly AccumulationSchedule['cadence'][] = [
  'daily',
  'weekly',
  'monthly',
];

function isAccumulationTriggerMode(
  value: unknown,
): value is AccumulationTriggerMode {
  return (
    typeof value === 'string' &&
    (ACCUMULATION_TRIGGER_MODES as readonly string[]).includes(value)
  );
}

function asAccumulationSchedule(
  value: unknown,
): AccumulationSchedule | undefined {
  const source = asJsonObject(value);
  if (!source) {
    return undefined;
  }

  if (
    typeof source.cadence !== 'string' ||
    !(ACCUMULATION_CADENCES as readonly string[]).includes(source.cadence)
  ) {
    return undefined;
  }

  const schedule: AccumulationSchedule = {
    cadence: source.cadence as AccumulationSchedule['cadence'],
  };

  const interval = asNumber(source.interval);
  if (interval !== undefined && interval > 0) {
    schedule.interval = Math.round(interval);
  }

  const weekday = asNumber(source.weekday);
  if (weekday !== undefined) {
    schedule.weekday = Math.round(weekday);
  }

  const dayOfMonth = asNumber(source.dayOfMonth);
  if (dayOfMonth !== undefined) {
    schedule.dayOfMonth = Math.round(dayOfMonth);
  }

  if (source.anchorMode === 'backtest_start') {
    schedule.anchorMode = 'backtest_start';
  }

  return schedule;
}

function asAccumulationSettings(
  value: unknown,
): AccumulationConfig | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  if (!isAccumulationTriggerMode(value.triggerMode)) {
    return undefined;
  }

  const settings: AccumulationConfig = { triggerMode: value.triggerMode };

  const schedule = asAccumulationSchedule(value.schedule);
  if (schedule) {
    settings.schedule = schedule;
  }

  const maxAdds = asNumber(value.maxAdds);
  if (maxAdds !== undefined) {
    settings.maxAdds = Math.max(1, Math.round(maxAdds));
  }

  const budgetCap = asNumber(value.budgetCap);
  if (budgetCap !== undefined && budgetCap > 0) {
    settings.budgetCap = budgetCap;
  }

  const targetAllocationPct = asNumber(value.targetAllocationPct);
  if (targetAllocationPct !== undefined && targetAllocationPct > 0) {
    settings.targetAllocationPct = targetAllocationPct;
  }

  if (typeof value.stopWhenNoCash === 'boolean') {
    settings.stopWhenNoCash = value.stopWhenNoCash;
  }

  return settings;
}

function normalizeRunnerDraft(
  input: AutoAgentRequest,
  rawDraft: unknown,
): StrategyDraftLike {
  const draft = normalizeDraft(rawDraft);
  return {
    ...draft,
    settings: buildDefaultStrategySettings(input, draft.settings),
    backtest: buildBacktestConfig(input, draft.backtest),
  };
}

export function buildDefaultStrategySettings(
  input: AutoAgentRequest,
  draftSettings?: StrategySettings,
): StrategySettings {
  const source = draftSettings ? asJsonObject(draftSettings) : undefined;
  const draftWarmup = asNumber(source?.warmupPeriod);
  const warmupPeriod =
    draftWarmup !== undefined ? Math.round(draftWarmup) : input.warmupPeriod;
  const style = asString(source?.positionStyle);

  if (style === 'pyramid') {
    const draftMax = asNumber(source?.maxConcurrentPositions);
    return {
      positionStyle: 'pyramid',
      warmupPeriod,
      maxConcurrentPositions: Math.max(
        1,
        Math.round(draftMax ?? input.maxConcurrentPositions),
      ),
    };
  }

  if (style === 'accumulate') {
    const accumulation = asAccumulationSettings(source?.accumulation);
    if (!accumulation) {
      throw new Error(
        'Accumulate draft is missing a valid accumulation block (triggerMode is required).',
      );
    }
    const settings: AccumulateSettings = {
      positionStyle: 'accumulate',
      warmupPeriod,
      accumulation,
    };
    return settings;
  }

  if (style === 'single') {
    return {
      positionStyle: 'single',
      warmupPeriod,
    };
  }

  if (input.positionStyle === 'accumulate') {
    throw new Error(
      'Accumulate position style requires draft settings with accumulation configuration.',
    );
  }

  if (input.positionStyle === 'pyramid' || input.maxConcurrentPositions > 1) {
    return {
      positionStyle: 'pyramid',
      warmupPeriod,
      maxConcurrentPositions: Math.max(1, input.maxConcurrentPositions),
    };
  }

  return {
    positionStyle: 'single',
    warmupPeriod,
  };
}

export function buildBacktestConfig(
  input: AutoAgentRequest,
  draftBacktest?: BacktestConfigLike,
): BacktestConfigLike {
  const base: BacktestConfigLike = {
    timeframe: input.timeframe,
    signalInstrument: { symbol: input.instrument },
    initialBalance: input.initialBalance,
  };

  if (!draftBacktest) {
    return base;
  }

  return {
    ...base,
    ...draftBacktest,
    signalInstrument: draftBacktest.signalInstrument ?? base.signalInstrument,
  };
}

interface CompletedRound extends ResearchRunnerRound {
  status: 'completed';
  score: ScoreBreakdown;
  backtest: NonNullable<ResearchRunnerRound['backtest']>;
}

/**
 * Best-effort pre-flight cost estimate. Returns:
 *   - `{ estimate, log }` when the SDK supports it AND the draft has a range
 *     (the only case where the estimate matches the eventual run)
 *   - `{ estimate: undefined, log }` when we deliberately skip (older SDK, no
 *     range) — in those cases the backend is the only authority
 *   - `{ estimate: undefined, log, error }` when the estimate call fails — we
 *     log and continue; the round still proceeds, the backend will reject if
 *     budget is actually short
 */
async function tryEstimateBacktestCost(
  client: ResearchRunnerClient,
  config: BacktestConfigLike,
): Promise<{
  estimate?: ResearchRunnerCostEstimate;
  message: string;
  error?: string;
}> {
  if (typeof client.estimateBacktestCost !== 'function') {
    return {
      message:
        'Pre-flight cost estimate skipped — client does not support estimateBacktestCost.',
    };
  }
  if (!config.range) {
    return {
      message:
        'Pre-flight cost estimate skipped — backtest config has no explicit range.',
    };
  }

  try {
    const response = await client.estimateBacktestCost({
      timeframe: config.timeframe as Timeframe,
      startTs: config.range.start,
      endTs: config.range.end,
      ...(config.signalInstrument?.symbol
        ? { symbol: config.signalInstrument.symbol }
        : {}),
    });

    const estimate: ResearchRunnerCostEstimate = {
      estimatedCostUsd: response.estimatedCostUsd,
      currentBalanceUsd: response.currentBalanceUsd,
      afterBalanceUsd: response.afterBalanceUsd,
      wouldCauseOverage: response.wouldCauseOverage,
      overageAmountUsd: response.overageAmountUsd,
    };

    const message = response.wouldCauseOverage
      ? `Pre-flight cost estimate $${response.estimatedCostUsd.toFixed(4)} exceeds remaining $${response.currentBalanceUsd.toFixed(2)} (overage $${response.overageAmountUsd.toFixed(4)}). Backend may reject runBacktest depending on tier.`
      : `Pre-flight cost estimate $${response.estimatedCostUsd.toFixed(4)}; remaining $${response.currentBalanceUsd.toFixed(2)} → projected $${response.afterBalanceUsd.toFixed(2)}.`;

    return { estimate, message };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return {
      message: `Pre-flight cost estimate failed; continuing without it. Detail: ${detail}`,
      error: detail,
    };
  }
}

function isCompletedRound(
  round: Partial<ResearchRunnerRound>,
): round is CompletedRound {
  return (
    round.status === 'completed' &&
    round.score !== undefined &&
    round.backtest !== undefined
  );
}

export function selectChampionRound(
  rounds: readonly Partial<ResearchRunnerRound>[],
): ResearchRunnerRound | undefined {
  const completed = rounds.filter(isCompletedRound);

  return completed.sort((left, right) => {
    const scoreDelta = right.score.total - left.score.total;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const leftDrawdown = metric(left.backtest.summary, 'maxDrawdown');
    const rightDrawdown = metric(right.backtest.summary, 'maxDrawdown');
    const drawdownDelta = leftDrawdown - rightDrawdown;
    if (drawdownDelta !== 0) {
      return drawdownDelta;
    }

    return (
      metric(right.backtest.summary, 'totalPositions') -
      metric(left.backtest.summary, 'totalPositions')
    );
  })[0];
}

class ProducerTimeoutError extends Error {
  constructor(timeoutMs: number, kind: 'draft' | 'repair') {
    super(
      `${kind === 'draft' ? 'Draft' : 'Repair'} producer did not return within ${timeoutMs}ms.`,
    );
    this.name = 'ProducerTimeoutError';
  }
}

type RoundPhase =
  | 'draft'
  | 'repair'
  | 'persist'
  | 'backtest_queue'
  | 'backtest_wait';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractIssuesFromError(error: unknown): ValidationIssueLike[] {
  if (!(error instanceof TraseqApiError)) {
    return [];
  }
  const body = error.parsedBody;
  if (!body || !Array.isArray(body.issues)) {
    return [];
  }
  return body.issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    ...(issue.field ? { field: issue.field } : {}),
    message: issue.message,
    ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    ...(issue.severity ? { severity: issue.severity } : {}),
    ...(issue.details ? { details: issue.details } : {}),
    ...(issue.blockA ? { blockA: issue.blockA } : {}),
    ...(issue.blockB ? { blockB: issue.blockB } : {}),
  }));
}

function isBacktestTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out after/i.test(error.message);
}

function stopReasonForPhase(phase: RoundPhase, error: unknown): string {
  if (phase === 'draft' || phase === 'repair') {
    return error instanceof ProducerTimeoutError
      ? 'producer_timeout'
      : 'producer_error';
  }
  if (phase === 'persist') {
    return 'persistence_failed';
  }
  return isBacktestTimeoutError(error) ? 'backtest_timeout' : 'backtest_failed';
}

async function callWithTimeout<T>(
  fn: (signal: AbortSignal) => T | Promise<T>,
  timeoutMs: number,
  kind: 'draft' | 'repair',
): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProducerTimeoutError(timeoutMs, kind));
      controller.abort();
    }, timeoutMs);

    Promise.resolve()
      .then(() => fn(controller.signal))
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
  });
}

export async function runResearchRunner(
  options: ResearchRunnerOptions,
): Promise<ResearchRunnerResult> {
  const input = normalizeRequest(options.input);
  const runId = randomUUID();
  const startedAt = toIsoNow();
  const client = options.client ?? createClient();
  const maxRepairAttempts =
    options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const producerTimeoutMs =
    options.producerTimeoutMs ?? DEFAULT_PRODUCER_TIMEOUT_MS;

  let manifest: unknown;
  let workspace: unknown;
  let usage: unknown;
  let capabilities: unknown;
  try {
    [manifest, workspace, usage, capabilities] = await Promise.all([
      client.getManifest(),
      client.getWorkspaceContext(),
      client.getUsage(),
      client.getCapabilities(),
    ]);
  } catch (caught) {
    return completeResult({
      runId,
      startedAt,
      input,
      live: {
        manifest: {},
        workspace: {},
        usage: {},
        capabilities: {},
        capabilitySummary: {},
      },
      rounds: [],
      stopReason: 'context_failed',
      errors: [errorMessage(caught)],
    });
  }

  const live: ResearchRunnerLiveContext = {
    manifest,
    workspace,
    usage,
    capabilities,
    capabilitySummary: capabilitySummary(capabilities),
  };

  const rounds: ResearchRunnerRound[] = [];
  // Allow callers to continue iterating on an existing strategy. When set, the
  // first round skips `createStrategy` and persists as a new version, matching
  // the multi-round versioning path that subsequent rounds already use.
  let strategyId: string | undefined = options.strategyId;
  // Seed the lineage chain so callers resuming on an existing strategy can
  // record the prior finalized version as round 1's parent. Ignored when
  // `strategyId` is absent — a brand-new strategy has nothing to fork from.
  let previousFinalizedVersionId: string | undefined =
    options.strategyId && options.forkedFromVersionId
      ? options.forkedFromVersionId
      : undefined;

  for (let round = 1; round <= input.rounds; round++) {
    const logs: AgentStepLog[] = [
      createLog(round, 'draft', 'Requesting a strategy draft from producer.'),
    ];
    const context = createDraftContext(runId, round, input, live, rounds);
    let phase: RoundPhase = 'draft';
    let draft: StrategyDraftLike | undefined;
    let validation: ValidationSummaryLike | undefined;
    let validationAttempts = 0;
    // Hoisted out of `try` so the catch block can surface partial repair
    // records when a producer throws mid-loop (e.g. the third repair attempt
    // times out — the LLM still gets the first two attempts' before/after).
    const repairAttemptRecords: RepairAttemptRecord[] = [];

    try {
      draft = normalizeRunnerDraft(
        input,
        await callWithTimeout(
          (signal) => options.draftProducer(context, signal),
          producerTimeoutMs,
          'draft',
        ),
      );

      logs.push(
        createLog(round, 'validate', 'Validating strategy draft.', {
          validation: 1,
        }),
      );
      {
        const initial = await validateDraftForResearch(
          client,
          draft,
          live.capabilities,
        );
        // P-Vocab: pick up any draft mutations the validator made (vocabulary
        // normalization). Persist + backtest later use this `draft` reference,
        // so we want the cleaned version, not the producer's raw output.
        draft = initial.draft;
        validation = initial.validation;
      }
      validationAttempts = 1;
      let repairAttempts = 0;

      while (
        !validation.valid &&
        options.repairProducer &&
        repairAttempts < maxRepairAttempts
      ) {
        phase = 'repair';
        repairAttempts += 1;
        // Snapshot the pre-repair validation BEFORE re-running validate so the
        // record always pairs the issues the producer was asked to fix with the
        // issues that remained — even if the producer surfaces no patches, the
        // LLM can compare before/after to reason about whether to retry or pivot.
        const validationBefore = validation;
        logs.push(
          createLog(
            round,
            'repair',
            'Requesting a validation repair from producer.',
            { validation: validationAttempts, repair: repairAttempts },
          ),
        );
        const repairContext = createRepairContext(
          context,
          repairAttempts,
          draft,
          validation,
        );
        const repairProducer = options.repairProducer;
        draft = normalizeRunnerDraft(
          input,
          await callWithTimeout(
            (signal) => repairProducer(repairContext, signal),
            producerTimeoutMs,
            'repair',
          ),
        );
        validationAttempts += 1;
        logs.push(
          createLog(
            round,
            'validate',
            'Re-validating repaired strategy draft.',
            {
              validation: validationAttempts,
              repair: repairAttempts,
            },
          ),
        );
        {
          const repaired = await validateDraftForResearch(
            client,
            draft,
            live.capabilities,
          );
          draft = repaired.draft;
          validation = repaired.validation;
        }
        repairAttemptRecords.push({
          attempt: repairAttempts,
          validationBefore,
          validationAfter: validation,
        });
      }

      if (!validation.valid) {
        const validationIssues = flattenValidationIssues(validation);
        const errors = validationIssues.map(formatIssueMessage);
        logs.push(
          createLog(
            round,
            'stop',
            'Validation failed; no write or backtest calls were made.',
          ),
        );
        rounds.push({
          round,
          label: `Round ${round}`,
          objective: input.objective,
          inputPrompt: input.prompt,
          status: 'failed',
          draft,
          validation,
          validationAttempts,
          logs,
          stopReason: 'validation_failed',
          ...(errors.length > 0 ? { errors } : {}),
          ...(validationIssues.length > 0 ? { validationIssues } : {}),
          ...(repairAttemptRecords.length > 0
            ? { repairAttempts: repairAttemptRecords }
            : {}),
        });
        return completeResult({
          runId,
          startedAt,
          input,
          live,
          rounds,
          stopReason: 'validation_failed',
          errors,
          validationIssues,
          ...(repairAttemptRecords.length > 0
            ? { repairAttempts: repairAttemptRecords }
            : {}),
        });
      }

      phase = 'persist';
      const authoringPayload = buildAuthoringPayload(draft);
      let versionNumber: number | undefined;
      let createdStrategyVersionId: string | undefined;
      const forkedFromVersionId = previousFinalizedVersionId;

      if (!strategyId) {
        logs.push(createLog(round, 'create', 'Creating the initial strategy.'));
        const created = await client.createStrategy({
          name: draft.name,
          ...(draft.description ? { description: draft.description } : {}),
          ...authoringPayload,
        });
        strategyId = idFrom(created, 'createStrategy');
        versionNumber = versionNumberFrom(created);
      } else {
        logs.push(createLog(round, 'version', 'Creating a strategy revision.'));
        const createdVersion = await client.createStrategyVersion(strategyId, {
          ...authoringPayload,
          ...(forkedFromVersionId ? { forkedFromVersionId } : {}),
        });
        createdStrategyVersionId = asString(asJsonObject(createdVersion)?.id);
        versionNumber = versionNumberFrom(createdVersion);
      }

      logs.push(createLog(round, 'finalize', 'Finalizing strategy version.'));
      const finalized = await client.finalizeStrategyVersion(strategyId, {
        ...authoringPayload,
        ...(versionNumber !== undefined ? { version: versionNumber } : {}),
      });
      const finalizedStrategyVersionId = idFrom(
        finalized,
        'finalizeStrategyVersion',
      );

      const estimate = await tryEstimateBacktestCost(client, draft.backtest);
      logs.push(createLog(round, 'estimate', estimate.message));

      phase = 'backtest_queue';
      logs.push(createLog(round, 'backtest', 'Queueing backtest.'));
      const queuedBacktest = await client.runBacktest({
        strategyVersionId: finalizedStrategyVersionId,
        config: draft.backtest,
      });
      const backtestId = idFrom(queuedBacktest, 'runBacktest');

      phase = 'backtest_wait';
      logs.push(
        createLog(round, 'wait', 'Waiting for terminal backtest result.'),
      );
      const completedBacktest = await client.waitForBacktestCompletion(
        backtestId,
        {
          intervalMs: pollIntervalMs,
          timeoutMs,
        },
      );
      const backtest = normalizeBacktest(completedBacktest);
      const score: ScoreBreakdown = buildScoreBreakdown(backtest.summary);
      const analysis = analyzeRound({ score, backtest });

      rounds.push({
        round,
        label: `Round ${round}`,
        objective: input.objective,
        inputPrompt: input.prompt,
        status: 'completed',
        draft,
        validation,
        validationAttempts,
        createdStrategyId: strategyId,
        ...(createdStrategyVersionId ? { createdStrategyVersionId } : {}),
        finalizedStrategyVersionId,
        ...(forkedFromVersionId ? { forkedFromVersionId } : {}),
        ...(estimate.estimate ? { costEstimate: estimate.estimate } : {}),
        backtest,
        score,
        analysis,
        logs,
        ...(repairAttemptRecords.length > 0
          ? { repairAttempts: repairAttemptRecords }
          : {}),
      });
      previousFinalizedVersionId = finalizedStrategyVersionId;
    } catch (caught) {
      const stopReason = stopReasonForPhase(phase, caught);
      const message = errorMessage(caught);
      const errorIssues = extractIssuesFromError(caught);
      logs.push(
        createLog(
          round,
          'stop',
          `Stopped during ${phase}: ${stopReason}. ${message}`,
        ),
      );
      rounds.push({
        round,
        label: `Round ${round}`,
        objective: input.objective,
        inputPrompt: input.prompt,
        status: 'failed',
        ...(draft ? { draft } : {}),
        ...(validation ? { validation } : {}),
        validationAttempts,
        logs,
        stopReason,
        errors: [message],
        ...(errorIssues.length > 0 ? { validationIssues: errorIssues } : {}),
        ...(repairAttemptRecords.length > 0
          ? { repairAttempts: repairAttemptRecords }
          : {}),
      });
      return completeResult({
        runId,
        startedAt,
        input,
        live,
        rounds,
        stopReason,
        errors: [message],
        ...(errorIssues.length > 0 ? { validationIssues: errorIssues } : {}),
        ...(repairAttemptRecords.length > 0
          ? { repairAttempts: repairAttemptRecords }
          : {}),
      });
    }
  }

  return completeResult({
    runId,
    startedAt,
    input,
    live,
    rounds,
  });
}
