import type {
  AmbiguityResolution,
  BacktestConfigLike,
  JsonObject,
  NormalizedBacktestAppLinks,
  NormalizedBacktestResult,
  NormalizedBacktestRunContext,
  ResearchChange,
  RoundAnalysis,
  StrategyDraftLike,
  StrategySettings,
  ValidationSummaryLike,
} from './types.js';

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function asStringArray(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, limit);
}

export function parseJsonObject(text: string): JsonObject {
  const trimmed = text.trim();

  // Try the full text first.
  const directResult = tryParseObject(trimmed);
  if (directResult) {
    return directResult;
  }

  // Fallback: extract the *outermost* balanced `{ … }` block.
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('Response did not contain a valid JSON object.');
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error('Response did not contain a valid JSON object.');
  }

  const sliced = trimmed.slice(firstBrace, end + 1);
  const result = tryParseObject(sliced);
  if (!result) {
    throw new Error('Response did not contain a valid JSON object.');
  }

  return result;
}

function tryParseObject(text: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Draft normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw draft (typically straight from an LLM producer) into the
 * `StrategyDraftLike` shape consumed by the runner.
 *
 * Intentional non-defaults: when `source.backtest` is missing or omits
 * `signalInstrument`, we DO NOT inject `BTCUSDT`. Earlier versions did, which
 * silently overrode the caller's `input.instrument` because `buildBacktestConfig`
 * preferred `draftBacktest.signalInstrument` when present. The runner now lets
 * `buildBacktestConfig` fill the symbol from `input.instrument` instead, and
 * the `signalInstrument` field is left undefined here so the spread merge in
 * `buildBacktestConfig` resolves to the caller's intent.
 *
 * Callers that consume `normalizeDraft` directly (i.e. without going through
 * `buildBacktestConfig`) should treat `backtest.signalInstrument` as optional
 * and handle the missing-symbol case explicitly.
 */
export function normalizeDraft(draft: unknown): StrategyDraftLike {
  const source = asJsonObject(draft) ?? {};
  return {
    name: asString(source.name, 'Untitled strategy'),
    ...(asString(source.description)
      ? { description: asString(source.description) }
      : {}),
    signalGraph: asJsonObject(source.signalGraph) ?? {},
    settings: normalizeNextSettings(source.settings) ?? {
      positionStyle: 'single',
    },
    backtest: (asJsonObject(source.backtest) ?? {
      timeframe: '4h',
    }) as unknown as BacktestConfigLike,
  };
}

// ---------------------------------------------------------------------------
// Range / time-input normalization (request side)
// ---------------------------------------------------------------------------

/**
 * Result of `resolveRangePoint`. The runBacktest endpoint itself accepts
 * strings ("inception", "now", "1y", ISO dates, etc.), but earlier stages in
 * the agent pipeline — preflight, validate, persistence-stage feeModel/range
 * checks — historically expected numeric epoch values. To bridge the two,
 * the runner pre-resolves common string forms to epoch ms BEFORE the draft
 * leaves the agent layer. We keep the original string in `originalInput` so
 * an audit log can show the LLM what we did.
 *
 *   - `resolved: number`              — finite epoch ms (UTC)
 *   - `resolved: undefined`           — caller passed null/undefined; let API default
 *   - `resolved: 'inception' | 'now'` — symbolic token preserved (server resolves)
 *
 * Anything we can't recognize is left as the original string so the API still
 * has a chance to handle it; we never throw from this helper.
 */
export interface ResolvedRangePoint {
  /**
   * Either an epoch-ms number, a symbolic token the API understands
   * ('inception' | 'now'), or undefined to fall back to the API default.
   * Unrecognized strings are returned verbatim so the API still has a chance
   * to interpret them — typing this as `string` keeps the passthrough sound.
   */
  resolved: number | string | undefined;
  /** True when we changed the value (e.g. ISO → ms). */
  changed: boolean;
  originalInput: unknown;
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
// 10-digit unix seconds (≈ 2001-09-09 .. 2286-11-20) and 13-digit unix ms.
const EPOCH_SECONDS_MIN = 1_000_000_000; // 2001-09
const EPOCH_SECONDS_MAX = 9_999_999_999; // 2286-11
const EPOCH_MS_MIN = 1_000_000_000_000; // 2001-09
const EPOCH_MS_MAX = 99_999_999_999_999; // 5138-11

/**
 * Resolve a single range endpoint into either an epoch-ms number, undefined
 * (defer to API default), or one of the symbolic tokens runBacktest understands.
 *
 * Why this exists: LLM-authored drafts frequently set `range.start = "inception"`
 * or `range.end = "now"`. The runBacktest endpoint accepts those, but earlier
 * pipeline stages (estimateBacktestCost, persistence preflight, agent-side
 * validators) historically required numbers. Pre-resolving here lets the
 * runner pass a numeric value through the whole pipeline without divergence.
 *
 * Accepted inputs:
 *   - number   → if 13-digit ms, returned verbatim; if 10-digit seconds, scaled.
 *   - string ISO date ("2024-01-01" or "2024-01-01T00:00:00Z") → parsed to ms.
 *   - "inception" / "now" / "ytd" → preserved as symbolic token (or resolved
 *     for "ytd" — Jan 1 of current year — since "ytd" is end-anchored more
 *     often than start-anchored and the engine gives identical resolution).
 *   - relative durations ("1y", "6m", "30d", "2w") → resolved relative to
 *     `referenceMs` (default Date.now()) by SUBTRACTING the duration. Common
 *     LLM idiom for `range.start = "1y"` means "one year ago".
 *   - undefined / null / empty string → undefined (API default applies).
 *
 * Anything else → the original input is returned in `originalInput` and
 * `resolved` is the input itself (string passthrough). The API may still
 * accept it; we don't reject client-side.
 */
export function resolveRangePoint(
  value: unknown,
  options: { referenceMs?: number } = {},
): ResolvedRangePoint {
  if (value === undefined || value === null) {
    return { resolved: undefined, changed: false, originalInput: value };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { resolved: undefined, changed: true, originalInput: value };
    }
    if (value >= EPOCH_MS_MIN && value <= EPOCH_MS_MAX) {
      return { resolved: value, changed: false, originalInput: value };
    }
    if (value >= EPOCH_SECONDS_MIN && value <= EPOCH_SECONDS_MAX) {
      return {
        resolved: Math.round(value * 1000),
        changed: true,
        originalInput: value,
      };
    }
    // Out-of-range numeric — let the API decide.
    return { resolved: value, changed: false, originalInput: value };
  }

  if (typeof value !== 'string') {
    return { resolved: undefined, changed: false, originalInput: value };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { resolved: undefined, changed: true, originalInput: value };
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'inception' || lowered === 'now') {
    return { resolved: lowered, changed: false, originalInput: value };
  }
  const reference = options.referenceMs ?? Date.now();
  if (lowered === 'ytd') {
    const yearStart = Date.UTC(new Date(reference).getUTCFullYear(), 0, 1);
    return { resolved: yearStart, changed: true, originalInput: value };
  }

  const relativeMs = parseRelativeDurationMs(lowered);
  if (relativeMs !== undefined) {
    return {
      resolved: reference - relativeMs,
      changed: true,
      originalInput: value,
    };
  }

  if (ISO_DATE_RE.test(trimmed)) {
    const parsed = Date.parse(
      // Bare YYYY-MM-DD is parsed as UTC midnight by Date.parse in V8, but a
      // YYYY-MM-DD HH:MM (space, no zone) is parsed as local time. Normalize
      // the space form to ISO before parsing so the result is venue-stable.
      trimmed.replace(' ', 'T'),
    );
    if (Number.isFinite(parsed)) {
      return { resolved: parsed, changed: true, originalInput: value };
    }
  }

  // Fallback: leave the string as-is. runBacktest may still accept it.
  return { resolved: trimmed, changed: false, originalInput: value };
}

const RELATIVE_DURATION_RE = /^(\d+)\s*([ymwd])$/;
const DURATION_UNITS: Record<string, number> = {
  y: 365 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseRelativeDurationMs(value: string): number | undefined {
  const match = RELATIVE_DURATION_RE.exec(value);
  if (!match) {
    return undefined;
  }
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unitMs = DURATION_UNITS[match[2] ?? ''];
  if (!Number.isFinite(amount) || amount <= 0 || unitMs === undefined) {
    return undefined;
  }
  return amount * unitMs;
}

export interface ResolvedBacktestRangePatch {
  /** When true, the caller mutated `range` and should reflect the new shape. */
  changed: boolean;
  /** Human-readable patch list for audit/log entries. */
  patches: readonly string[];
}

/**
 * Resolve a backtest range in-place on a draft's backtest config. Returns the
 * audit patches so the runner can emit one log line per resolved field. The
 * mutated config matches whatever shape the caller passed (we only touch
 * `range.start`/`range.end`).
 *
 * Rules:
 *   - `range` undefined/null              → no-op
 *   - either endpoint resolves to number  → write back as number
 *   - either endpoint resolves to symbolic token → leave as the lowercased token
 *   - either endpoint resolves to undefined → DELETE that endpoint entirely
 *     (callers expect `start: undefined` to mean "use API default")
 */
export function resolveBacktestRangeInPlace(
  config: { range?: unknown } | undefined,
  options: { referenceMs?: number } = {},
): ResolvedBacktestRangePatch {
  if (!config) {
    return { changed: false, patches: [] };
  }
  const range = asJsonObject(config.range);
  if (!range) {
    return { changed: false, patches: [] };
  }

  const hadStart = 'start' in range;
  const hadEnd = 'end' in range;
  const patches: string[] = [];
  let changed = false;

  for (const key of ['start', 'end'] as const) {
    if (!(key in range)) continue;
    const before = range[key];
    const result = resolveRangePoint(before, options);
    // Symbolic tokens get stripped unconditionally: omitting `range.start`
    // is equivalent to the API default ("inception"), and omitting
    // `range.end` is equivalent to "now". The SDK's local preflight would
    // otherwise reject the string even though runBacktest accepts it.
    // Same end-state, fewer rejections.
    const isSymbolicToken =
      result.resolved === 'inception' || result.resolved === 'now';
    if (result.resolved === undefined || isSymbolicToken) {
      delete range[key];
      changed = true;
      patches.push(
        `range.${key}: ${JSON.stringify(before)} → omitted (API default${
          isSymbolicToken ? ` "${String(result.resolved)}"` : ''
        })`,
      );
      continue;
    }
    if (!result.changed && before === result.resolved) {
      continue;
    }
    (range as Record<string, unknown>)[key] = result.resolved;
    changed = true;
    patches.push(
      `range.${key}: ${JSON.stringify(before)} → ${JSON.stringify(
        result.resolved,
      )}`,
    );
  }

  // If we dropped both endpoints and nothing else lives on `range`, remove
  // the whole `range` object too. SDK preflight and persistence treat
  // `range: {}` differently from `range: undefined`; the latter means "use
  // full available history", which is what dropping symbolic tokens implied.
  if (
    (hadStart || hadEnd) &&
    !('start' in range) &&
    !('end' in range) &&
    Object.keys(range).length === 0
  ) {
    delete (config as Record<string, unknown>).range;
    changed = true;
    patches.push('range: {} → omitted (no remaining endpoints)');
  }

  return { changed, patches };
}

// ---------------------------------------------------------------------------
// Indicator-period extraction (used to bump warmup before persistence)
// ---------------------------------------------------------------------------

/**
 * Inspect a signalGraph and return the largest lookback period any indicator
 * or rolling node uses, or `undefined` if no period-bearing nodes are present.
 *
 * Why: persistence and finalize gate on a warmup that's at least as long as
 * the longest indicator's lookback. The validator may emit a "warmup
 * insufficient" warning that blocks finalize. We can compute the same number
 * client-side from the draft and bump warmup proactively, so the LLM doesn't
 * spend a repair cycle on a deterministic fix.
 *
 * Recognized lookback fields, in priority order:
 *   - `args.length`  (canonical indicator vocabulary)
 *   - `args.period`  (rolling nodes, plus pre-vocab-normalization indicators)
 *   - `args.window`  (rolling nodes alternate)
 *   - `period`       (top-level on rolling nodes; some legacy shapes)
 *
 * Multi-indicator nodes (e.g. MACD with `fastLength`/`slowLength`/
 * `signalLength`) expose all three lengths under `args`; we scan every
 * numeric arg key ending in /length|period|window/i to catch them.
 */
export function maxIndicatorPeriod(signalGraph: unknown): number | undefined {
  const source = asJsonObject(signalGraph);
  if (!source) return undefined;
  const nodes = source.nodes;
  if (!Array.isArray(nodes)) return undefined;

  let best: number | undefined;
  const considerCandidate = (raw: unknown): void => {
    const value = asNumber(raw);
    if (value === undefined || value <= 0) return;
    const rounded = Math.round(value);
    if (best === undefined || rounded > best) {
      best = rounded;
    }
  };

  const PERIOD_KEY_RE = /(length|period|window)$/i;
  for (const rawNode of nodes) {
    const node = asJsonObject(rawNode);
    if (!node) continue;

    considerCandidate(node.period);
    considerCandidate(node.length);
    considerCandidate(node.window);

    const args = asJsonObject(node.args);
    if (!args) continue;

    for (const [key, value] of Object.entries(args)) {
      if (PERIOD_KEY_RE.test(key)) {
        considerCandidate(value);
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Validation normalization
// ---------------------------------------------------------------------------

function normalizeValidationIssues(
  value: unknown,
): NonNullable<ValidationSummaryLike['issues']['signalGraph']> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const source = asJsonObject(item);
      if (!source) {
        return null;
      }

      const message = asString(source.message);
      if (!message) {
        return null;
      }

      const severity: 'error' | 'warning' | undefined =
        source.severity === 'error' || source.severity === 'warning'
          ? source.severity
          : undefined;

      const issue: NonNullable<
        ValidationSummaryLike['issues']['signalGraph']
      >[number] = {
        message,
      };

      const code = asString(source.code);
      if (code) {
        issue.code = code;
      }

      const path = asString(source.path);
      if (path) {
        issue.path = path;
      }

      const field = asString(source.field);
      if (field) {
        issue.field = field;
      }

      const suggestion = asString(source.suggestion);
      if (suggestion) {
        issue.suggestion = suggestion;
      }

      const details = asString(source.details);
      if (details) {
        issue.details = details;
      }

      if (severity) {
        issue.severity = severity;
      }

      const blockA = asBlockRef(source.blockA);
      if (blockA) {
        issue.blockA = blockA;
      }
      const blockB = asBlockRef(source.blockB);
      if (blockB) {
        issue.blockB = blockB;
      }

      return issue;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function asBlockRef(value: unknown): { id: string; name: string } | undefined {
  const source = asJsonObject(value);
  if (!source) {
    return undefined;
  }
  const id = asString(source.id);
  const name = asString(source.name);
  if (!id || !name) {
    return undefined;
  }
  return { id, name };
}

type IssueGroup = 'signalGraph' | 'settings' | 'conflicts';

function groupForIssue(
  issue: NonNullable<ValidationSummaryLike['issues']['signalGraph']>[number],
): IssueGroup {
  if (issue.blockA || issue.blockB) {
    return 'conflicts';
  }
  switch (issue.field) {
    case 'signalGraph':
    case 'settings':
    case 'conflicts':
      return issue.field;
  }
  const path = issue.path ?? '';
  if (path.startsWith('settings')) return 'settings';
  if (path.startsWith('conflicts')) return 'conflicts';
  return 'signalGraph';
}

export function normalizeValidation(
  validation: unknown,
): ValidationSummaryLike {
  const source = asJsonObject(validation) ?? {};
  const rawIssues = source.issues;

  if (Array.isArray(rawIssues)) {
    const issueList = normalizeValidationIssues(rawIssues);
    const grouped: Required<ValidationSummaryLike['issues']> = {
      signalGraph: [],
      settings: [],
      conflicts: [],
    };
    for (const issue of issueList) {
      grouped[groupForIssue(issue)].push(issue);
    }
    return {
      valid: source.valid === true,
      summary: {
        errors: asNumber(asJsonObject(source.summary)?.errors) ?? 0,
        warnings: asNumber(asJsonObject(source.summary)?.warnings) ?? 0,
      },
      issues: grouped,
    };
  }

  const issues = asJsonObject(rawIssues) ?? {};
  return {
    valid: source.valid === true,
    summary: {
      errors: asNumber(asJsonObject(source.summary)?.errors) ?? 0,
      warnings: asNumber(asJsonObject(source.summary)?.warnings) ?? 0,
    },
    issues: {
      signalGraph: normalizeValidationIssues(issues.signalGraph),
      settings: normalizeValidationIssues(issues.settings),
      conflicts: normalizeValidationIssues(issues.conflicts),
    },
  };
}

// ---------------------------------------------------------------------------
// Backtest normalization
// ---------------------------------------------------------------------------

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const record: Record<string, string> = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (typeof innerValue === 'string') {
      record[key] = innerValue;
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableRangePoint(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function normalizeBacktestAppLinks(value: unknown): NormalizedBacktestAppLinks {
  const source = asJsonObject(value) ?? {};
  const links: NormalizedBacktestAppLinks = {
    backtest: asString(source.backtest),
    backtestCharts: asString(source.backtestCharts),
    backtestTrades: asString(source.backtestTrades),
    backtestAnalytics: asString(source.backtestAnalytics),
  };
  if (typeof source.strategy === 'string' && source.strategy.length > 0) {
    links.strategy = source.strategy;
  }
  if (
    typeof source.strategyBacktests === 'string' &&
    source.strategyBacktests.length > 0
  ) {
    links.strategyBacktests = source.strategyBacktests;
  }
  return links;
}

function normalizeBacktestRunContext(
  value: unknown,
): NormalizedBacktestRunContext {
  const source = asJsonObject(value) ?? {};
  const instrumentSource = asJsonObject(source.instrument) ?? {};
  const rangeSource = asJsonObject(source.range);

  return {
    instrument: {
      symbol: asNullableString(instrumentSource.symbol),
      venue: asNullableString(instrumentSource.venue),
      marketType: asNullableString(instrumentSource.marketType),
    },
    timeframe: asNullableString(source.timeframe),
    range: rangeSource
      ? {
          start: asNullableRangePoint(rangeSource.start),
          end: asNullableRangePoint(rangeSource.end),
        }
      : null,
    initialBalance: asNullableNumber(source.initialBalance),
    execution: asJsonObject(source.execution) ?? null,
    strategyId: asNullableString(source.strategyId),
    strategyVersionId: asNullableString(source.strategyVersionId),
    strategyVersionNumber: asNullableNumber(source.strategyVersionNumber),
    createdAt: asNullableString(source.createdAt),
    startedAt: asNullableString(source.startedAt),
    finishedAt: asNullableString(source.finishedAt),
  };
}

export function normalizeBacktest(backtest: unknown): NormalizedBacktestResult {
  const source = asJsonObject(backtest) ?? {};
  const nestedResult = asJsonObject(source.result);
  const summary =
    asJsonObject(source.summaryJson) ?? asJsonObject(nestedResult?.summaryJson);

  const result: NormalizedBacktestResult = {
    id: asString(source.id, 'unknown-backtest'),
    status: asString(source.status, 'unknown'),
    appLinks: normalizeBacktestAppLinks(source.appLinks),
    runContext: normalizeBacktestRunContext(source.runContext),
    raw: source,
  };

  if (summary) {
    result.summary = summary;
  }

  const artifactUrls = toStringRecord(nestedResult?.artifactUrls);
  if (artifactUrls) {
    result.artifactUrls = artifactUrls;
  }

  if (asJsonObject(source.strategy) || source.strategy === null) {
    result.strategy =
      (source.strategy as JsonObject | null | undefined) ?? null;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Change & settings normalization (used by analysis)
// ---------------------------------------------------------------------------

export function normalizeChange(
  raw: unknown,
  fallbackIndex: number,
): ResearchChange | null {
  const source = asJsonObject(raw);
  if (!source) {
    return null;
  }

  const category = asString(source.category) as ResearchChange['category'];
  const title = asString(source.title, `Change ${fallbackIndex + 1}`);
  const reason = asString(source.reason, 'No explicit rationale provided.');

  if (!title || !reason) {
    return null;
  }

  return {
    category:
      category === 'entry' ||
      category === 'exit' ||
      category === 'risk' ||
      category === 'filter' ||
      category === 'positioning' ||
      category === 'backtest'
        ? category
        : 'other',
    title,
    before: asString(source.before, 'Before state not specified.'),
    after: asString(source.after, 'After state not specified.'),
    reason,
    expectedImpact: asString(
      source.expectedImpact,
      'Expected impact not specified.',
    ),
  };
}

export function normalizeNextSettings(
  value: unknown,
): StrategySettings | undefined {
  const source = asJsonObject(value);
  if (!source) {
    return undefined;
  }

  const warmupPeriod = asNumber(source.warmupPeriod);
  const maxConcurrentPositions = asNumber(source.maxConcurrentPositions);
  const style = asString(source.positionStyle);

  const roundedWarmup =
    warmupPeriod !== undefined && warmupPeriod >= 0
      ? Math.round(warmupPeriod)
      : undefined;

  if (style === 'accumulate') {
    return {
      ...(source as unknown as StrategySettings),
      positionStyle: 'accumulate',
      ...(roundedWarmup !== undefined ? { warmupPeriod: roundedWarmup } : {}),
    } as StrategySettings;
  }

  if (style === 'pyramid' || (maxConcurrentPositions ?? 1) > 1) {
    return {
      positionStyle: 'pyramid',
      maxConcurrentPositions: Math.max(
        1,
        Math.round(maxConcurrentPositions ?? 2),
      ),
      ...(roundedWarmup !== undefined ? { warmupPeriod: roundedWarmup } : {}),
    };
  }

  if (style === 'single' || roundedWarmup !== undefined) {
    return {
      positionStyle: 'single',
      ...(roundedWarmup !== undefined ? { warmupPeriod: roundedWarmup } : {}),
    };
  }

  return undefined;
}

export function normalizeNextBacktest(
  value: unknown,
): RoundAnalysis['nextBacktest'] | undefined {
  const source = asJsonObject(value);
  if (!source) {
    return undefined;
  }

  const next: NonNullable<RoundAnalysis['nextBacktest']> = {};

  const initialBalance = asNumber(source.initialBalance);
  if (initialBalance !== undefined && initialBalance > 0) {
    next.initialBalance = initialBalance;
  }

  const execution = asJsonObject(source.execution);
  if (execution) {
    next.execution = execution as NonNullable<typeof next.execution>;
  }

  const portfolioRisk = asJsonObject(source.portfolioRisk);
  if (portfolioRisk) {
    next.portfolioRisk = portfolioRisk as NonNullable<
      typeof next.portfolioRisk
    >;
  }

  const ambiguityResolution = asString(source.ambiguityResolution);
  if (
    ambiguityResolution === 'multi_resolution' ||
    ambiguityResolution === 'pessimistic' ||
    ambiguityResolution === 'bar_direction' ||
    ambiguityResolution === 'distance'
  ) {
    next.ambiguityResolution = ambiguityResolution as AmbiguityResolution;
  }

  const ambiguityFallback = asString(source.ambiguityFallback);
  if (
    ambiguityFallback === 'pessimistic' ||
    ambiguityFallback === 'bar_direction' ||
    ambiguityFallback === 'distance'
  ) {
    next.ambiguityFallback = ambiguityFallback as Exclude<
      AmbiguityResolution,
      'multi_resolution'
    >;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}
