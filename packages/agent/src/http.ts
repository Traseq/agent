export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return Math.round(ms * (0.5 + Math.random()));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      if (attempt === maxAttempts) {
        return response;
      }

      const retryAfter = response.headers.get('retry-after');
      const retryAfterSec = retryAfter ? Number(retryAfter) : NaN;
      const delay = Number.isFinite(retryAfterSec)
        ? Math.min(retryAfterSec * 1_000, 30_000)
        : baseDelayMs * 2 ** (attempt - 1);

      await sleep(jitter(delay));
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(jitter(baseDelayMs * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('fetchWithRetry: exhausted all attempts');
}
