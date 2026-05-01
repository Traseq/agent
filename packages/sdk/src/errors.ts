import type {
  TraseqAgentErrorExplanation,
  TraseqPublicAgentMetadata,
  TraseqPublicApiErrorBody,
} from './types.js';

function parseErrorBody(body?: string): TraseqPublicApiErrorBody | null {
  if (!body?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as TraseqPublicApiErrorBody)
      : null;
  } catch {
    return null;
  }
}

function bodyMessage(
  body: TraseqPublicApiErrorBody | null,
  fallback: string,
): string {
  if (typeof body?.message === 'string') {
    return body.message;
  }

  if (Array.isArray(body?.message)) {
    return body.message.join(', ');
  }

  return fallback;
}

function formatValidationIssues(
  issues: TraseqPublicApiErrorBody['issues'],
): string {
  if (!Array.isArray(issues) || issues.length === 0) {
    return '';
  }

  return issues
    .map((issue) => {
      const code = issue.code ? `[${issue.code}] ` : '';
      const path = issue.path ? `${issue.path}: ` : '';
      return `- ${code}${path}${issue.message}`;
    })
    .join('\n');
}

const API_KEY_AUTH_HELP = [
  'Check that TRASEQ_API_KEY is a Traseq workspace API key, not a wallet private key or exchange secret.',
  'If the key was lost, expired, revoked, or has insufficient scopes, create or rotate it from Settings > API Keys in the Traseq app.',
].join(' ');

export class TraseqApiError extends Error {
  readonly parsedBody: TraseqPublicApiErrorBody | null;
  readonly publicAgent: TraseqPublicAgentMetadata | undefined;

  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body?: string,
  ) {
    const parsedBody = parseErrorBody(body);
    super(bodyMessage(parsedBody, body || message));
    this.name = 'TraseqApiError';
    this.parsedBody = parsedBody;
    this.publicAgent = parsedBody?.publicAgent;
  }
}

export { TraseqApiError as TraseqPublicApiError };

export function explainTraseqError(
  error: unknown,
): TraseqAgentErrorExplanation {
  if (error instanceof TraseqApiError) {
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
        explanation: API_KEY_AUTH_HELP,
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
      code:
        typeof error.parsedBody?.errorCode === 'string'
          ? error.parsedBody.errorCode
          : 'traseq_request_failed',
      category:
        (Array.isArray(error.parsedBody?.issues) &&
          error.parsedBody.issues.length > 0) ||
        error.parsedBody?.errorCode === 'validation_failed'
          ? 'validation'
          : 'runtime',
      retryable: false,
      title: 'Traseq request failed',
      explanation: [
        bodyMessage(error.parsedBody, error.body ?? error.message),
        formatValidationIssues(error.parsedBody?.issues),
      ]
        .filter(Boolean)
        .join('\n'),
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
    nextSteps: ['Inspect the agent logs and retry after fixing the issue.'],
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
