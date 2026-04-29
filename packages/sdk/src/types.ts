export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };
export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined
  | null;
export type QueryParams = Record<string, QueryValue>;

export type TraseqPublicAgentErrorCategory =
  | 'auth'
  | 'permission'
  | 'plan'
  | 'usage'
  | 'validation'
  | 'rate_limit'
  | 'runtime'
  | 'transient';

export interface TraseqPublicAgentLink {
  rel: 'api_keys' | 'billing_plan' | 'usage' | 'billing' | 'docs';
  label: string;
  href: string;
}

export interface TraseqPublicAgentMetadata {
  code: string;
  category: TraseqPublicAgentErrorCategory;
  severity: 'blocker' | 'warning';
  retryable: boolean;
  title: string;
  explanation: string;
  nextSteps: string[];
  links: TraseqPublicAgentLink[];
  usage?: {
    current: number;
    limit: number;
    remaining: number;
    unit: 'count' | 'usd';
  };
}

export interface TraseqPublicApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  errorCode?: string;
  path?: string;
  publicAgent?: TraseqPublicAgentMetadata;
  [key: string]: unknown;
}

export interface TraseqAgentErrorExplanation {
  status?: number;
  code: string;
  category: TraseqPublicAgentErrorCategory;
  retryable: boolean;
  title: string;
  explanation: string;
  nextSteps: string[];
  links: TraseqPublicAgentLink[];
  usage?: TraseqPublicAgentMetadata['usage'];
}

export type Timeframe = '15m' | '1h' | '4h' | '1d';
export type AmbiguityResolution =
  | 'multi_resolution'
  | 'pessimistic'
  | 'bar_direction'
  | 'distance';

export type PositionStyle = 'single' | 'pyramid' | 'accumulate';
export type AccumulationTriggerMode =
  | 'scheduled'
  | 'signal'
  | 'scheduled_and_signal';
export type AccumulationScheduleCadence = 'daily' | 'weekly' | 'monthly';

export interface AccumulationSchedule {
  cadence: AccumulationScheduleCadence;
  interval?: number;
  weekday?: number;
  dayOfMonth?: number;
  anchorMode?: 'backtest_start';
}

export interface AccumulationSettings {
  triggerMode: AccumulationTriggerMode;
  schedule?: AccumulationSchedule;
  maxAdds?: number;
  budgetCap?: number;
  targetAllocationPct?: number;
  stopWhenNoCash?: boolean;
}

export interface SinglePositionSettings {
  positionStyle: 'single';
  warmupPeriod?: number;
}

export interface PyramidPositionSettings {
  positionStyle: 'pyramid';
  warmupPeriod?: number;
  maxConcurrentPositions: number;
}

export interface AccumulatePositionSettings {
  positionStyle: 'accumulate';
  warmupPeriod?: number;
  accumulation: AccumulationSettings;
}

export type StrategySettings =
  | SinglePositionSettings
  | PyramidPositionSettings
  | AccumulatePositionSettings;

export interface BacktestRange {
  start: number;
  end: number;
}

export interface ExecutionFeeTier {
  minCumulativeNotional: number;
  makerRate: number;
  takerRate: number;
}

export type BacktestSlippage =
  | { kind: 'none' }
  | {
      kind: 'fixed';
      unit: 'bps' | 'ticks';
      value: number;
    }
  | {
      kind: 'volatility_scaled';
      reference: 'atr_pct' | 'bar_range_pct';
      multiplier: number;
      atrPeriod?: number;
      minBps?: number;
      maxBps?: number;
    };

export interface BacktestExecution {
  entryOrderRole?: 'maker' | 'taker';
  exitOrderRole?: 'maker' | 'taker';
  riskOrderRole?: 'maker' | 'taker';
  feeModel?: {
    kind: 'tiered_maker_taker';
    tiers: ExecutionFeeTier[];
  };
  slippage?: BacktestSlippage;
}

export interface PortfolioRisk {
  maxDrawdown?: number;
  maxDailyLoss?: number;
  maxGrossExposure?: number;
  maxMarginUtilization?: number;
}

export interface BacktestConfig {
  timeframe: Timeframe;
  signalInstrument: {
    symbol: string;
  };
  range?: BacktestRange;
  initialBalance?: number;
  execution?: BacktestExecution;
  portfolioRisk?: PortfolioRisk;
  ambiguityResolution?: AmbiguityResolution;
  ambiguityFallback?: Exclude<AmbiguityResolution, 'multi_resolution'>;
}

export interface BacktestAppLinks extends JsonObject {
  backtest: string;
  backtestCharts: string;
  backtestTrades: string;
  backtestAnalytics: string;
  strategy?: string;
  strategyBacktests?: string;
}

export interface BacktestRunContextInstrument extends JsonObject {
  symbol: string | null;
  venue: string | null;
  marketType: string | null;
}

export interface BacktestRunContextRange extends JsonObject {
  start: number | string | null;
  end: number | string | null;
}

export interface BacktestRunContext extends JsonObject {
  instrument: BacktestRunContextInstrument;
  timeframe: string | null;
  range: BacktestRunContextRange | null;
  initialBalance: number | null;
  execution: JsonObject | null;
  strategyId: string | null;
  strategyVersionId: string | null;
  strategyVersionNumber: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SignalGraphAuthoringPayload {
  signalGraph: JsonObject;
  settings: StrategySettings;
}

export interface StrategyAstAuthoringPayload {
  strategyAst: JsonObject;
  settings: StrategySettings;
}

export type StrategyAuthoringPayload =
  | SignalGraphAuthoringPayload
  | StrategyAstAuthoringPayload;

export interface StrategyDraft extends SignalGraphAuthoringPayload {
  name: string;
  description?: string;
  backtest: BacktestConfig;
}

export interface TraseqValidationIssue {
  code?: string;
  path?: string;
  message: string;
  suggestion?: string;
  severity?: 'error' | 'warning';
  details?: string;
}

export interface TraseqValidationResponse {
  valid: boolean;
  subscriptionTier?: string;
  summary: {
    errors: number;
    warnings: number;
  };
  issues: {
    tokens?: TraseqValidationIssue[];
    settings?: TraseqValidationIssue[];
    conflicts?: TraseqValidationIssue[];
  };
}

export interface StrategyVersionSummary extends JsonObject {
  id?: string;
  version: number;
  status?: string;
}

export type CreateStrategyRequest = StrategyAuthoringPayload & {
  name: string;
  description?: string;
};

export interface UpdateStrategyRequest {
  name?: string;
  description?: string | null;
  status?: string;
}

export interface CreateStrategyResponse extends JsonObject {
  id: string;
  versions?: StrategyVersionSummary[];
}

export type FinalizeStrategyVersionRequest = StrategyAuthoringPayload & {
  version?: number;
  ignoreWarnings?: boolean;
  forkedFromVersionId?: string;
};

export type CreateStrategyVersionRequest = StrategyAuthoringPayload & {
  forkedFromVersionId?: string;
};

export type UpdateStrategyVersionRequest = Partial<StrategyAuthoringPayload> & {
  settings?: StrategySettings;
};

export interface FinalizeStrategyVersionResponse extends JsonObject {
  id: string;
  version: number;
  status: string;
}

export interface RunBacktestRequest {
  strategyVersionId: string;
  config: BacktestConfig;
}

export interface BacktestResult extends JsonObject {
  summaryJson?: JsonObject;
  artifactUrls?: Record<string, string>;
}

export interface RunBacktestResponse extends JsonObject {
  id: string;
  status: string;
  strategyVersionId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  configJson: JsonObject;
  appLinks: BacktestAppLinks;
  runContext: BacktestRunContext;
  warnings?: string[];
}

export interface BacktestDetail extends JsonObject {
  id: string;
  status: string;
  strategyVersionId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  configJson: JsonObject;
  result: BacktestResult | null;
  strategy: JsonObject | null;
  appLinks: BacktestAppLinks;
  runContext: BacktestRunContext;
}

export interface StrategyDetail extends JsonObject {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  versions?: JsonObject[];
}

export interface StrategyVersionDetail extends JsonObject {
  id: string;
  version: number;
  status?: string;
  metadata?: JsonObject;
}

export interface ListStrategiesQuery extends QueryParams {
  status?: string;
  page?: number;
  limit?: number;
  search?: string;
  includeMetadata?: boolean;
}

export interface ListBacktestsQuery extends QueryParams {
  status?: string;
  strategyId?: string;
  strategyVersionId?: string;
  search?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface BacktestListResponse extends JsonObject {
  data?: BacktestDetail[];
  pagination?: JsonObject;
}

export interface SystemStrategyDetail extends JsonObject {
  key?: string;
  name?: string;
  description?: string | null;
}

export interface SystemStrategyListResponse extends JsonObject {
  data?: SystemStrategyDetail[];
  pagination?: JsonObject;
}

export interface ListSystemStrategiesQuery extends QueryParams {
  category?: string;
  search?: string;
  tags?: string | readonly string[];
}

export interface PineExportRequest {
  validationMode?: 'compatible' | 'exact_only';
  strategyName?: string;
}

export type ChartDataResponse = JsonObject;

export interface RobustnessAnalysisRequest {
  sourceBacktestId: string;
  preset?: 'core_v1';
}

export interface RobustnessAnalysisPreview extends JsonObject {
  preset?: 'core_v1';
  sourceBacktestId?: string;
  scenarioCount?: number;
  estimatedCostUsd?: number;
}

export interface AnalysisRunDetail extends JsonObject {
  id: string;
  status?: string;
}

export interface AnalysisRunListResponse extends JsonObject {
  data?: AnalysisRunDetail[];
  pagination?: JsonObject;
}

export interface ListAnalysisRunsQuery extends QueryParams {
  status?:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'partial_failed'
    | 'failed'
    | 'all';
  page?: number;
  limit?: number;
}

export interface ComparisonSetRequest {
  name: string;
  notes?: string | null;
  backtestIds: string[];
}

export interface ComparisonSetDetail extends JsonObject {
  id: string;
  name?: string;
  notes?: string | null;
}

export interface ComparisonSetListResponse extends JsonObject {
  data?: ComparisonSetDetail[];
  pagination?: JsonObject;
}

export interface ListComparisonSetsQuery extends QueryParams {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'backtestCount';
  sortOrder?: 'asc' | 'desc';
}

export interface BlockRequest extends JsonObject {
  name: string;
  description?: string;
  type?: 'signal' | 'indicator';
  category?:
    | 'Signals'
    | 'Trend'
    | 'Momentum'
    | 'Volatility'
    | 'Volume'
    | 'Market';
  tokens?: JsonValue[];
  tags?: string[];
  indicatorFamily?: string;
  direction?: 'bullish' | 'bearish' | 'neutral';
  exclusiveGroup?: string;
  ignoreWarnings?: boolean;
}

export interface BlockDetail extends JsonObject {
  id: string;
  name?: string;
}

export interface BlockListResponse extends JsonObject {
  data?: BlockDetail[];
  pagination?: JsonObject | null;
  categoryCounts?: JsonObject;
}

export interface ListBlocksQuery extends QueryParams {
  filter?: 'system' | 'custom' | 'all' | 'pinned';
  search?: string;
  tags?: string | readonly string[];
  type?: 'signal' | 'indicator';
  category?:
    | 'Signals'
    | 'Trend'
    | 'Momentum'
    | 'Volatility'
    | 'Volume'
    | 'Market';
  page?: number;
  limit?: number;
}

export interface WorkspaceUsageSummary extends JsonObject {
  billingPeriod?: JsonObject;
  budget?: JsonObject;
  limits?: JsonObject;
}

export interface PublicManifest extends JsonObject {
  name?: string;
  version?: string;
  basePath?: string;
}

export interface WorkspaceContext extends JsonObject {
  workspace?: JsonObject;
  apiKey?: JsonObject | null;
  subscription?: JsonObject;
}

export type CapabilityDocument = JsonObject;
