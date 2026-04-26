import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../dist/index.js';

describe('runResearch', () => {
  it('creates a tool-first research brief without AI provider env', async () => {
    const legacyProviderEnv = ['OPENAI', 'AI'].map(
      (prefix) => `${prefix}_API_KEY`,
    );
    const previousEnv = {
      TRASEQ_API_KEY: process.env.TRASEQ_API_KEY,
      TRASEQ_BASE_URL: process.env.TRASEQ_BASE_URL,
    };
    for (const key of legacyProviderEnv) {
      previousEnv[key] = process.env[key];
    }
    const previousFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (url, init = {}) => {
        assert.equal(init.headers['x-api-key'], 'test-key');

        const pathname = new URL(String(url)).pathname;
        let payload;
        switch (pathname) {
          case '/public/v1':
            payload = { name: 'Traseq Agent API', version: 'v1' };
            break;
          case '/public/v1/workspace':
            payload = {
              workspace: { id: 'org-1', name: 'Demo' },
              apiKey: { scopes: ['workspace_read'] },
            };
            break;
          case '/public/v1/usage':
            payload = { usage: { backtests: 0 }, limits: { backtests: 100 } };
            break;
          case '/public/v1/capabilities':
            payload = {
              protocol: 'traseq.capabilities',
              version: 1,
              subscriptionTier: 'pro',
              limits: { maxExits: 1 },
              signalGraph: { version: 2, nodes: [], bindings: [] },
              indicators: [],
              operators: { compare: ['gt'], cross: ['cross_up'] },
            };
            break;
          default:
            return new Response('not found', { status: 404 });
        }

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      process.env.TRASEQ_API_KEY = 'test-key';
      process.env.TRASEQ_BASE_URL = 'https://api.test.local';
      for (const key of legacyProviderEnv) {
        delete process.env[key];
      }

      const events = [];
      const result = await runResearch(
        {
          prompt: 'Research a simple BTC trend-following strategy.',
          instrument: 'BTCUSDT',
          timeframe: '4h',
          rounds: 2,
        },
        (event) => {
          events.push(event.type);
        },
      );

      assert.equal(result.input.instrument, 'BTCUSDT');
      assert.equal(result.live.capabilitySummary.subscriptionTier, 'pro');
      assert.ok(result.prompts.authoring.includes('external AI agent'));
      assert.ok(
        result.recommendedWorkflow.some((step) => step.phase === 'backtest'),
      );
      assert.ok(events.includes('meta'));
      assert.ok(events.includes('completed'));
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
