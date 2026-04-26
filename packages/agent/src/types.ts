import type {
  BacktestConfig as SdkBacktestConfig,
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
  attempt?: number;
}

export interface NormalizedBacktestResult {
  id: string;
  status: string;
  summary?: JsonObject;
  artifactUrls?: Record<string, string>;
  strategy?: JsonObject | null;
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
