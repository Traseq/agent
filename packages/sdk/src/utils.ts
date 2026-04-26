export type FetchLike = typeof fetch;

export interface FetchRetryOptions {
  /** Maximum request attempts, including the first attempt. Defaults to 3. */
  maxAttempts?: number;
  /** Base exponential backoff delay in milliseconds. Defaults to 1,000. */
  baseDelayMs?: number;
  /** HTTP statuses that should be retried. Defaults to common transient failures. */
  statusCodes?: readonly number[];
  /** HTTP methods that may be retried. Defaults to GET and HEAD. */
  methods?: readonly string[];
}

export interface FetchPolicyOptions {
  /** Abort each request attempt after this many milliseconds. Defaults to 30,000. */
  timeoutMs?: number;
  /** Retry policy. Set to false to disable retries. */
  retry?: false | FetchRetryOptions;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD'] as const;
const DEFAULT_RETRY_STATUS_CODES = [
  408, 409, 425, 429, 500, 502, 503, 504,
] as const;

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryAfterDelayMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 30_000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 30_000);
  }

  return undefined;
}

function normalizeAttemptCount(retry: FetchPolicyOptions['retry']): number {
  if (retry === false) {
    return 1;
  }

  const configured = retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.floor(configured));
}

function retryStatusCodes(retry: FetchPolicyOptions['retry']): Set<number> {
  return new Set(
    retry === false ? [] : (retry?.statusCodes ?? DEFAULT_RETRY_STATUS_CODES),
  );
}

function retryMethods(retry: FetchPolicyOptions['retry']): Set<string> {
  return new Set(
    (retry === false ? [] : (retry?.methods ?? DEFAULT_RETRY_METHODS)).map(
      (method) => method.toUpperCase(),
    ),
  );
}

export async function fetchWithPolicy(
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  options: FetchPolicyOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = String(init.method ?? 'GET').toUpperCase();
  const canRetryMethod = retryMethods(options.retry).has(method);
  const maxAttempts = canRetryMethod ? normalizeAttemptCount(options.retry) : 1;
  const retryableStatuses = retryStatusCodes(options.retry);
  const baseDelayMs =
    options.retry === false
      ? DEFAULT_BASE_DELAY_MS
      : (options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timer =
      controller === undefined
        ? undefined
        : setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(
        input,
        controller === undefined
          ? init
          : { ...init, signal: controller.signal },
      );

      if (
        response.ok ||
        attempt === maxAttempts ||
        !retryableStatuses.has(response.status)
      ) {
        return response;
      }

      const retryAfterMs = retryAfterDelayMs(
        response.headers.get('retry-after'),
      );
      await sleep(retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1));
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await sleep(baseDelayMs * 2 ** (attempt - 1));
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  throw new Error('fetchWithPolicy: exhausted all attempts');
}
