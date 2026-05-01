import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, isAbsolute, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { SignalEvent, TraseqClient } from '@traseq/sdk';

function encodeContinuationCursor(event: SignalEvent): string {
  return Buffer.from(
    JSON.stringify({ createdAt: event.createdAt, id: event.id }),
  ).toString('base64url');
}

export interface EventAdapterContext {
  dryRun: boolean;
  config: Record<string, string | undefined>;
}

export type EventAdapter = (
  event: SignalEvent,
  context: EventAdapterContext,
) => Promise<void> | void;

type EventState = {
  cursor: string | null;
  processed: Record<string, string>;
};

type StateStore = {
  read(): Promise<EventState>;
  write(state: EventState): Promise<void>;
  /**
   * Atomically record a single processed event. Used by the webhook bridge
   * where multiple inbound deliveries may interleave; whole-state writes
   * would race and the SQLite implementation would also be O(n) per write.
   */
  recordProcessed(eventId: string, processedAt: string): Promise<void>;
  recordCursor(cursor: string | null): Promise<void>;
};

/**
 * Serializes async work for a single key. Used by the webhook bridge so two
 * concurrent deliveries with the same event id deduplicate cleanly without
 * racing on the in-memory state object.
 */
class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.chains.set(
      key,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      // Best-effort cleanup once nothing is queued behind us.
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    }
  }
}

type EventRuntimeOptions = {
  adapter?: string;
  dryRun?: boolean;
  stateDir?: string;
};

type AdapterLoadOptions = {
  adapterRef?: string | undefined;
  dryRun: boolean;
  allowDryRunAdapterExecution?: boolean;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_LIMIT = 50;
const MAX_PROCESSED_IDS = 5_000;

function defaultStatePath(stateDir?: string): string {
  const base =
    stateDir ??
    process.env.TRASEQ_AGENT_STATE_DIR ??
    resolve(homedir(), '.traseq-agent');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // base is operator-supplied config (CLI flag or env var) for this CLI's own state dir; not network input.
  return resolve(base, 'events.sqlite');
}

async function createStateStore(path: string): Promise<StateStore> {
  const sqliteStore = await createSqliteStore(path).catch(() => null);
  if (sqliteStore) {
    return sqliteStore;
  }
  return createJsonStateStore(`${path}.json`);
}

async function createJsonStateStore(path: string): Promise<StateStore> {
  let cached: EventState | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const ensureLoaded = async () => {
    if (!cached) cached = await readJsonState(path);
    return cached;
  };

  const flush = (): Promise<void> => {
    writeChain = writeChain
      .catch(() => undefined)
      .then(() => writeJsonState(path, cached!));
    return writeChain;
  };

  return {
    async read() {
      const state = await ensureLoaded();
      return {
        cursor: state.cursor,
        processed: { ...state.processed },
      };
    },
    async write(state) {
      cached = {
        cursor: state.cursor,
        processed: { ...state.processed },
      };
      await flush();
    },
    async recordProcessed(eventId, processedAt) {
      const state = await ensureLoaded();
      state.processed[eventId] = processedAt;
      const entries = Object.entries(state.processed);
      if (entries.length > MAX_PROCESSED_IDS) {
        state.processed = Object.fromEntries(entries.slice(-MAX_PROCESSED_IDS));
      }
      await flush();
    },
    async recordCursor(cursor) {
      const state = await ensureLoaded();
      state.cursor = cursor;
      await flush();
    },
  };
}

async function readJsonState(path: string): Promise<EventState> {
  if (!existsSync(path)) {
    return { cursor: null, processed: {} };
  }

  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as EventState;
    return {
      cursor: parsed.cursor ?? null,
      processed: parsed.processed ?? {},
    };
  } catch {
    return { cursor: null, processed: {} };
  }
}

async function writeJsonState(path: string, state: EventState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const processedEntries = Object.entries(state.processed).slice(
    -MAX_PROCESSED_IDS,
  );
  await writeFile(
    path,
    JSON.stringify(
      {
        cursor: state.cursor,
        processed: Object.fromEntries(processedEntries),
      },
      null,
      2,
    ),
  );
}

async function createSqliteStore(path: string): Promise<StateStore> {
  await mkdir(dirname(path), { recursive: true });
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<{
    DatabaseSync: new (path: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
        run(...params: unknown[]): void;
      };
    };
  }>;
  const sqlite = await importer('node:sqlite');
  const db = new sqlite.DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_events (
      id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
  `);

  const upsertCursor = db.prepare(
    'INSERT INTO event_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const upsertProcessed = db.prepare(
    'INSERT OR REPLACE INTO processed_events (id, processed_at) VALUES (?, ?)',
  );
  const trimProcessed = db.prepare(
    `DELETE FROM processed_events
     WHERE id IN (
       SELECT id FROM processed_events
       ORDER BY processed_at ASC
       LIMIT MAX(0, (SELECT COUNT(*) FROM processed_events) - ?)
     )`,
  );

  const trimIfNeeded = () => {
    trimProcessed.run(MAX_PROCESSED_IDS);
  };

  return {
    async read() {
      const cursorRow = db
        .prepare('SELECT value FROM event_state WHERE key = ?')
        .get('cursor') as { value?: string } | undefined;
      const rows = db
        .prepare(
          'SELECT id, processed_at AS processedAt FROM processed_events ORDER BY processed_at DESC LIMIT ?',
        )
        .all(MAX_PROCESSED_IDS) as Array<{
        id: string;
        processedAt: string;
      }>;
      return {
        cursor: cursorRow?.value ? cursorRow.value : null,
        processed: Object.fromEntries(
          rows.map((row) => [row.id, row.processedAt]),
        ),
      };
    },
    async write(state) {
      // Bulk write: only used by listenForSignalEvents which holds the
      // single-writer invariant. Webhook bridge uses recordProcessed instead
      // so two concurrent deliveries do not race here.
      upsertCursor.run('cursor', state.cursor ?? '');
      for (const [id, processedAt] of Object.entries(state.processed)) {
        upsertProcessed.run(id, processedAt);
      }
      trimIfNeeded();
    },
    async recordProcessed(eventId, processedAt) {
      upsertProcessed.run(eventId, processedAt);
      trimIfNeeded();
    },
    async recordCursor(cursor) {
      upsertCursor.run('cursor', cursor ?? '');
    },
  };
}

function adapterConfig(): Record<string, string | undefined> {
  return {
    TRASEQ_AGENT_FORWARD_URL: process.env.TRASEQ_AGENT_FORWARD_URL,
  };
}

function dryRunBlockedAdapter(ref: string): EventAdapter {
  return async (event) => {
    process.stdout.write(
      JSON.stringify({
        dryRun: true,
        skippedAdapter: ref,
        reason: 'custom_or_forwarding_adapter_requires_live_mode',
        event,
      }) + '\n',
    );
  };
}

async function loadAdapter(options: AdapterLoadOptions): Promise<EventAdapter> {
  const ref =
    options.adapterRef ?? process.env.TRASEQ_AGENT_EVENT_ADAPTER ?? 'stdout';
  if (ref === 'stdout') {
    return async (event, context) => {
      process.stdout.write(
        JSON.stringify({ dryRun: context.dryRun, event }) + '\n',
      );
    };
  }

  if (ref === 'paper') {
    return async (event, context) => {
      process.stdout.write(
        JSON.stringify({
          adapter: 'paper',
          dryRun: context.dryRun,
          accepted: true,
          event,
        }) + '\n',
      );
    };
  }

  if (ref === 'webhook-forwarder') {
    if (options.dryRun && !options.allowDryRunAdapterExecution) {
      return dryRunBlockedAdapter(ref);
    }
    return async (event) => {
      const url = process.env.TRASEQ_AGENT_FORWARD_URL;
      if (!url) {
        throw new Error(
          'TRASEQ_AGENT_FORWARD_URL is required for webhook-forwarder adapter.',
        );
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        throw new Error(
          `Forward target responded with HTTP ${response.status}`,
        );
      }
    };
  }

  if (options.dryRun && !options.allowDryRunAdapterExecution) {
    return dryRunBlockedAdapter(ref);
  }

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  // ref is the operator-provided adapter module path (CLI flag or TRASEQ_AGENT_EVENT_ADAPTER env var); loading arbitrary local modules is the feature.
  const filePath = isAbsolute(ref) ? ref : resolve(process.cwd(), ref);
  const mod = (await import(pathToFileURL(filePath).href)) as {
    default?: EventAdapter;
    handleEvent?: EventAdapter;
  };
  const adapter = mod.default ?? mod.handleEvent;
  if (typeof adapter !== 'function') {
    throw new Error(
      'Adapter module must export a default function or handleEvent(event, context).',
    );
  }
  return adapter;
}

async function processEvent(
  event: SignalEvent,
  state: EventState,
  adapter: EventAdapter,
  options: Required<Pick<EventRuntimeOptions, 'dryRun'>>,
): Promise<boolean> {
  if (state.processed[event.id]) {
    return false;
  }

  await adapter(event, {
    dryRun: options.dryRun,
    config: adapterConfig(),
  });
  state.processed[event.id] = new Date().toISOString();
  return true;
}

export async function listenForSignalEvents(
  client: TraseqClient,
  options: EventRuntimeOptions & {
    intervalMs?: number;
    limit?: number;
    once?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const statePath = defaultStatePath(options.stateDir);
  const stateStore = await createStateStore(statePath);
  const state = await stateStore.read();
  const dryRun = options.dryRun ?? true;
  const adapter = await loadAdapter({
    adapterRef: options.adapter,
    dryRun,
  });
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const abort = options.signal;

  while (!abort?.aborted) {
    const page = await client.listSignalEvents({
      ...(state.cursor ? { cursor: state.cursor } : {}),
      limit,
    });

    for (const event of page.data) {
      if (abort?.aborted) return;
      const ran = await processEvent(event, state, adapter, { dryRun });
      const processedAt = state.processed[event.id];
      if (ran && processedAt) {
        await stateStore.recordProcessed(event.id, processedAt);
      }
    }

    // Always advance cursor to the last item we received. The server only
    // returns nextCursor when more pages exist; on the last page (and the
    // first page that drains the queue), we still need to remember our
    // position or the next poll will re-fetch the same events forever.
    const last = page.data[page.data.length - 1];
    state.cursor =
      page.nextCursor ?? (last ? encodeContinuationCursor(last) : state.cursor);
    await stateStore.recordCursor(state.cursor);

    if (options.once) return;
    await sleepWithAbort(intervalMs, abort);
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function verifySignature(params: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
}): boolean {
  if (!params.timestamp || !params.signature?.startsWith('v1=')) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(params.timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
    return false;
  }

  const expected = createHmac('sha256', params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest('hex');
  const received = params.signature.slice('v1='.length);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function serveSignalWebhook(
  options: EventRuntimeOptions & {
    port?: number;
    secret?: string;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const statePath = defaultStatePath(options.stateDir);
  const stateStore = await createStateStore(statePath);
  const dryRun = options.dryRun ?? true;
  const adapter = await loadAdapter({
    adapterRef: options.adapter,
    dryRun,
  });
  const secret = options.secret ?? process.env.TRASEQ_WEBHOOK_SECRET;
  const port = options.port ?? 8787;
  if (!secret) {
    throw new Error(
      'TRASEQ_WEBHOOK_SECRET is required for events serve-webhook signature verification.',
    );
  }
  const mutex = new KeyedMutex();

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      writeJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    try {
      const rawBody = await readRawBody(request);
      if (
        !verifySignature({
          secret,
          rawBody,
          timestamp: request.headers['x-traseq-timestamp'] as
            | string
            | undefined,
          signature: request.headers['x-traseq-signature'] as
            | string
            | undefined,
        })
      ) {
        writeJson(response, 401, { ok: false, error: 'invalid_signature' });
        return;
      }

      const event = JSON.parse(rawBody) as SignalEvent;
      if (!event.id || event.type !== 'strategy.condition.satisfied') {
        writeJson(response, 400, { ok: false, error: 'invalid_event' });
        return;
      }

      const processed = await mutex.run(event.id, async () => {
        const snapshot = await stateStore.read();
        if (snapshot.processed[event.id]) return false;
        await adapter(event, { dryRun, config: adapterConfig() });
        await stateStore.recordProcessed(event.id, new Date().toISOString());
        return true;
      });
      writeJson(response, 200, { ok: true, processed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { ok: false, error: message });
    }
  });

  options.signal?.addEventListener(
    'abort',
    () => {
      server.close();
    },
    { once: true },
  );

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });
  process.stderr.write(
    `traseq-agent webhook listener on http://127.0.0.1:${port}\n`,
  );
}

export async function testEventAdapter(
  adapterRef: string,
  options: EventRuntimeOptions = {},
): Promise<void> {
  const dryRun = options.dryRun ?? true;
  const adapter = await loadAdapter({
    adapterRef,
    dryRun,
    allowDryRunAdapterExecution: true,
  });
  const event: SignalEvent = {
    id: 'evt_test_adapter',
    type: 'strategy.condition.satisfied',
    monitorId: 'mon_test',
    strategyVersionId: 'ver_test',
    strategyHash: 'test_hash',
    evaluationStatus: 'evaluated',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    conditionRole: 'entry_condition',
    triggerPolicy: 'rising_edge',
    barOpenTs: Date.now() - 3_600_000,
    barCloseTs: Date.now(),
    createdAt: new Date().toISOString(),
    payload: {
      id: 'evt_test_adapter',
      type: 'strategy.condition.satisfied',
      createdAt: new Date().toISOString(),
      monitor: {
        id: 'mon_test',
        triggerPolicy: 'rising_edge',
      },
      strategy: {
        versionId: 'ver_test',
        hash: 'test_hash',
      },
      condition: {
        role: 'entry_condition',
      },
      market: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        barOpenTs: Date.now() - 3_600_000,
        barCloseTs: Date.now(),
      },
      evaluation: {
        mode: 'closed_bar',
      },
    },
  };

  await adapter(event, {
    dryRun,
    config: adapterConfig(),
  });
}
