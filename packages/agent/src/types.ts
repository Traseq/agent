import type {
  BacktestConfig as SdkBacktestConfig,
  TraseqClient as SdkTraseqClient,
  StrategySettings as SdkStrategySettings,
  InstrumentResolution,
} from '@traseq/sdk';

import type { UsageStatus } from './usage-hints.js';

export type SectionName = 'skill' | 'tools' | 'references' | 'templates';

export interface AgentContextOptions {
  sections?: readonly SectionName[];
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  thesis: string;
  adaptationHints: string[];
  draft: {
    name: string;
    description: string;
    signalGraph: {
      protocol: 'traseq.signal-graph';
      version: 2;
      nodes: readonly Record<string, unknown>[];
      strategy: Record<string, unknown>;
    };
    settings: Record<string, unknown>;
    backtest: {
      timeframe: string;
      signalInstrument: { symbol: string };
      initialBalance: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Research / operational types
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type Timeframe = '15m' | '1h' | '4h' | '1d';

export type StrategySettings = SdkStrategySettings;

export interface BacktestRange {
  start: number;
  end: number;
}

export type AmbiguityResolution =
  | 'multi_resolution'
  | 'pessimistic'
  | 'bar_direction'
  | 'distance';

export type BacktestConfigLike = SdkBacktestConfig;

export interface StrategyDraftLike {
  name: string;
  description?: string;
  signalGraph: JsonObject;
  settings: StrategySettings;
  backtest: BacktestConfigLike;
}

export interface ValidationIssueLike {
  code?: string;
  path?: string;
  field?: string;
  message: string;
  suggestion?: string;
  severity?: 'error' | 'warning';
  gate?: 'schema' | 'draft_save' | 'finalize' | 'backtest_config';
  details?: string;
  blockA?: { id: string; name: string };
  blockB?: { id: string; name: string };
}

export interface ValidationSummaryLike {
  valid: boolean;
  summary: { errors: number; warnings: number };
  issues: {
    signalGraph?: ValidationIssueLike[];
    settings?: ValidationIssueLike[];
    conflicts?: ValidationIssueLike[];
  };
}

// P2-H: per-repair-attempt record so the LLM can see "we already tried these
// fixes and they did/didn't change the issue set" instead of duplicating work
// the runner already attempted. Captured even on success so callers can audit
// how many repairs the producer needed.
export interface RepairAttemptRecord {
  attempt: number;
  validationBefore: ValidationSummaryLike;
  validationAfter: ValidationSummaryLike;
}

export interface ScoreBreakdown {
  total: number;
  returnScore: number;
  sharpeScore: number;
  profitFactorScore: number;
  drawdownPenalty: number;
  consistencyScore: number;
  activityScore: number;
  notes: string[];
}

export interface ResearchChange {
  category:
    | 'entry'
    | 'exit'
    | 'risk'
    | 'filter'
    | 'positioning'
    | 'backtest'
    | 'other';
  title: string;
  before: string;
  after: string;
  reason: string;
  expectedImpact: string;
}

export interface RoundAnalysis {
  thesis: string;
  strengths: string[];
  weaknesses: string[];
  decision: string;
  changeLog: ResearchChange[];
  nextPrompt: string;
  nextSettings?: StrategySettings;
  nextBacktest?: Partial<
    Omit<BacktestConfigLike, 'timeframe' | 'signalInstrument'>
  >;
}

export interface AgentStepLog {
  at: string;
  round: number;
  source: 'system' | 'agent';
  step: string;
  message: string;
  validationAttempt?: number;
  repairAttempt?: number;
}

// Mirrors the public API contract one-to-one. The four backtest links are
// always present; strategy links exist only when the backtest is tied to a
// strategy version (always true today, modeled as optional for forward-safety).
export interface NormalizedBacktestAppLinks {
  backtest: string;
  backtestCharts: string;
  backtestTrades: string;
  backtestAnalytics: string;
  strategy?: string;
  strategyBacktests?: string;
}

export interface NormalizedBacktestInstrument {
  symbol: string | null;
  venue: string | null;
  marketType: string | null;
}

export interface NormalizedBacktestRange {
  start: number | string | null;
  end: number | string | null;
}

export interface NormalizedBacktestRunContext {
  instrument: NormalizedBacktestInstrument;
  timeframe: string | null;
  range: NormalizedBacktestRange | null;
  initialBalance: number | null;
  execution: JsonObject | null;
  strategyId: string | null;
  strategyVersionId: string | null;
  strategyVersionNumber: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface NormalizedBacktestResult {
  id: string;
  status: string;
  summary?: JsonObject;
  artifactUrls?: Record<string, string>;
  strategy?: JsonObject | null;
  appLinks: NormalizedBacktestAppLinks;
  runContext: NormalizedBacktestRunContext;
  raw: JsonObject;
}

export interface ResearchRound {
  round: number;
  label: string;
  objective: string;
  inputPrompt: string;
  appliedChanges: ResearchChange[];
  appliedRationale: string;
  draft: StrategyDraftLike;
  validation: ValidationSummaryLike;
  createdStrategyId: string;
  finalizedStrategyVersionId: string;
  backtest: NormalizedBacktestResult;
  score: ScoreBreakdown;
  analysis: RoundAnalysis;
  logs: AgentStepLog[];
}

export interface ResearchSummary {
  headline: string;
  championRound: number;
  championReason: string;
  topStrengths: string[];
  nextFocus: string[];
}

export interface AutoAgentRequest {
  prompt: string;
  instrument: string;
  timeframe: Timeframe;
  rounds: number;
  objective: string;
  initialBalance: number;
  warmupPeriod: number;
  positionStyle: 'single' | 'pyramid' | 'accumulate';
  maxConcurrentPositions: number;
}

export type ResearchRiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export const AUTHORING_PREFERENCE_VALUES = [
  'auto',
  'template',
  'block',
  'hybrid',
  'sg_v2',
] as const;
export type AuthoringPreference = (typeof AUTHORING_PREFERENCE_VALUES)[number];

export const RESEARCH_INTENT_MATURITY_VALUES = [
  'vague',
  'exploratory',
  'concrete',
  'expert',
] as const;
export type ResearchIntentMaturity =
  (typeof RESEARCH_INTENT_MATURITY_VALUES)[number];

export const RESEARCH_RECOMMENDED_MODE_VALUES = [
  'template',
  'block',
  'hybrid',
  'sg_v2',
] as const;
export type ResearchRecommendedMode =
  (typeof RESEARCH_RECOMMENDED_MODE_VALUES)[number];

export interface ResearchEngagementInput {
  prompt: string;
  instrument?: string;
  timeframe?: Timeframe;
  rounds?: number;
  objective?: string;
  initialBalance?: number;
  warmupPeriod?: number;
  positionStyle?: 'single' | 'pyramid' | 'accumulate';
  maxConcurrentPositions?: number;
  riskTolerance?: ResearchRiskTolerance;
  authoringPreference?: AuthoringPreference;
  /**
   * BCP-47 user locale (e.g. `en`, `zh-TW`). Set by callers that know the
   * user's UI language so downstream LLMs can render verdicts/risk text in
   * that language. Agent runtime is locale-neutral and does not translate
   * generated content; this field is propagated to the engagement brief and
   * surfaced as a service message for the upstream LLM to honour.
   */
  locale?: string;
}

export interface ServiceMessage {
  level: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  message: string;
  nextAction?: string;
  links?: NormalizedBacktestAppLinks;
}

export interface ResearchDecisionPoint {
  id: string;
  question: string;
  recommended: string;
  options: string[];
  required: boolean;
  rationale: string;
}

export interface ResearchEngagementBrief {
  runId: string;
  startedAt: string;
  completedAt: string;
  input: AutoAgentRequest;
  riskTolerance: ResearchRiskTolerance;
  assumptions: string[];
  serviceMessages: ServiceMessage[];
  decisionPoints: ResearchDecisionPoint[];
  authoringInstructions: string;
  intentMaturity: ResearchIntentMaturity;
  recommendedMode: ResearchRecommendedMode;
  recommendedToolPath: string[];
  fallbackToolPath: string[];
  referenceTools: string[];
  routingRationale: string;
  live: AutoAgentResearchResult['live'];
  usageStatus: UsageStatus;
  recommendedWorkflow: ResearchWorkflowStep[];
  evidenceBoundaries: string[];
}

export type ResearchRunnerStatus = 'completed' | 'partial' | 'failed';

export type ResearchContextClient = Pick<
  SdkTraseqClient,
  'getManifest' | 'getWorkspaceContext' | 'getUsage' | 'getCapabilities'
>;

export type ResearchRunnerClient = Pick<
  SdkTraseqClient,
  | 'getManifest'
  | 'getWorkspaceContext'
  | 'getUsage'
  | 'getCapabilities'
  | 'validateStrategy'
  | 'createStrategy'
  | 'createStrategyVersion'
  | 'finalizeStrategyVersion'
  | 'getStrategy'
  | 'runBacktest'
  | 'waitForBacktestCompletion'
> &
  // estimateBacktestCost is best-effort: callers may stub a client without it
  // (older SDKs, fixtures), so the runner falls back gracefully when absent.
  Partial<Pick<SdkTraseqClient, 'estimateBacktestCost'>>;

export interface ResearchRunnerLiveContext {
  manifest: unknown;
  workspace: unknown;
  usage: unknown;
  capabilities: unknown;
  capabilitySummary: JsonObject;
  instrumentResolution?: InstrumentResolution;
}

export interface ResearchDraftContext {
  runId: string;
  round: number;
  input: AutoAgentRequest;
  live: ResearchRunnerLiveContext;
  previousRounds: ResearchRunnerRound[];
  previousRound?: ResearchRunnerRound;
}

export interface ResearchRepairContext extends ResearchDraftContext {
  attempt: number;
  draft: StrategyDraftLike;
  validation: ValidationSummaryLike;
}

export interface ResearchRunnerOptions {
  input: unknown;
  client?: ResearchRunnerClient;
  draftProducer: (
    context: ResearchDraftContext,
    signal: AbortSignal,
  ) => StrategyDraftLike | Promise<StrategyDraftLike>;
  repairProducer?: (
    context: ResearchRepairContext,
    signal: AbortSignal,
  ) => StrategyDraftLike | Promise<StrategyDraftLike>;
  maxRepairAttempts?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  producerTimeoutMs?: number;
  /**
   * Continue iterating on an existing strategy. When set, the runner skips
   * `createStrategy` and persists each round's draft as a new
   * `createStrategyVersion` under this strategy. Omit to author a brand-new
   * strategy.
   */
  strategyId?: string;
  /**
   * Lineage seed for round 1 when iterating on an existing strategy. The
   * runner already chains `forkedFromVersionId` between rounds within a single
   * call; this lets callers preserve that chain across calls (e.g. resuming a
   * research session from a specific finalized version). Ignored when
   * `strategyId` is omitted, since a brand-new strategy has no prior version
   * to fork from.
   */
  forkedFromVersionId?: string;
}

export interface GuidedResearchRoundInput extends ResearchEngagementInput {
  draft: StrategyDraftLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
  producerTimeoutMs?: number;
  /**
   * Continue iterating on an existing strategy by passing its id. The runner
   * persists the validated draft as a new version under that strategy instead
   * of creating a new one. Omit to create a brand-new strategy.
   */
  strategyId?: string;
  /**
   * Optional lineage seed: the prior finalized version this round forks from.
   * Only meaningful alongside `strategyId`. Lets callers preserve the
   * `forkedFromVersionId` chain across separate guided-research calls.
   */
  forkedFromVersionId?: string;
}

export interface ResearchIterationSeed {
  strategyId: string;
  forkedFromVersionId: string;
  round: number;
  strategyVersionNumber?: number;
  backtestId?: string;
}

export interface GuidedResearchEvidence {
  completedRounds: number;
  totalRounds: number;
  championRound?: number;
  riskFlagCount: number;
  warningCount?: number;
  headline: string;
}

export interface GuidedResearchRoundResult {
  status: ResearchRunnerStatus;
  serviceMessages: ServiceMessage[];
  evidence: GuidedResearchEvidence;
  verdict: ResearchVerdict;
  usageStatus: UsageStatus;
  nextIterationSeed?: ResearchIterationSeed;
  result: ResearchRunnerResult;
  evaluation: ResearchResultEvaluation;
  report: string;
}

export interface ResearchRunnerCostEstimate {
  estimatedCostUsd: number;
  currentBalanceUsd: number;
  afterBalanceUsd: number;
  wouldCauseOverage: boolean;
  overageAmountUsd: number;
}

export interface ResearchRunnerFailure {
  phase:
    | 'context'
    | 'draft'
    | 'repair'
    | 'validate'
    | 'create_strategy'
    | 'create_strategy_version'
    | 'finalize_strategy_version'
    | 'run_backtest'
    | 'wait_backtest';
  reason:
    | 'context_failed'
    | 'producer_timeout'
    | 'producer_error'
    | 'validation_failed'
    | 'create_strategy_failed'
    | 'create_strategy_version_failed'
    | 'finalize_validation_failed'
    | 'finalize_confirmation_required'
    | 'duplicate_version'
    | 'backtest_failed'
    | 'backtest_timeout';
  operation?: string;
  statusCode?: number;
  message: string;
  category?: string;
  issues?: ValidationIssueLike[];
  warnings?: ValidationIssueLike[];
  requiresConfirmation?: boolean;
  publicAgent?: JsonObject;
  nextSteps?: readonly string[];
  apiBody?: JsonObject;
}

export interface ResearchRunnerRound {
  round: number;
  label: string;
  objective: string;
  inputPrompt: string;
  status: ResearchRunnerStatus;
  draft?: StrategyDraftLike;
  validation?: ValidationSummaryLike;
  validationAttempts: number;
  createdStrategyId?: string;
  createdStrategyVersionId?: string;
  finalizedStrategyVersionId?: string;
  finalizedStrategyVersionNumber?: number;
  forkedFromVersionId?: string;
  /**
   * Pre-flight cost estimate captured between finalize and runBacktest.
   * Absent when the SDK doesn't support it, the draft has no range, or the
   * estimate call fails — the round still proceeds (backend remains the
   * authoritative budget gate).
   */
  costEstimate?: ResearchRunnerCostEstimate;
  backtest?: NormalizedBacktestResult;
  score?: ScoreBreakdown;
  analysis?: RoundAnalysis;
  logs: AgentStepLog[];
  failure?: ResearchRunnerFailure;
  warnings?: ValidationIssueLike[];
  repairAttempts?: RepairAttemptRecord[];
}

export interface ResearchRunnerSummary {
  headline: string;
  completedRounds: number;
  totalRounds: number;
  championRound?: number;
  championReason?: string;
  topStrengths: string[];
  nextFocus: string[];
}

export interface ResearchRunnerResult {
  schemaVersion: number;
  runId: string;
  startedAt: string;
  completedAt: string;
  input: AutoAgentRequest;
  live: Omit<ResearchRunnerLiveContext, 'capabilities'>;
  rounds: ResearchRunnerRound[];
  summary: ResearchRunnerSummary;
  championRound?: number;
  status: ResearchRunnerStatus;
  nextIterationSeed?: ResearchIterationSeed;
  failure?: ResearchRunnerFailure;
  warnings?: ValidationIssueLike[];
  repairAttempts?: RepairAttemptRecord[];
}

export type ResearchConfidence = 'robust' | 'promising' | 'weak' | 'reject';

export type ResearchDecision =
  | 'continue_iterating'
  | 'keep_candidate'
  | 'rethink_thesis'
  | 'reject_candidate';

export interface ResearchRiskFlag {
  code: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  round?: number;
}

export interface ResearchEvidenceMetrics {
  returnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  totalPositions: number;
}

export interface ResearchWeakness {
  code: string;
  message: string;
}

export interface ResearchRoundEvaluation {
  round: number;
  status: ResearchRunnerStatus;
  confidence: ResearchConfidence;
  decision: ResearchDecision;
  metrics: ResearchEvidenceMetrics;
  score: ScoreBreakdown;
  riskFlags: ResearchRiskFlag[];
  strengths: string[];
  weaknesses: ResearchWeakness[];
}

export interface ResearchVerdict {
  decision: ResearchDecision;
  summary: string;
  nextAction: string;
}

export interface ResearchResultEvaluation {
  schemaVersion: number;
  runId?: string;
  status: ResearchRunnerStatus;
  confidence: ResearchConfidence;
  championRound?: number;
  rounds: ResearchRoundEvaluation[];
  riskFlags: ResearchRiskFlag[];
  failureReasons: string[];
  verdict: ResearchVerdict;
}

export interface ResearchArtifactFile {
  readonly path: string;
  readonly mediaType: 'application/json' | 'text/markdown';
  readonly contents: string;
}

export interface ResearchArtifactBundle {
  readonly root: string;
  readonly files: readonly ResearchArtifactFile[];
}

export interface ResearchWorkflowStep {
  phase: string;
  tools: string[];
  goal: string;
}

export interface AutoAgentResearchResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  input: AutoAgentRequest;
  live: {
    manifest: unknown;
    workspace: unknown;
    usage: unknown;
    capabilities?: unknown;
    capabilitySummary: JsonObject;
    instrumentResolution?: InstrumentResolution;
  };
  prompts: {
    authoring: string;
    revision: string;
  };
  recommendedWorkflow: ResearchWorkflowStep[];
  notes: string[];
}

export type ResearchStreamEvent =
  | { type: 'meta'; runId: string; startedAt: string; input: AutoAgentRequest }
  | {
      type: 'status';
      at: string;
      round?: number;
      phase: string;
      message: string;
    }
  | { type: 'step'; log: AgentStepLog }
  | { type: 'round_completed'; round: ResearchRound }
  | { type: 'completed'; result: AutoAgentResearchResult }
  | { type: 'error'; message: string; detail?: string };

export type EmitResearchEvent = (
  event: ResearchStreamEvent,
) => void | Promise<void>;

export interface AnalyzeRoundArgs {
  score: ScoreBreakdown;
  backtest: NormalizedBacktestResult;
}
