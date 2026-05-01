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
      signalInstrument: { symbol: 'BTCUSDT' },
    }) as BacktestConfigLike,
  };
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
