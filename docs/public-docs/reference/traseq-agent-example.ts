type JsonObject = Record<string, unknown>;

export interface TraseqPublicAgentLink {
  rel: 'api_keys' | 'billing_plan' | 'usage' | 'billing' | 'docs';
  label: string;
  href: string;
}

export interface TraseqPublicAgentMetadata {
  code: string;
  category:
    | 'auth'
    | 'permission'
    | 'plan'
    | 'usage'
    | 'validation'
    | 'rate_limit'
    | 'runtime'
    | 'transient';
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
  category: TraseqPublicAgentMetadata['category'];
  retryable: boolean;
  title: string;
  explanation: string;
  nextSteps: string[];
  links: TraseqPublicAgentLink[];
  usage?: TraseqPublicAgentMetadata['usage'];
}

export const TRASEQ_API_KEY_SETUP_URL =
  'https://app.traseq.com/login?redirectTo=%2Fsettings%2Fapi-keys&entry_surface=agent_cli&entry_source=missing_traseq_api_key&cta_id=start_with_free_tier';

export const TRASEQ_API_KEY_SETUP_HELP = [
  'Missing TRASEQ_API_KEY.',
  'Start with the free tier and create a workspace API key:',
  TRASEQ_API_KEY_SETUP_URL,
  'Set it as TRASEQ_API_KEY and run `traseq-agent check-env` again.',
  'Do not paste API keys into AI prompts.',
].join('\n');

export const TRASEQ_API_KEY_AUTH_HELP = [
  'Check that TRASEQ_API_KEY is a Traseq workspace API key, not a wallet private key or exchange secret.',
  'If the key was lost, expired, revoked, or has insufficient scopes, create or rotate it from Settings > API Keys in the Traseq app.',
].join(' ');

function parseJsonObject(
  text: string,
): TraseqPublicApiErrorBody | JsonObject | null {
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as TraseqPublicApiErrorBody)
      : null;
  } catch {
    return null;
  }
}

function bodyMessage(body: TraseqPublicApiErrorBody | null, fallback: string) {
  if (typeof body?.message === 'string') {
    return body.message;
  }

  if (Array.isArray(body?.message)) {
    return body.message.join(', ');
  }

  return fallback;
}

export class TraseqPublicApiError extends Error {
  readonly name = 'TraseqPublicApiError';
  readonly publicAgent?: TraseqPublicAgentMetadata;

  constructor(
    readonly status: number,
    readonly body: TraseqPublicApiErrorBody | null,
    readonly rawBody: string,
  ) {
    super(bodyMessage(body, rawBody || `Traseq request failed with ${status}`));
    this.publicAgent = body?.publicAgent;
  }
}

export function explainTraseqError(
  error: unknown,
): TraseqAgentErrorExplanation {
  if (error instanceof TraseqPublicApiError) {
    if (error.publicAgent) {
      return {
        status: error.status,
        code: error.publicAgent.code,
        category: error.publicAgent.category,
        retryable: error.publicAgent.retryable,
        title: error.publicAgent.title,
        explanation: error.publicAgent.explanation,
        nextSteps: error.publicAgent.nextSteps,
        links: error.publicAgent.links,
        usage: error.publicAgent.usage,
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        status: error.status,
        code: 'api_key_auth_or_permission_error',
        category: error.status === 401 ? 'auth' : 'permission',
        retryable: false,
        title: 'Traseq rejected the API key request',
        explanation: TRASEQ_API_KEY_AUTH_HELP,
        nextSteps: [
          'Create or rotate a workspace API key in Traseq.',
          'Confirm the key has the scopes required by this workflow.',
        ],
        links: [],
      };
    }

    if (error.status === 429) {
      return {
        status: error.status,
        code: 'public_agent_rate_limited',
        category: 'rate_limit',
        retryable: true,
        title: 'Traseq rate limit reached',
        explanation:
          'The agent made too many requests in the current throttling window.',
        nextSteps: ['Wait briefly, then retry with exponential backoff.'],
        links: [],
      };
    }

    if (error.status >= 500) {
      return {
        status: error.status,
        code: 'traseq_transient_error',
        category: 'transient',
        retryable: true,
        title: 'Temporary Traseq service error',
        explanation:
          'The request reached Traseq, but the service returned a server-side error.',
        nextSteps: ['Retry after a short backoff.'],
        links: [],
      };
    }

    return {
      status: error.status,
      code: 'traseq_request_failed',
      category: 'runtime',
      retryable: false,
      title: 'Traseq request failed',
      explanation: bodyMessage(error.body, error.rawBody),
      nextSteps: ['Inspect the response message and adjust the request.'],
      links: [],
    };
  }

  return {
    code: 'agent_runtime_error',
    category: 'runtime',
    retryable: false,
    title: 'Agent runtime error',
    explanation: error instanceof Error ? error.message : String(error),
    nextSteps: [
      'Inspect the agent logs and retry after fixing the runtime issue.',
    ],
    links: [],
  };
}

function formatUsageValue(
  value: number,
  unit: NonNullable<TraseqAgentErrorExplanation['usage']>['unit'],
): string {
  return unit === 'usd' ? `$${value.toFixed(2)}` : String(value);
}

function formatUsage(usage: TraseqAgentErrorExplanation['usage']): string {
  if (!usage) {
    return '';
  }

  return [
    'Usage:',
    `- Current: ${formatUsageValue(usage.current, usage.unit)}`,
    `- Limit: ${formatUsageValue(usage.limit, usage.unit)}`,
    `- Remaining: ${formatUsageValue(usage.remaining, usage.unit)}`,
  ].join('\n');
}

function formatErrorMetadata(explanation: TraseqAgentErrorExplanation): string {
  const fields = [
    explanation.status !== undefined ? `Status: ${explanation.status}` : '',
    `Code: ${explanation.code}`,
    `Category: ${explanation.category}`,
    `Retryable: ${explanation.retryable}`,
  ];

  return fields.filter(Boolean).join('\n');
}

export function formatTraseqAgentError(error: unknown): string {
  const explanation = explainTraseqError(error);
  const lines = [
    explanation.title,
    formatErrorMetadata(explanation),
    explanation.explanation,
    formatUsage(explanation.usage),
    explanation.nextSteps.length > 0
      ? `Next steps:\n${explanation.nextSteps.map((step) => `- ${step}`).join('\n')}`
      : '',
    explanation.links.length > 0
      ? `Links:\n${explanation.links
          .map((link) => `- ${link.label}: ${link.href}`)
          .join('\n')}`
      : '',
  ];

  return lines.filter(Boolean).join('\n\n');
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
  summary: {
    errors: number;
    warnings: number;
  };
  issues: {
    signalGraph?: TraseqValidationIssue[];
    settings?: TraseqValidationIssue[];
    conflicts?: TraseqValidationIssue[];
  };
}

export interface SignalGraphWritePayload {
  signalGraph: JsonObject;
  settings: {
    positionStyle?: 'single' | 'pyramid' | 'accumulate';
    maxConcurrentPositions?: number;
    warmupPeriod?: number;
  };
}

export interface CreateStrategyRequest extends SignalGraphWritePayload {
  name: string;
  description?: string;
}

export interface FinalizeVersionRequest extends SignalGraphWritePayload {
  version: number;
  ignoreWarnings?: boolean;
}

export interface BacktestRequest {
  strategyVersionId: string;
  config: {
    timeframe: '15m' | '1h' | '4h' | '1d';
    signalInstrument: {
      symbol: string;
    };
    range?: {
      start: number;
      end: number;
    };
    initialBalance?: number;
    execution?: {
      entryOrderRole?: 'maker' | 'taker';
      exitOrderRole?: 'maker' | 'taker';
      riskOrderRole?: 'maker' | 'taker';
      feeModel?: {
        kind: 'tiered_maker_taker';
        tiers: Array<{
          minCumulativeNotional: number;
          makerRate: number;
          takerRate: number;
        }>;
      };
      slippage?:
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
    };
  };
}

export interface RepairContext {
  attempt: number;
  issues: TraseqValidationIssue[];
}

export type RepairFunction<TPayload> = (
  payload: TPayload,
  context: RepairContext,
) => Promise<TPayload>;

const TRASEQ_API_BASE_URL = 'https://api.traseq.com';

export class TraseqPublicAgentClient {
  private readonly baseUrl = TRASEQ_API_BASE_URL;

  constructor(private readonly apiKey: string) {
    if (!apiKey?.trim()) {
      throw new Error(TRASEQ_API_KEY_SETUP_HELP);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        ...(init?.headers ?? {}),
      },
    });
    const rawBody = await response.text();
    const parsedBody = parseJsonObject(rawBody);

    if (!response.ok) {
      throw new TraseqPublicApiError(
        response.status,
        parsedBody as TraseqPublicApiErrorBody | null,
        rawBody,
      );
    }

    return parsedBody as T;
  }

  getManifest() {
    return this.request<JsonObject>('/public/v1');
  }

  getWorkspaceContext() {
    return this.request<JsonObject>('/public/v1/workspace');
  }

  getUsage() {
    return this.request<JsonObject>('/public/v1/usage');
  }

  getCapabilities() {
    return this.request<JsonObject>('/public/v1/capabilities');
  }

  validateStrategy(payload: SignalGraphWritePayload) {
    return this.request<TraseqValidationResponse>(
      '/public/v1/strategies/validate',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  createStrategy(payload: CreateStrategyRequest) {
    return this.request<{ id: string; versions: Array<{ version: number }> }>(
      '/public/v1/strategies',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  finalizeStrategyVersion(strategyId: string, payload: FinalizeVersionRequest) {
    return this.request<{ id: string; version: number; status: 'ready' }>(
      `/public/v1/strategies/${strategyId}/versions/finalize`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  runBacktest(payload: BacktestRequest) {
    return this.request<{ id: string; status: string; warnings?: string[] }>(
      '/public/v1/backtests',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  }

  getBacktest(backtestId: string) {
    return this.request<JsonObject>(`/public/v1/backtests/${backtestId}`);
  }
}

export async function validateWithRepairLoop<
  TPayload extends SignalGraphWritePayload,
>(
  client: TraseqPublicAgentClient,
  initialPayload: TPayload,
  repair: RepairFunction<TPayload>,
  maxAttempts = 4,
): Promise<TPayload> {
  let payload = initialPayload;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const validation = await client.validateStrategy(payload);
    const issues = [
      ...(validation.issues.signalGraph ?? []),
      ...(validation.issues.settings ?? []),
      ...(validation.issues.conflicts ?? []),
    ];
    const blockingIssues = issues.filter(
      (issue) => issue.severity !== 'warning',
    );

    if (validation.valid || blockingIssues.length === 0) {
      return payload;
    }

    payload = await repair(payload, {
      attempt,
      issues: blockingIssues,
    });
  }

  throw new Error('Validation did not converge within maxAttempts.');
}

export async function createFinalizeAndBacktest(
  client: TraseqPublicAgentClient,
  payload: CreateStrategyRequest,
  repair: RepairFunction<SignalGraphWritePayload>,
  backtestConfig: BacktestRequest['config'],
) {
  await client.getUsage();

  const authoringPayload = await validateWithRepairLoop(
    client,
    {
      signalGraph: payload.signalGraph,
      settings: payload.settings,
    },
    repair,
  );

  const draft = await client.createStrategy({
    ...payload,
    ...authoringPayload,
  });

  const versionNumber = draft.versions[0]?.version;
  if (!versionNumber) {
    throw new Error('Draft strategy did not return a version number.');
  }

  const finalized = await client.finalizeStrategyVersion(draft.id, {
    version: versionNumber,
    ...authoringPayload,
  });

  return client.runBacktest({
    strategyVersionId: finalized.id,
    config: backtestConfig,
  });
}

/*
Example repair callback shape:

const repair: RepairFunction<SignalGraphWritePayload> = async (payload, context) => {
  // Call your LLM here with:
  // - the current payload
  // - context.issues (code, path, message, suggestion)
  // - capabilities fetched from GET /public/v1/capabilities
  // Then return the repaired payload.
  return payload;
};
*/
