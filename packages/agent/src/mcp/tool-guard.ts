import { TraseqApiError } from '@traseq/sdk';

/**
 * Client-side defenses for state-gated platform tools.
 *
 * Two responsibilities:
 *
 *   1. `preflightToolArgs` — cheap synchronous arg-shape checks that don't
 *      require an API round-trip. We can't fetch strategy version state by
 *      ID alone (no SDK method exists for it), so we validate what we can
 *      see locally and reject obviously malformed calls before they cost
 *      a quota hit. Real state preflight would need a new SDK endpoint.
 *
 *   2. `augmentToolError` — pattern-matches API failures that are caused by
 *      state-machine violations and rewrites the response so the LLM sees
 *      an explicit "call run_guided_research_round" next-step. The Traseq
 *      API may return a generic validation error for "version not finalized"
 *      that doesn't name the recovery tool; this module fills that gap on
 *      the client side without backend changes.
 *
 * Both functions are pure — they take/return data and never log or throw.
 * Telemetry is a separate concern (see telemetry.ts).
 */

export interface PreflightFailure {
  readonly code: string;
  readonly message: string;
  readonly nextSteps: readonly string[];
}

// Accept any UUID version digit (1-8 covers v1/v3/v4/v5 plus v6/v7/v8 drafts
// — Traseq generates v7 IDs). Variant nibble check kept loose for the same
// reason: we want to catch obvious not-a-UUID strings, not police RFC 4122.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Synchronous arg-shape check. Returns null if args look valid for the tool's
 * known prerequisites; otherwise returns a structured preflight failure that
 * the caller can render as a tool error without ever calling the API.
 *
 * We deliberately keep this conservative — only reject things we are certain
 * are wrong. False positives would block legitimate advanced workflows.
 */
export function preflightToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): PreflightFailure | null {
  if (toolName === 'run_backtest') {
    const versionId = args.strategyVersionId;
    if (typeof versionId !== 'string' || versionId.length === 0) {
      return {
        code: 'PREFLIGHT_MISSING_STRATEGY_VERSION_ID',
        message:
          'run_backtest requires `strategyVersionId` (the id of a finalized strategy version). It is missing or not a string.',
        nextSteps: [
          'If you have a strategy idea but no finalized version yet, call run_guided_research_round — it validates, persists, finalizes, and backtests in one call.',
          'If you already have a finalized version, fetch it via get_strategy and pass its `id` as `strategyVersionId`.',
        ],
      };
    }
    if (!UUID_RE.test(versionId)) {
      return {
        code: 'PREFLIGHT_INVALID_STRATEGY_VERSION_ID',
        message: `run_backtest received strategyVersionId=${JSON.stringify(versionId)}, which does not look like a Traseq UUID. Common mistake: passing a strategyId (the parent strategy) instead of a strategyVersionId (a specific finalized version).`,
        nextSteps: [
          'Call get_strategy with your strategyId to fetch the strategy detail; the response lists versions with their `id` (strategyVersionId).',
          'For a draft strategy with no finalized version, use run_guided_research_round instead of run_backtest.',
        ],
      };
    }
  }

  return null;
}

/**
 * Detect Traseq API errors caused by state-machine violations and rewrite
 * the rendered output to include an explicit guided-flow recovery hint.
 *
 * We look at these signals (in order):
 *   - `publicAgent.code` for known structured codes the API may emit
 *   - `parsedBody.errorCode` for the backend i18n / domain code
 *   - error message + body string match for state-related phrases
 *
 * Returns the original error reference (for safeErrorMessage to format
 * normally) and an optional `extraNextSteps` list the renderer can append.
 */
export interface ErrorAugmentation {
  readonly extraNextSteps: readonly string[];
  readonly hintCode: string | null;
}

const STATE_HINT_PATTERNS: ReadonlyArray<{
  readonly re: RegExp;
  readonly hintCode: string;
  readonly nextSteps: readonly string[];
}> = [
  {
    re: /not\s+finalized|version\s+is\s+not\s+finalized|status\s*!?=\s*['"]?finalized/i,
    hintCode: 'STRATEGY_VERSION_NOT_FINALIZED',
    nextSteps: [
      'The strategy version must be finalized before it can be backtested.',
      'Call run_guided_research_round with the strategy draft (or with strategyId + forkedFromVersionId for an iteration). It validates, persists, finalizes, and backtests in one step.',
      'Avoid calling finalize_strategy_version directly unless you are running an advanced workflow — guided round handles the gates and error recovery.',
    ],
  },
  {
    re: /forkedFromVersionId|fork.*version.*required|previous\s+version.*required/i,
    hintCode: 'STRATEGY_VERSION_FORK_REQUIRED',
    nextSteps: [
      'Iterating on an existing strategy requires `forkedFromVersionId` pointing at the previous finalized version.',
      'Prefer run_guided_research_round with `strategyId`; the runner auto-resolves the latest ready/finalized version and returns `nextIterationSeed` for the following round.',
      'If you use a lower-level write tool, fetch the strategy detail and pass the previous version id as `forkedFromVersionId` explicitly.',
    ],
  },
  {
    re: /draft.*cannot.*backtest|cannot\s+backtest.*draft/i,
    hintCode: 'STRATEGY_VERSION_STILL_DRAFT',
    nextSteps: [
      'Draft strategy versions cannot be backtested directly.',
      'Call run_guided_research_round to finalize the draft and run a backtest in one step.',
    ],
  },
  {
    // `execution.feeModel` belongs to run_backtest config, not strategy
    // create/finalize. When callers supply execution and it is malformed, the
    // server tends to emit "feeModel is required" / "execution.feeModel must
    // be ..." style messages — point the LLM at the capability spec instead
    // of letting it guess.
    re: /execution\.feeModel|feeModel\s+is\s+required|feeModel\s+must|missing.*feeModel/i,
    hintCode: 'EXECUTION_FEE_MODEL_REQUIRED',
    nextSteps: [
      '`execution.feeModel` belongs to run_backtest config. Do not add it to create_strategy or finalize_strategy_version payloads.',
      'When a default is acceptable, omit `config.execution` and let the server apply workspace defaults.',
      'If you intentionally supply execution, read traseq://capabilities (or call get_capabilities) and fill in `kind: "tiered_maker_taker"` with venue-appropriate tiers.',
    ],
  },
  {
    // The `meta.source.editor` enum is owned by the server schema (e.g.
    // `token-flow | text-dsl | ai | runtime-strategy | signal-graph` in the
    // current repo, but other deployments may have different values like
    // `workspace | ai-pasta | ai-pesto`). Tell the LLM not to guess.
    re: /meta\.source\.editor|source\.editor.*must.*one\s+of|editor.*must\s+be\s+one\s+of/i,
    hintCode: 'META_SOURCE_EDITOR_INVALID',
    nextSteps: [
      '`meta.source.editor` only accepts a server-defined enum. Do not guess from training data; the legal values vary by deployment.',
      'Read traseq://capabilities and look for the source.editor enum, OR omit the field entirely — the server fills in a sensible default for research runs.',
      'For LLM-authored drafts, when you must set it, use the value the server reports for "ai-authored" submissions in the capability spec.',
    ],
  },
  {
    // Warmup-vs-indicator gates emit a recognizable phrase server-side
    // ("warmup", "warmupPeriod", "insufficient warmup", "indicator period",
    // "indicator lookback"). Surface the deterministic fix: bump warmup to the
    // longest lookback. The runner already auto-bumps via
    // `bumpWarmupForIndicatorPeriods`, so if this hint fires it likely means
    // the producer set warmup AFTER the runner normalized — point them at
    // settings.warmupPeriod directly.
    re: /\bwarmup(?:Period)?\b|insufficient\s+warmup|indicator\s+(?:period|lookback)\s+exceeds|warmup.*indicator|indicator.*warmup/i,
    hintCode: 'WARMUP_TOO_LOW',
    nextSteps: [
      "settings.warmupPeriod is shorter than the longest indicator lookback in signalGraph. The engine can't form indicators before warmup completes, so finalize/backtest gates trip.",
      'Set settings.warmupPeriod to at least the longest indicator length you use (length / period / window args). 2× headroom is a common safe default.',
      'When run via `run_guided_research_round`, the runner auto-bumps warmup to the longest detected indicator period — if you keep hitting this, your producer is overriding the runner adjustment.',
    ],
  },
  {
    // `range.start` / `range.end` rejection at the SDK or persistence layer.
    // Most common shapes: "must be number", "must be epoch ms", "expected
    // integer", "range.start invalid", and the dataStart-bound rejection
    // ("before dataStart" / "earlier than instrument inception").
    re: /range\.(?:start|end)|backtest\.range|epoch\s+millisecond|dataStart|instrument\s+inception/i,
    hintCode: 'BACKTEST_RANGE_INVALID',
    nextSteps: [
      'backtest.range.start / range.end accept ISO date ("2024-01-01"), relative duration ("1y"), the symbolic tokens "now"/"inception", or numeric epoch (seconds or milliseconds). Omit either endpoint to fall back to the API default.',
      "If you set a numeric range, range.start must be >= the symbol's `dataStart` (read traseq://instruments) and strictly less than range.end.",
      'When run via `run_guided_research_round`, the runner pre-resolves common string forms to epoch ms — if this fires, your producer likely passed an unrecognizable string. Switch to ISO/relative/symbolic or epoch ms.',
    ],
  },
  {
    // Generic schema-validation backstop: when none of the more specific
    // patterns match but the API reports a `category: validation` failure,
    // we still want the LLM to know which discovery surface to consult,
    // not to assume the platform is broken.
    re: /category[":\s]+validation|VALIDATION_FAILED|schema\s+validation\s+failed/i,
    hintCode: 'SCHEMA_VALIDATION_FAILED',
    nextSteps: [
      'This is a schema/parameter problem, not a platform/quota problem (category: validation). Do not suggest a tier upgrade.',
      'Re-read traseq://capabilities and the structured `issues` for the offending `path` and `code`, then fix the draft and re-run.',
    ],
  },
];

export function augmentToolError(
  toolName: string,
  error: unknown,
): ErrorAugmentation {
  if (!(error instanceof TraseqApiError)) {
    return { extraNextSteps: [], hintCode: null };
  }
  // Only augment for tools where state-machine OR schema-shape violations are
  // plausible. We add `validate_strategy` and `create_strategy` here because
  // the warmup / range / fee-model patterns can fire on any of the write or
  // schema-introspecting endpoints, and the augmentation is conservative
  // (regex-gated) so cross-tool noise stays low.
  const STATE_GATED_TOOLS = new Set([
    'run_backtest',
    'finalize_strategy_version',
    'create_strategy_version',
    'create_strategy',
    'validate_strategy',
    'create_robustness_analysis',
  ]);
  if (!STATE_GATED_TOOLS.has(toolName)) {
    return { extraNextSteps: [], hintCode: null };
  }

  const haystack = [
    error.message,
    error.body ?? '',
    typeof error.parsedBody?.errorCode === 'string'
      ? error.parsedBody.errorCode
      : '',
    error.publicAgent?.code ?? '',
    error.publicAgent?.title ?? '',
    error.publicAgent?.explanation ?? '',
  ]
    .filter(Boolean)
    .join(' | ');

  for (const pattern of STATE_HINT_PATTERNS) {
    if (pattern.re.test(haystack)) {
      return {
        extraNextSteps: pattern.nextSteps,
        hintCode: pattern.hintCode,
      };
    }
  }
  return { extraNextSteps: [], hintCode: null };
}
