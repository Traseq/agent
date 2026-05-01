import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listenForSignalEvents } from '../dist/events/index.js';

function signalEvent(id = 'evt_1') {
  const createdAt = new Date().toISOString();
  return {
    id,
    type: 'strategy.condition.satisfied',
    monitorId: 'mon_1',
    strategyVersionId: 'ver_1',
    strategyHash: 'hash_1',
    evaluationStatus: 'evaluated',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    conditionRole: 'entry_condition',
    triggerPolicy: 'rising_edge',
    barOpenTs: Date.now() - 3_600_000,
    barCloseTs: Date.now(),
    createdAt,
    payload: {
      id,
      type: 'strategy.condition.satisfied',
      createdAt,
      monitor: { id: 'mon_1', triggerPolicy: 'rising_edge' },
      strategy: { versionId: 'ver_1', hash: 'hash_1' },
      condition: { role: 'entry_condition' },
      market: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        barOpenTs: Date.now() - 3_600_000,
        barCloseTs: Date.now(),
      },
      evaluation: { mode: 'closed_bar' },
    },
  };
}

function clientWithEvents(events) {
  return {
    async listSignalEvents() {
      return { data: events, nextCursor: null };
    },
  };
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe('events bridge', () => {
  it('does not import or execute custom adapters in dry-run poll mode', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'traseq-agent-events-'));
    try {
      const output = await captureStdout(() =>
        listenForSignalEvents(clientWithEvents([signalEvent()]), {
          once: true,
          dryRun: true,
          adapter: join(stateDir, 'missing-adapter.mjs'),
          stateDir,
        }),
      );

      assert.match(output, /custom_or_forwarding_adapter_requires_live_mode/);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('executes a custom adapter only in live mode', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'traseq-agent-events-'));
    const adapterPath = join(stateDir, 'adapter.mjs');
    globalThis.__traseqAgentEventAdapterCalls = 0;
    try {
      await writeFile(
        adapterPath,
        'export default async function () { globalThis.__traseqAgentEventAdapterCalls = (globalThis.__traseqAgentEventAdapterCalls ?? 0) + 1; }',
      );

      await listenForSignalEvents(clientWithEvents([signalEvent('evt_live')]), {
        once: true,
        dryRun: false,
        adapter: adapterPath,
        stateDir,
      });

      assert.equal(globalThis.__traseqAgentEventAdapterCalls, 1);
    } finally {
      delete globalThis.__traseqAgentEventAdapterCalls;
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
