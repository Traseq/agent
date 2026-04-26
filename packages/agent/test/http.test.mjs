import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../dist/http.js';

describe('fetchWithRetry', () => {
  it('returns immediately on 200', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve(new Response('ok', { status: 200 })),
    );

    try {
      const res = await fetchWithRetry('https://example.com', { method: 'GET' });
      assert.equal(res.status, 200);
      assert.equal(globalThis.fetch.mock.callCount(), 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('returns non-retryable errors without retry', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve(new Response('bad request', { status: 400 })),
    );

    try {
      const res = await fetchWithRetry('https://example.com', { method: 'GET' });
      assert.equal(res.status, 400);
      assert.equal(globalThis.fetch.mock.callCount(), 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    const original = globalThis.fetch;
    let attempt = 0;
    globalThis.fetch = mock.fn(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(new Response('error', { status: 500 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    try {
      const res = await fetchWithRetry('https://example.com', { method: 'GET' }, {
        baseDelayMs: 10,
      });
      assert.equal(res.status, 200);
      assert.equal(globalThis.fetch.mock.callCount(), 2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on 429 and succeeds', async () => {
    const original = globalThis.fetch;
    let attempt = 0;
    globalThis.fetch = mock.fn(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(
          new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '0' },
          }),
        );
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    try {
      const res = await fetchWithRetry('https://example.com', { method: 'GET' }, {
        baseDelayMs: 10,
      });
      assert.equal(res.status, 200);
      assert.equal(globalThis.fetch.mock.callCount(), 2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('returns last error response after exhausting attempts', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.resolve(new Response('error', { status: 502 })),
    );

    try {
      const res = await fetchWithRetry('https://example.com', { method: 'GET' }, {
        maxAttempts: 2,
        baseDelayMs: 10,
      });
      assert.equal(res.status, 502);
      assert.equal(globalThis.fetch.mock.callCount(), 2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws after exhausting attempts on network error', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock.fn(() =>
      Promise.reject(new Error('network failure')),
    );

    try {
      await assert.rejects(
        () => fetchWithRetry('https://example.com', { method: 'GET' }, {
          maxAttempts: 2,
          baseDelayMs: 10,
        }),
        { message: 'network failure' },
      );
      assert.equal(globalThis.fetch.mock.callCount(), 2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
