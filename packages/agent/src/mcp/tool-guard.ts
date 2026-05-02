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
 * We look at three signals (in order):
 *   - `publicAgent.code` for known structured codes the API may emit
 *   - `parsedBody.errorCode` for legacy code shape
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
      'Call run_guided_research_round with both `strategyId` and `forkedFromVersionId` — it derives the fork target automatically when you pass the prior round result.',
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
];

export function augmentToolError(
  toolName: string,
  error: unknown,
): ErrorAugmentation {
  if (!(error instanceof TraseqApiError)) {
    return { extraNextSteps: [], hintCode: null };
  }
  // Only augment for tools where state-machine violations are plausible —
  // avoids leaking guided-round suggestions into unrelated error paths.
  const STATE_GATED_TOOLS = new Set([
    'run_backtest',
    'finalize_strategy_version',
    'create_strategy_version',
    'create_pine_export',
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
