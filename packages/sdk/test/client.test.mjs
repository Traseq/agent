import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TraseqApiError,
  TraseqClient,
  TraseqPublicApiError,
  explainTraseqError,
  formatTraseqAgentError,
} from '../dist/index.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMockFetch(routes) {
  return async function mockFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const handler = routes[`${method} ${new URL(url).pathname}`];

    if (!handler) {
      throw new Error(`Unhandled request: ${method} ${url}`);
    }

    return handler({ url, method, body, headers: init.headers });
  };
}

test('TraseqClient sends x-api-key header on every request', async () => {
  let capturedHeaders;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'test-key-123',
    fetch: createMockFetch({
      'GET /public/v1': ({ headers }) => {
        capturedHeaders = headers;
        return jsonResponse({ version: 'v1' });
      },
    }),
  });

  await client.getManifest();
  assert.equal(capturedHeaders['x-api-key'], 'test-key-123');
  assert.equal(capturedHeaders['Content-Type'], 'application/json');
});

test('TraseqClient.getManifest parses JSON response', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1': () => jsonResponse({ name: 'traseq', version: 'v1' }),
    }),
  });

  const manifest = await client.getManifest();
  assert.equal(manifest.name, 'traseq');
  assert.equal(manifest.version, 'v1');
});

test('TraseqClient.getWorkspaceContext returns workspace data', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1/workspace': () =>
        jsonResponse({
          workspace: { id: 'ws-1' },
          subscription: { tier: 'pro' },
        }),
    }),
  });

  const ctx = await client.getWorkspaceContext();
  assert.equal(ctx.workspace.id, 'ws-1');
  assert.equal(ctx.subscription.tier, 'pro');
});

test('TraseqClient.validateStrategy sends payload and returns validation result', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'POST /public/v1/strategies/validate': ({ body }) => {
        assert.ok(body.signalGraph);
        return jsonResponse({
          valid: true,
          summary: { errors: 0, warnings: 0 },
          issues: {},
        });
      },
    }),
  });

  const result = await client.validateStrategy({
    signalGraph: { protocol: 'traseq.signal-graph', version: 2 },
    settings: {},
  });
  assert.equal(result.valid, true);
});

test('TraseqClient.createStrategy sends name and returns id', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'POST /public/v1/strategies': ({ body }) => {
        assert.equal(body.name, 'My Strategy');
        return jsonResponse({ id: 'strat-1', versions: [{ version: 1 }] });
      },
    }),
  });

  const result = await client.createStrategy({
    name: 'My Strategy',
    signalGraph: {},
    settings: {},
  });
  assert.equal(result.id, 'strat-1');
  assert.equal(result.versions[0].version, 1);
});

test('TraseqClient.finalizeStrategyVersion encodes strategyId in URL', async () => {
  let capturedPath;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedPath = new URL(url).pathname;
      return jsonResponse({ id: 'v-1', version: 1, status: 'ready' });
    },
  });

  await client.finalizeStrategyVersion('strat/special', {
    signalGraph: {},
    settings: {},
  });
  assert.equal(
    capturedPath,
    '/public/v1/strategies/strat%2Fspecial/versions/finalize',
  );
});

test('TraseqClient throws TraseqApiError on non-ok response', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1': () =>
        new Response('{"error":"forbidden"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    }),
  });

  await assert.rejects(
    () => client.getManifest(),
    (error) => {
      assert.ok(error instanceof TraseqApiError);
      assert.equal(error.status, 403);
      assert.equal(error.method, 'GET');
      assert.equal(error.path, '/public/v1');
      assert.equal(error.body, '{"error":"forbidden"}');
      assert.equal(error.name, 'TraseqApiError');
      return true;
    },
  );
});

test('TraseqClient parses publicAgent errors for agent explanations', async () => {
  const body = {
    statusCode: 403,
    message: 'Strategy limit reached.',
    error: 'Forbidden',
    publicAgent: {
      code: 'strategy_limit_reached',
      category: 'usage',
      severity: 'blocker',
      retryable: false,
      title: 'Strategy limit reached',
      explanation: 'The workspace has reached the strategy limit.',
      nextSteps: ['Delete unused strategies.', 'Upgrade the workspace plan.'],
      links: [
        {
          rel: 'billing_plan',
          label: 'Compare workspace plans',
          href: 'https://app.traseq.com/settings/billing/plan?targetTier=plus',
        },
      ],
      usage: {
        current: 3,
        limit: 3,
        remaining: 0,
        unit: 'count',
      },
    },
  };
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'POST /public/v1/strategies': () => jsonResponse(body, 403),
    }),
  });

  await assert.rejects(
    () =>
      client.createStrategy({
        name: 'Limited',
        signalGraph: {},
        settings: {},
      }),
    (error) => {
      assert.ok(error instanceof TraseqApiError);
      assert.ok(error instanceof TraseqPublicApiError);
      assert.equal(error.publicAgent.code, 'strategy_limit_reached');
      assert.equal(error.parsedBody.publicAgent.category, 'usage');

      const explanation = explainTraseqError(error);
      assert.equal(explanation.category, 'usage');
      assert.equal(explanation.retryable, false);
      assert.deepEqual(explanation.usage, body.publicAgent.usage);
      const formatted = formatTraseqAgentError(error);
      assert.match(formatted, /Retryable: false/);
      assert.match(formatted, /Usage:/);
      assert.match(formatted, /Compare workspace plans/);
      return true;
    },
  );
});

test('explainTraseqError falls back for plain-text rate limits', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    retry: false,
    fetch: createMockFetch({
      'GET /public/v1': () =>
        new Response('slow down', {
          status: 429,
          headers: { 'Content-Type': 'text/plain' },
        }),
    }),
  });

  await assert.rejects(
    () => client.getManifest(),
    (error) => {
      assert.ok(error instanceof TraseqPublicApiError);
      assert.equal(error.parsedBody, null);

      const explanation = explainTraseqError(error);
      assert.equal(explanation.category, 'rate_limit');
      assert.equal(explanation.retryable, true);
      assert.match(formatTraseqAgentError(error), /Retryable: true/);
      return true;
    },
  );
});

test('explainTraseqError marks 5xx responses as transient', async () => {
  const error = new TraseqApiError(
    'failed',
    503,
    'GET',
    '/public/v1',
    'temporary outage',
  );

  const explanation = explainTraseqError(error);

  assert.equal(explanation.category, 'transient');
  assert.equal(explanation.retryable, true);
  assert.match(formatTraseqAgentError(error), /Retryable: true/);
});

test('TraseqClient returns empty object for empty response body', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'POST /public/v1/strategies': () =>
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    }),
  });

  const result = await client.createStrategy({
    name: 'Empty',
    signalGraph: {},
    settings: {},
  });
  assert.deepEqual(result, {});
});

test('TraseqClient.runBacktest sends strategyVersionId', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'POST /public/v1/backtests': ({ body }) => {
        assert.equal(body.strategyVersionId, 'v-1');
        assert.equal(body.config.timeframe, '4h');
        return jsonResponse({ id: 'bt-1', status: 'queued' });
      },
    }),
  });

  const result = await client.runBacktest({
    strategyVersionId: 'v-1',
    config: { timeframe: '4h', signalInstrument: { symbol: 'BTCUSDT' } },
  });
  assert.equal(result.id, 'bt-1');
  assert.equal(result.status, 'queued');
});

test('TraseqClient.getBacktest retrieves backtest detail', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1/backtests/bt-1': () =>
        jsonResponse({
          id: 'bt-1',
          status: 'completed',
          summaryJson: { pnl: 100 },
        }),
    }),
  });

  const detail = await client.getBacktest('bt-1');
  assert.equal(detail.status, 'completed');
  assert.equal(detail.summaryJson.pnl, 100);
});

test('TraseqClient.waitForBacktestCompletion polls until terminal status', async () => {
  let pollCount = 0;
  const onPollStatuses = [];

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1/backtests/bt-1': () => {
        pollCount += 1;
        if (pollCount < 3) {
          return jsonResponse({ id: 'bt-1', status: 'running' });
        }
        return jsonResponse({
          id: 'bt-1',
          status: 'completed',
          summaryJson: { trades: 5 },
        });
      },
    }),
  });

  const result = await client.waitForBacktestCompletion('bt-1', {
    intervalMs: 1,
    timeoutMs: 5000,
    onPoll(detail) {
      onPollStatuses.push(detail.status);
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(pollCount, 3);
  assert.deepEqual(onPollStatuses, ['running', 'running', 'completed']);
});

test('TraseqClient.waitForBacktestCompletion throws on timeout', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: createMockFetch({
      'GET /public/v1/backtests/bt-stuck': () =>
        jsonResponse({ id: 'bt-stuck', status: 'running' }),
    }),
  });

  await assert.rejects(
    () =>
      client.waitForBacktestCompletion('bt-stuck', {
        intervalMs: 1,
        timeoutMs: 15,
      }),
    /timed out/i,
  );
});

test('TraseqClient.waitForBacktestCompletion recognizes all terminal statuses', async () => {
  for (const terminalStatus of [
    'completed',
    'success',
    'succeeded',
    'failed',
    'cancelled',
    'error',
  ]) {
    const client = new TraseqClient({
      baseUrl: 'https://api.traseq.test',
      apiKey: 'key',
      fetch: async () => jsonResponse({ id: 'bt-x', status: terminalStatus }),
    });

    const result = await client.waitForBacktestCompletion('bt-x', {
      intervalMs: 1,
      timeoutMs: 100,
    });
    assert.equal(result.status, terminalStatus);
  }
});

test('TraseqClient normalizes trailing slashes in baseUrl', async () => {
  let capturedUrl;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test///',
    apiKey: 'key',
    fetch: async (input) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return jsonResponse({ version: 'v1' });
    },
  });

  await client.getManifest();
  assert.equal(capturedUrl, 'https://api.traseq.test/public/v1');
});

test('TraseqClient omits body for GET requests', async () => {
  let capturedInit;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    fetch: async (_input, init) => {
      capturedInit = init;
      return jsonResponse({});
    },
  });

  await client.getManifest();
  assert.equal(capturedInit.body, undefined);
});

test('TraseqClient retries transient failures and preserves headers', async () => {
  let attempts = 0;
  const capturedApiKeys = [];

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'retry-key',
    retry: { maxAttempts: 2, baseDelayMs: 1 },
    fetch: async (_input, init = {}) => {
      attempts += 1;
      capturedApiKeys.push(init.headers['x-api-key']);

      if (attempts === 1) {
        return new Response('temporary outage', {
          status: 503,
          headers: { 'retry-after': '0' },
        });
      }

      return jsonResponse({ name: 'traseq', version: 'v1' });
    },
  });

  const manifest = await client.getManifest();
  assert.equal(manifest.name, 'traseq');
  assert.equal(attempts, 2);
  assert.deepEqual(capturedApiKeys, ['retry-key', 'retry-key']);
});

test('TraseqClient does not retry write requests by default', async () => {
  let attempts = 0;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    retry: { maxAttempts: 2, baseDelayMs: 1 },
    fetch: createMockFetch({
      'POST /public/v1/strategies': () => {
        attempts += 1;
        return new Response('temporary outage', { status: 503 });
      },
    }),
  });

  await assert.rejects(
    () =>
      client.createStrategy({
        name: 'Write retry guard',
        signalGraph: {},
        settings: {},
      }),
    (error) => {
      assert.ok(error instanceof TraseqApiError);
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test('TraseqClient can disable retries', async () => {
  let attempts = 0;

  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    retry: false,
    fetch: async () => {
      attempts += 1;
      return new Response('temporary outage', { status: 503 });
    },
  });

  await assert.rejects(
    () => client.getManifest(),
    (error) => {
      assert.ok(error instanceof TraseqApiError);
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test('TraseqClient aborts requests after timeoutMs', async () => {
  const client = new TraseqClient({
    baseUrl: 'https://api.traseq.test',
    apiKey: 'key',
    timeoutMs: 1,
    retry: false,
    fetch: async (_input, init = {}) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('request aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  await assert.rejects(() => client.getManifest(), /request aborted/);
});
