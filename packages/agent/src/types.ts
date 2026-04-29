import type {
  BacktestConfig as SdkBacktestConfig,
  TraseqClient as SdkTraseqClient,
  StrategySettings as SdkStrategySettings,
} from '@traseq/sdk';

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
  message: string;
  suggestion?: string;
  severity?: 'error' | 'warning';
  details?: string;
}

export interface ValidationSummaryLike {
  valid: boolean;
  summary: { errors: number; warnings: number };
  issues: {
    tokens?: ValidationIssueLike[];
    settings?: ValidationIssueLike[];
    conflicts?: ValidationIssueLike[];
  };
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
  live: AutoAgentResearchResult['live'];
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
  | 'runBacktest'
  | 'waitForBacktestCompletion'
>;

export interface ResearchRunnerLiveContext {
  manifest: unknown;
  workspace: unknown;
  usage: unknown;
  capabilities: unknown;
  capabilitySummary: JsonObject;
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
}

export interface GuidedResearchRoundInput extends ResearchEngagementInput {
  draft: StrategyDraftLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
  producerTimeoutMs?: number;
}

export interface GuidedResearchEvidence {
  completedRounds: number;
  totalRounds: number;
  championRound?: number;
  riskFlagCount: number;
  headline: string;
}

export interface GuidedResearchRoundResult {
  status: ResearchRunnerStatus;
  serviceMessages: ServiceMessage[];
  evidence: GuidedResearchEvidence;
  verdict: ResearchVerdict;
  result: ResearchRunnerResult;
  evaluation: ResearchResultEvaluation;
  report: string;
}

export interface ResearchRunnerRound {
  round: number;
  label: string;
  objective: string;
  inputPrompt: string;
  status: ResearchRunnerStatus;
  draft: StrategyDraftLike;
  validation: ValidationSummaryLike;
  validationAttempts: number;
  createdStrategyId?: string;
  createdStrategyVersionId?: string;
  finalizedStrategyVersionId?: string;
  forkedFromVersionId?: string;
  backtest?: NormalizedBacktestResult;
  score?: ScoreBreakdown;
  analysis?: RoundAnalysis;
  logs: AgentStepLog[];
  stopReason?: string;
  errors?: string[];
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
  stopReason?: string;
  errors?: string[];
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
  stopReasons: string[];
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
    capabilitySummary: JsonObject;
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
