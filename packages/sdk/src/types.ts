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
  rel:
    | 'api_keys'
    | 'billing_plan'
    | 'usage'
    | 'billing'
    | 'docs'
    | 'manage_strategies'
    | 'manage_backtests';
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
  /**
   * Backend i18n / domain error identifier (e.g. `validation_failed`,
   * `STRATEGY_NOT_FINALIZED`). `publicAgent.code` is the preferred public
   * contract; this field is the secondary signal still emitted by the
   * NestJS exception filter and Zod validation pipe.
   */
  errorCode?: string;
  path?: string;
  valid?: boolean;
  summary?: {
    errors: number;
    warnings: number;
  };
  issues?: TraseqValidationIssue[];
  publicAgent?: TraseqPublicAgentMetadata;
  [key: string]: unknown;
}

export interface TokenDto {
  type: string;
  params?: JsonObject;
}

export type SemanticBlockRole =
  | 'entry_trigger'
  | 'context_filter'
  | 'confirmation_filter'
  | 'exit';

export type SemanticBlockType = 'signal' | 'indicator';

export type SemanticBlockCategory =
  | 'Signals'
  | 'Trend'
  | 'Momentum'
  | 'Volatility'
  | 'Volume'
  | 'Market';

export interface SemanticBlock {
  id: string;
  name: string;
  description?: string | null;
  type?: SemanticBlockType | null;
  category?: SemanticBlockCategory | null;
  tokens: TokenDto[];
  tags?: string[];
  isSystemPreset?: boolean;
  presetKey?: string | null;
  indicatorFamily?: string | null;
  direction?: 'bullish' | 'bearish' | 'neutral' | null;
  exclusiveGroup?: string | null;
  isPinned?: boolean;
  pinnedAt?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ListBlocksQuery extends QueryParams {
  filter?: 'system' | 'custom' | 'all' | 'pinned';
  search?: string;
  tags?: string | readonly string[];
  type?: SemanticBlockType;
  category?: SemanticBlockCategory;
  page?: number;
  limit?: number;
}

export interface BlockListResponse {
  data: SemanticBlock[];
  pagination?: JsonObject | null;
  categoryCounts?: Record<string, number>;
}

export interface TokenBlockCompileRequest {
  tokens: TokenDto[];
  role?: SemanticBlockRole;
  name?: string;
  description?: string;
}

export interface TokenBlockCompileResponse {
  valid: boolean;
  role: SemanticBlockRole;
  tokens: TokenDto[];
  fragment?: {
    nodes: JsonObject[];
    assemblyHints: JsonObject;
    settingsHints?: JsonObject;
  };
  issues: TraseqValidationIssue[];
}

export interface CreateBlockRequest {
  name: string;
  description?: string;
  type?: SemanticBlockType;
  category?: SemanticBlockCategory;
  tokens: TokenDto[];
  tags?: string[];
  indicatorFamily?: string;
  direction?: 'bullish' | 'bearish' | 'neutral';
  exclusiveGroup?: string;
  ignoreWarnings?: boolean;
}

export type UpdateBlockRequest = Partial<CreateBlockRequest>;

export interface TokenGrammarDocument {
  protocol: 'traseq.token-grammar';
  version: number;
  hash: string;
  subscriptionTier?: string;
  canonical: JsonObject;
  endpoints: JsonObject;
  roles: SemanticBlockRole[];
  tokenCategories: string[];
  tokenTypes: Array<{
    type: string;
    category: 'value' | 'bool_condition' | 'logic' | 'action' | 'structural';
    authorableInBlocks: boolean;
    nonAuthorableReason?: string;
  }>;
  blockForbiddenTokenTypes?: string[];
  ast: JsonObject;
  operators: JsonObject;
  enums: JsonObject;
  indicators: JsonObject[];
  constraints: JsonObject;
  limits?: JsonObject;
  notes: string[];
}

export interface TokenGrammarMaterializeRequest {
  role?: SemanticBlockRole;
  ast?: JsonObject;
  expr?: JsonObject;
  includeFragment?: boolean;
}

export interface TokenGrammarValidateRequest extends TokenGrammarMaterializeRequest {
  tokens?: TokenDto[];
}

export interface TokenGrammarResult {
  valid: boolean;
  role: SemanticBlockRole;
  source?: 'ast' | 'expr' | 'tokens';
  tokens: TokenDto[];
  normalizedAst?: JsonObject;
  fragment?: TokenBlockCompileResponse['fragment'];
  issues: TraseqValidationIssue[];
  grammarVersion?: number;
  grammarHash?: string;
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
  /**
   * Lot-matching policy applied when an accumulate cycle exits. Defaults to
   * 'fifo'. Only meaningful for accumulate positions that can hold multiple
   * lots.
   */
  exitLotMatching?: 'fifo' | 'lifo' | 'weighted_average';
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
  /**
   * Maximum number of parallel accumulate cycles. Defaults to 1 (one cycle at
   * a time, identical to the original behavior). Values above 1 let a new
   * cycle start before the previous one has fully exited.
   */
  maxConcurrentPositions?: number;
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

export type StrategyAuthoringPayload = SignalGraphAuthoringPayload;

export interface StrategyDraft extends SignalGraphAuthoringPayload {
  name: string;
  description?: string;
  backtest: BacktestConfig;
}

export interface TraseqValidationIssue {
  code: string;
  path: string;
  field?: string;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
  gate?: 'schema' | 'draft_save' | 'finalize' | 'backtest_config';
  details?: string;
  blockA?: { id: string; name: string };
  blockB?: { id: string; name: string };
}

export interface TraseqValidationResponse {
  valid: boolean;
  subscriptionTier?: string;
  summary: {
    errors: number;
    warnings: number;
  };
  issues: TraseqValidationIssue[];
}

export type SignalConditionRole = 'entry_condition' | 'exit_condition';
export type SignalTriggerPolicy = 'rising_edge' | 'every_closed_bar_true';
export type SignalMonitorStatus = 'active' | 'paused' | 'archived';
export type SignalEventType = 'strategy.condition.satisfied';
export type WebhookEndpointStatus = 'active' | 'disabled' | 'archived';

export interface CreateSignalMonitorRequest {
  strategyVersionId: string;
  symbol: string;
  timeframe: Timeframe;
  conditionRole: SignalConditionRole;
  triggerPolicy?: SignalTriggerPolicy;
  metadata?: JsonObject;
}

export interface UpdateSignalMonitorRequest {
  status?: SignalMonitorStatus;
  triggerPolicy?: SignalTriggerPolicy;
  metadata?: JsonObject | null;
}

export interface ListSignalMonitorsQuery extends QueryParams {
  status?: SignalMonitorStatus;
  strategyVersionId?: string;
  symbol?: string;
  timeframe?: Timeframe;
  limit?: number;
  cursor?: string;
}

export interface SignalMonitor {
  id: string;
  strategyVersionId: string;
  strategyVersion?: {
    id: string;
    version: number;
    contentHash: string;
    strategy: {
      id: string;
      name: string;
    };
  };
  symbol: string;
  timeframe: Timeframe;
  conditionRole: SignalConditionRole;
  triggerPolicy: SignalTriggerPolicy;
  status: SignalMonitorStatus;
  evaluationMode: 'closed_bar';
  metadata?: JsonValue;
  state: {
    lastEvaluatedBarTs: number | null;
    lastConditionValue: boolean | null;
    lastEventId: string | null;
    lastSkipReason: string | null;
    updatedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignalMonitorListResponse {
  data: SignalMonitor[];
  nextCursor: string | null;
}

export interface SignalEventPayload {
  id: string;
  type: SignalEventType;
  createdAt: string;
  monitor: {
    id: string;
    triggerPolicy: SignalTriggerPolicy;
  };
  strategy: {
    versionId: string;
    hash: string;
  };
  condition: {
    role: SignalConditionRole;
  };
  market: {
    symbol: string;
    timeframe: Timeframe;
    barOpenTs: number;
    barCloseTs: number;
  };
  evaluation: {
    mode: 'closed_bar';
  };
}

/**
 * Top-level columns on SignalEvent are denormalized copies of fields inside
 * `payload`. Both views are kept in sync by the server. When wiring an
 * adapter, prefer the typed top-level fields for queries/joins and use
 * `payload` only when forwarding the raw signed body downstream.
 */
export interface SignalEvent {
  id: string;
  type: SignalEventType;
  monitorId: string;
  strategyVersionId: string;
  strategyHash: string;
  evaluationStatus: 'evaluated' | 'skipped' | 'failed';
  symbol: string;
  timeframe: Timeframe;
  conditionRole: SignalConditionRole;
  triggerPolicy: SignalTriggerPolicy;
  barOpenTs: number;
  barCloseTs: number;
  payload: SignalEventPayload;
  createdAt: string;
}

export interface ListSignalEventsQuery extends QueryParams {
  cursor?: string;
  limit?: number;
  monitorId?: string;
}

export interface SignalEventListResponse {
  data: SignalEvent[];
  nextCursor: string | null;
}

export interface CreateWebhookEndpointRequest {
  url: string;
  eventTypes?: SignalEventType[];
  description?: string;
}

export interface UpdateWebhookEndpointRequest {
  url?: string;
  status?: WebhookEndpointStatus;
  eventTypes?: SignalEventType[];
  description?: string | null;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  status: WebhookEndpointStatus;
  eventTypes: SignalEventType[];
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookEndpointResponse {
  endpoint: WebhookEndpoint;
  /**
   * The HMAC signing secret. Returned only on creation; never stored in
   * plaintext on the server. Persist this in your secret manager — it is
   * not retrievable after this response.
   */
  secret: string;
}

export interface WebhookEndpointListResponse {
  data: WebhookEndpoint[];
}

export interface WebhookEndpointTestResponse {
  ok: boolean;
  status: number;
  eventId: string;
  deliveryId: string;
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
  primaryVersionId?: string;
}

export interface ConfirmStrategyLifecycleRequest extends JsonObject {
  confirm: true;
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
  status?: 'active' | 'trashed';
  trashedAt?: string | null;
  versions?: JsonObject[];
}

export interface StrategyVersionDetail extends JsonObject {
  id: string;
  version: number;
  status?: string;
  metadata?: JsonObject;
}

export interface ListStrategiesQuery extends QueryParams {
  status?: 'active' | 'trashed' | 'all';
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
  category?: string;
  tags?: string[];
  signalGraph?: JsonObject | null;
  settings?: JsonObject;
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

export interface WorkspaceUsageSummary extends JsonObject {
  billingPeriod?: JsonObject;
  budget?: JsonObject;
  limits?: JsonObject;
}

/**
 * Input for `TraseqClient.estimateBacktestCost`. Mirrors the backend
 * `EstimateCostDto` shape — must include the same `timeframe`/`startTs`/`endTs`
 * the actual `runBacktest` will use, otherwise the estimate diverges from
 * what the backend will actually charge.
 */
export interface BacktestCostEstimateInput extends JsonObject {
  timeframe: Timeframe;
  startTs: number;
  endTs: number;
  symbol?: string;
}

/**
 * Result of `TraseqClient.estimateBacktestCost`. Side-effect free; the agent
 * uses this to surface a budget warning before kicking off a round.
 *
 * `wouldCauseOverage` follows the same accounting the EntitlementGuard uses
 * at run time, so a `true` here corresponds to the same condition that fires
 * the `research_credits_insufficient` error on `runBacktest` for hard-block
 * tiers.
 */
export interface BacktestCostEstimate extends JsonObject {
  estimatedCostUsd: number;
  breakdown: JsonObject;
  estimatedCandleCount: number;
  currentBalanceUsd: number;
  afterBalanceUsd: number;
  wouldCauseOverage: boolean;
  overageAmountUsd: number;
}

export interface PublicManifest extends JsonObject {
  name?: string;
  version?: string;
  basePath?: string;
  /**
   * Absolute URL of the Traseq frontend bound to this API server. Agents must
   * derive every user-facing app deeplink from this value rather than from a
   * hardcoded constant — otherwise dev/staging/alpha/prod environments produce
   * mismatched deeplinks.
   *
   * Older API servers may omit this field; consumers should fall back to a
   * default (`https://app.traseq.com`) only when the manifest does not provide it.
   */
  appBaseUrl?: string;
}

export interface WorkspaceContext extends JsonObject {
  workspace?: JsonObject;
  apiKey?: JsonObject | null;
  subscription?: JsonObject;
}

export type CapabilityDocument = JsonObject;
