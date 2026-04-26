import { TraseqApiError } from './errors.js';
import type {
  AnalysisRunDetail,
  AnalysisRunListResponse,
  BacktestDetail,
  BacktestListResponse,
  CapabilityDocument,
  ChartDataResponse,
  ComparisonSetDetail,
  ComparisonSetListResponse,
  ComparisonSetRequest,
  CreateStrategyRequest,
  CreateStrategyResponse,
  CreateStrategyVersionRequest,
  FinalizeStrategyVersionRequest,
  FinalizeStrategyVersionResponse,
  JsonObject,
  ListAnalysisRunsQuery,
  ListBacktestsQuery,
  ListBlocksQuery,
  ListComparisonSetsQuery,
  ListStrategiesQuery,
  ListSystemStrategiesQuery,
  PineExportRequest,
  QueryParams,
  PublicManifest,
  RobustnessAnalysisRequest,
  RobustnessAnalysisPreview,
  RunBacktestRequest,
  RunBacktestResponse,
  StrategyDetail,
  StrategyAuthoringPayload,
  StrategyVersionDetail,
  SystemStrategyDetail,
  SystemStrategyListResponse,
  TraseqValidationResponse,
  UpdateStrategyRequest,
  UpdateStrategyVersionRequest,
  WorkspaceContext,
  WorkspaceUsageSummary,
  BlockDetail,
  BlockListResponse,
  BlockRequest,
} from './types.js';
import {
  fetchWithPolicy,
  normalizeBaseUrl,
  type FetchLike,
  type FetchPolicyOptions,
  type FetchRetryOptions,
} from './utils.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTerminalBacktestStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === 'completed' ||
    normalized === 'success' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'cancelled' ||
    normalized === 'error'
  );
}

function isTerminalAnalysisRunStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === 'succeeded' ||
    normalized === 'partial_failed' ||
    normalized === 'failed' ||
    normalized === 'cancelled' ||
    normalized === 'error'
  );
}

function buildQuery(params?: QueryParams): string {
  if (!params) {
    return '';
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        search.set(key, value.join(','));
      }
      continue;
    }

    search.set(key, String(value));
  }

  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface TraseqClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  /** Abort each request attempt after this many milliseconds. Defaults to 30,000. */
  timeoutMs?: number;
  /** Retry transient idempotent requests by default. Set to false to disable retries. */
  retry?: false | FetchRetryOptions;
}

export class TraseqClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: TraseqClientOptions) {
    if (!options.fetch && typeof fetch !== 'function') {
      throw new Error(
        'A fetch implementation is required in this runtime environment.',
      );
    }

    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
  }

  getManifest(): Promise<PublicManifest> {
    return this.request<PublicManifest>('GET', '/public/v1');
  }

  getHealth(): Promise<JsonObject> {
    return this.request<JsonObject>('GET', '/public/v1/health');
  }

  getWorkspaceContext(): Promise<WorkspaceContext> {
    return this.request<WorkspaceContext>('GET', '/public/v1/workspace');
  }

  getUsage(): Promise<WorkspaceUsageSummary> {
    return this.request<WorkspaceUsageSummary>('GET', '/public/v1/usage');
  }

  getCapabilities(): Promise<CapabilityDocument> {
    return this.request<CapabilityDocument>('GET', '/public/v1/capabilities');
  }

  listSystemStrategies(
    query?: ListSystemStrategiesQuery,
  ): Promise<SystemStrategyListResponse> {
    return this.request<SystemStrategyListResponse>(
      'GET',
      `/public/v1/system-strategies${buildQuery(query)}`,
    );
  }

  getSystemStrategy(key: string): Promise<SystemStrategyDetail> {
    return this.request<SystemStrategyDetail>(
      'GET',
      `/public/v1/system-strategies/${encodeURIComponent(key)}`,
    );
  }

  copySystemStrategy(
    key: string,
    payload: { name?: string; description?: string },
  ): Promise<CreateStrategyResponse> {
    return this.request<CreateStrategyResponse>(
      'POST',
      `/public/v1/system-strategies/${encodeURIComponent(key)}/copy`,
      payload,
    );
  }

  validateStrategy(
    payload: StrategyAuthoringPayload,
  ): Promise<TraseqValidationResponse> {
    return this.request<TraseqValidationResponse>(
      'POST',
      '/public/v1/strategies/validate',
      payload,
    );
  }

  createStrategy(
    payload: CreateStrategyRequest,
  ): Promise<CreateStrategyResponse> {
    return this.request<CreateStrategyResponse>(
      'POST',
      '/public/v1/strategies',
      payload,
    );
  }

  listStrategies(query?: ListStrategiesQuery): Promise<{
    data: StrategyDetail[];
    pagination?: JsonObject;
  }> {
    return this.request<{
      data: StrategyDetail[];
      pagination?: JsonObject;
    }>('GET', `/public/v1/strategies${buildQuery(query)}`);
  }

  getStrategy(strategyId: string): Promise<StrategyDetail> {
    return this.request<StrategyDetail>(
      'GET',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}`,
    );
  }

  updateStrategy(
    strategyId: string,
    payload: UpdateStrategyRequest,
  ): Promise<StrategyDetail> {
    return this.request<StrategyDetail>(
      'PATCH',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}`,
      payload,
    );
  }

  createStrategyVersion(
    strategyId: string,
    payload: CreateStrategyVersionRequest,
  ): Promise<StrategyVersionDetail> {
    return this.request<StrategyVersionDetail>(
      'POST',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions`,
      payload,
    );
  }

  getStrategyVersion(
    strategyId: string,
    version: number,
  ): Promise<StrategyVersionDetail> {
    return this.request<StrategyVersionDetail>(
      'GET',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}`,
    );
  }

  updateStrategyVersion(
    strategyId: string,
    version: number,
    payload: UpdateStrategyVersionRequest,
  ): Promise<StrategyVersionDetail> {
    return this.request<StrategyVersionDetail>(
      'PATCH',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}`,
      payload,
    );
  }

  finalizeStrategyVersion(
    strategyId: string,
    payload: FinalizeStrategyVersionRequest,
  ): Promise<FinalizeStrategyVersionResponse> {
    return this.request<FinalizeStrategyVersionResponse>(
      'POST',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/finalize`,
      payload,
    );
  }

  deleteStrategyVersion(
    strategyId: string,
    version: number,
  ): Promise<JsonObject> {
    return this.request<JsonObject>(
      'DELETE',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}`,
    );
  }

  archiveStrategyVersion(
    strategyId: string,
    version: number,
  ): Promise<StrategyVersionDetail> {
    return this.request<StrategyVersionDetail>(
      'POST',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}/archive`,
    );
  }

  restoreStrategyVersion(
    strategyId: string,
    version: number,
  ): Promise<StrategyVersionDetail> {
    return this.request<StrategyVersionDetail>(
      'POST',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}/restore`,
    );
  }

  createPineExport(
    strategyId: string,
    version: number,
    payload: PineExportRequest,
  ): Promise<JsonObject> {
    return this.request<JsonObject>(
      'POST',
      `/public/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(String(version))}/pine-export`,
      payload,
    );
  }

  validateConflicts(payload: JsonObject): Promise<JsonObject> {
    return this.request<JsonObject>(
      'POST',
      '/public/v1/strategies/validate-conflicts',
      payload,
    );
  }

  listBacktests(query?: ListBacktestsQuery): Promise<BacktestListResponse> {
    return this.request<BacktestListResponse>(
      'GET',
      `/public/v1/backtests${buildQuery(query)}`,
    );
  }

  runBacktest(payload: RunBacktestRequest): Promise<RunBacktestResponse> {
    return this.request<RunBacktestResponse>(
      'POST',
      '/public/v1/backtests',
      payload,
    );
  }

  getBacktest(backtestId: string): Promise<BacktestDetail> {
    return this.request<BacktestDetail>(
      'GET',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}`,
    );
  }

  getBacktestProgress(backtestId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'GET',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}/progress`,
    );
  }

  getBacktestChartData(
    backtestId: string,
    query?: QueryParams,
  ): Promise<ChartDataResponse> {
    return this.request<ChartDataResponse>(
      'GET',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}/chart-data${buildQuery(query)}`,
    );
  }

  getBacktestPricePreview(backtestId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'GET',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}/price-preview`,
    );
  }

  setPrimaryBacktest(backtestId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'PATCH',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}/set-primary`,
    );
  }

  deleteBacktest(backtestId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'DELETE',
      `/public/v1/backtests/${encodeURIComponent(backtestId)}`,
    );
  }

  previewRobustnessAnalysis(
    payload: RobustnessAnalysisRequest,
  ): Promise<RobustnessAnalysisPreview> {
    return this.request<RobustnessAnalysisPreview>(
      'POST',
      '/public/v1/analysis-runs/robustness/preview',
      payload,
    );
  }

  createRobustnessAnalysis(
    payload: RobustnessAnalysisRequest,
  ): Promise<AnalysisRunDetail> {
    return this.request<AnalysisRunDetail>(
      'POST',
      '/public/v1/analysis-runs/robustness',
      payload,
    );
  }

  listAnalysisRuns(
    query?: ListAnalysisRunsQuery,
  ): Promise<AnalysisRunListResponse> {
    return this.request<AnalysisRunListResponse>(
      'GET',
      `/public/v1/analysis-runs${buildQuery(query)}`,
    );
  }

  getAnalysisRun(analysisRunId: string): Promise<AnalysisRunDetail> {
    return this.request<AnalysisRunDetail>(
      'GET',
      `/public/v1/analysis-runs/${encodeURIComponent(analysisRunId)}`,
    );
  }

  updateAnalysisRun(
    analysisRunId: string,
    payload: { title?: string; description?: string | null },
  ): Promise<AnalysisRunDetail> {
    return this.request<AnalysisRunDetail>(
      'PATCH',
      `/public/v1/analysis-runs/${encodeURIComponent(analysisRunId)}`,
      payload,
    );
  }

  deleteAnalysisRun(analysisRunId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'DELETE',
      `/public/v1/analysis-runs/${encodeURIComponent(analysisRunId)}`,
    );
  }

  listComparisonSets(
    query?: ListComparisonSetsQuery,
  ): Promise<ComparisonSetListResponse> {
    return this.request<ComparisonSetListResponse>(
      'GET',
      `/public/v1/comparison-sets${buildQuery(query)}`,
    );
  }

  getComparisonSet(comparisonSetId: string): Promise<ComparisonSetDetail> {
    return this.request<ComparisonSetDetail>(
      'GET',
      `/public/v1/comparison-sets/${encodeURIComponent(comparisonSetId)}`,
    );
  }

  createComparisonSet(
    payload: ComparisonSetRequest,
  ): Promise<ComparisonSetDetail> {
    return this.request<ComparisonSetDetail>(
      'POST',
      '/public/v1/comparison-sets',
      payload,
    );
  }

  updateComparisonSet(
    comparisonSetId: string,
    payload: Partial<ComparisonSetRequest> & { notes?: string | null },
  ): Promise<ComparisonSetDetail> {
    return this.request<ComparisonSetDetail>(
      'PATCH',
      `/public/v1/comparison-sets/${encodeURIComponent(comparisonSetId)}`,
      payload,
    );
  }

  deleteComparisonSet(comparisonSetId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'DELETE',
      `/public/v1/comparison-sets/${encodeURIComponent(comparisonSetId)}`,
    );
  }

  listBlocks(query?: ListBlocksQuery): Promise<BlockListResponse> {
    return this.request<BlockListResponse>(
      'GET',
      `/public/v1/blocks${buildQuery(query)}`,
    );
  }

  getBlock(blockId: string): Promise<BlockDetail> {
    return this.request<BlockDetail>(
      'GET',
      `/public/v1/blocks/${encodeURIComponent(blockId)}`,
    );
  }

  createBlock(payload: BlockRequest): Promise<BlockDetail> {
    return this.request<BlockDetail>('POST', '/public/v1/blocks', payload);
  }

  updateBlock(
    blockId: string,
    payload: Partial<BlockRequest>,
  ): Promise<BlockDetail> {
    return this.request<BlockDetail>(
      'PATCH',
      `/public/v1/blocks/${encodeURIComponent(blockId)}`,
      payload,
    );
  }

  deleteBlock(blockId: string): Promise<JsonObject> {
    return this.request<JsonObject>(
      'DELETE',
      `/public/v1/blocks/${encodeURIComponent(blockId)}`,
    );
  }

  pinBlock(blockId: string): Promise<BlockDetail> {
    return this.request<BlockDetail>(
      'POST',
      `/public/v1/blocks/${encodeURIComponent(blockId)}/pin`,
    );
  }

  unpinBlock(blockId: string): Promise<BlockDetail> {
    return this.request<BlockDetail>(
      'DELETE',
      `/public/v1/blocks/${encodeURIComponent(blockId)}/pin`,
    );
  }

  async waitForBacktestCompletion(
    backtestId: string,
    options: {
      intervalMs: number;
      timeoutMs: number;
      onPoll?: (detail: BacktestDetail) => void | Promise<void>;
    },
  ): Promise<BacktestDetail> {
    const startedAt = Date.now();

    for (;;) {
      const detail = await this.getBacktest(backtestId);
      await options.onPoll?.(detail);

      if (isTerminalBacktestStatus(detail.status)) {
        return detail;
      }

      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new Error(
          `Backtest polling timed out after ${options.timeoutMs} ms.`,
        );
      }

      await sleep(options.intervalMs);
    }
  }

  async waitForAnalysisRun(
    analysisRunId: string,
    options: {
      intervalMs: number;
      timeoutMs: number;
      onPoll?: (detail: AnalysisRunDetail) => void | Promise<void>;
    },
  ): Promise<AnalysisRunDetail> {
    const startedAt = Date.now();

    for (;;) {
      const detail = await this.getAnalysisRun(analysisRunId);
      await options.onPoll?.(detail);

      if (
        typeof detail.status === 'string' &&
        isTerminalAnalysisRunStatus(detail.status)
      ) {
        return detail;
      }

      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new Error(
          `Analysis run polling timed out after ${options.timeoutMs} ms.`,
        );
      }

      await sleep(options.intervalMs);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const policy: FetchPolicyOptions = {};
    if (this.options.timeoutMs !== undefined) {
      policy.timeoutMs = this.options.timeoutMs;
    }
    if (this.options.retry !== undefined) {
      policy.retry = this.options.retry;
    }

    const response = await fetchWithPolicy(
      this.fetchImpl,
      `${this.baseUrl}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.options.apiKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      policy,
    );

    const text = await response.text();

    if (!response.ok) {
      throw new TraseqApiError(
        `Traseq API request failed with status ${response.status}.`,
        response.status,
        method,
        path,
        text,
      );
    }

    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }
}
