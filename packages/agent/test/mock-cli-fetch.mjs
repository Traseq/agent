const validationMode = process.env.TRASEQ_AGENT_TEST_VALIDATION ?? 'ok';

const validationOk = {
  valid: true,
  summary: { errors: 0, warnings: 0 },
  issues: {},
};

const validationError = {
  valid: false,
  summary: { errors: 1, warnings: 0 },
  issues: {
    tokens: [
      {
        code: 'missing_entry',
        path: 'signalGraph.strategy.entry',
        message: 'Entry trigger is required.',
        severity: 'error',
      },
    ],
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async (url, init = {}) => {
  const pathname = new URL(String(url)).pathname;
  const method = init.method ?? 'GET';

  if (init.headers?.['x-api-key'] !== 'test-key') {
    return json({ message: 'missing test key' }, 401);
  }

  if (method === 'GET' && pathname === '/public/v1') {
    return json({ name: 'Traseq Agent API', version: 'v1' });
  }

  if (method === 'GET' && pathname === '/public/v1/workspace') {
    return json({
      workspace: { id: 'workspace-1', name: 'Test Workspace' },
      subscription: { tier: 'plus' },
      apiKey: {
        scopes: [
          'workspace_read',
          'strategies_write',
          'backtests_read',
          'backtests_write',
        ],
      },
    });
  }

  if (method === 'GET' && pathname === '/public/v1/usage') {
    return json({ usage: {}, limits: {} });
  }

  if (method === 'GET' && pathname === '/public/v1/capabilities') {
    return json({
      protocol: 'traseq.capabilities',
      version: 1,
      signalGraph: { nodes: [], bindings: [] },
      indicators: [],
      operators: { compare: [], cross: [] },
    });
  }

  if (method === 'POST' && pathname === '/public/v1/strategies/validate') {
    return json(validationMode === 'fail' ? validationError : validationOk);
  }

  if (validationMode === 'fail' && method !== 'GET') {
    return json({ message: `unexpected write: ${method} ${pathname}` }, 500);
  }

  if (method === 'POST' && pathname === '/public/v1/strategies') {
    return json({ id: 'strategy-1', versions: [{ version: 1 }] });
  }

  if (
    method === 'POST' &&
    pathname === '/public/v1/strategies/strategy-1/versions/finalize'
  ) {
    return json({ id: 'version-1', version: 1, status: 'ready' });
  }

  if (method === 'POST' && pathname === '/public/v1/backtests') {
    return json({ id: 'bt-1', status: 'queued' });
  }

  if (method === 'GET' && pathname === '/public/v1/backtests/bt-1') {
    return json({
      id: 'bt-1',
      status: 'completed',
      summaryJson: {
        returnPct: 0.1,
        sharpeRatio: 1,
        maxDrawdown: 0.1,
        profitFactor: 1.5,
        totalPositions: 20,
      },
    });
  }

  return json({ message: `not found: ${method} ${pathname}` }, 404);
};
