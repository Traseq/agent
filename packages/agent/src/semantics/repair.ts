import { asJsonObject } from '../normalize.js';
import type {
  StrategyDraftLike,
  ValidationIssueLike,
  ValidationSummaryLike,
} from '../types.js';

export type ValidationGroup = 'signalGraph' | 'settings' | 'conflicts';

export interface ExplainedIssue {
  group: ValidationGroup;
  severity: 'error' | 'warning';
  code?: string;
  path?: string;
  message: string;
  humanReason: string;
  suggestedFix: string;
  ontologyHints: string[];
}

export interface ExplainValidationIssuesOutput {
  errorCount: number;
  warningCount: number;
  issues: ExplainedIssue[];
  guidance: string[];
}

export interface RepairPatch {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
  rationale: string;
}

export interface SuggestMinimalRepairsOutput {
  patches: RepairPatch[];
  unaddressedIssues: ExplainedIssue[];
  notes: string[];
}

const CODE_PROFILES: Record<
  string,
  { humanReason: string; suggestedFix: string; ontologyHints?: string[] }
> = {
  missing_entry_rules: {
    humanReason:
      'A strategy without entry rules can never open a position; the engine has nothing to evaluate.',
    suggestedFix:
      'Create a bool node for the entry condition and reference it from signalGraph.strategy.entry.trigger.',
    ontologyHints: ['trend.cross', 'momentum.threshold'],
  },
  missing_exit_rules: {
    humanReason:
      'Without exit rules every entry would hold forever; backtests will reject or hang.',
    suggestedFix:
      'Add risk.stopLoss/takeProfits or a single signal exit under signalGraph.strategy.exits[0].when.',
    ontologyHints: ['risk.stop_loss', 'risk.take_profit'],
  },
  unsupported_timeframe: {
    humanReason:
      'The requested timeframe is not in the workspace capability list.',
    suggestedFix:
      'Switch backtest.timeframe to the closest supported value (15m, 1h, 4h, or 1d) returned by get_capabilities.',
  },
  unsupported_indicator: {
    humanReason:
      'An indicator referenced in signalGraph is not present in capabilities.indicators.',
    suggestedFix:
      'Either remove the unsupported node or replace it with the closest supported indicator.',
  },
  invalid_position_style: {
    humanReason:
      'positionStyle must be one of single | pyramid | accumulate to satisfy the engine.',
    suggestedFix:
      "Set settings.positionStyle to 'single' unless the strategy explicitly needs pyramiding or scheduled accumulation.",
  },
  missing_qty: {
    humanReason:
      'The engine cannot size a position without entry.action.sizing or an accumulation cadence.',
    suggestedFix:
      "For positionStyle='single' set signalGraph.strategy.entry.action.sizing. For 'accumulate' configure settings.accumulation.schedule.",
  },
  invalid_warmup_period: {
    humanReason:
      'Warmup must be long enough for the slowest indicator in the graph to produce a finite value.',
    suggestedFix:
      'Raise settings.warmupPeriod to at least the slowest indicator length in bars.',
  },
  invalid_initial_balance: {
    humanReason:
      'Backtest balance must be a positive number greater than the minimum tick the venue requires.',
    suggestedFix: 'Set backtest.initialBalance to a value such as 10000.',
  },
  // Synthetic codes derived in `inferSyntheticCode` from SDK preflight issues
  // (which all carry `strategy_draft_schema`). They give the LLM specific
  // remediation language for the most common indicator-arg drift cases —
  // mostly the same ones `normalizeStrategyDraft` already auto-repairs, but
  // some drafts skip normalize (raw validate_strategy calls, custom flows),
  // so the explanations need to stand on their own.
  indicator_arg_period_alias: {
    humanReason:
      'Indicator nodes use `args.length` for the lookback window; `args.period` is reserved for `kind: "rolling"` nodes only.',
    suggestedFix:
      'Rename the indicator arg from `period` to `length`. If both are set, drop `period` — the indicator schema only reads `length`.',
  },
  indicator_arg_output_misplaced: {
    humanReason:
      'Multi-output indicators expose the selector at the node root (`output: "macd"`), not inside `args`.',
    suggestedFix:
      'Move `args.output` to top-level `output`. For single-output indicators, drop the field entirely.',
  },
  indicator_output_unsupported: {
    humanReason:
      'The indicator does not declare an output selector, so any `output` value will be rejected.',
    suggestedFix:
      'Remove `output` from the indicator node. Read `capabilities.indicators[].outputs` to confirm which indicators support a selector.',
  },
  indicator_output_required: {
    humanReason:
      'This multi-output indicator requires an explicit top-level output selector. Removing the selector changes the contract and will keep failing validation.',
    suggestedFix:
      'Add a valid top-level `output` from `capabilities.indicators[].outputs`. For SuperTrend use `supertrend` for the line or `trend_direction` for the +1/-1 regime.',
  },
  provenance_desync: {
    humanReason:
      'The strategy logic and an editor/provenance representation disagree. SignalGraph v2 remains the write contract; do not change a valid indicator output just to satisfy stale provenance.',
    suggestedFix:
      'Regenerate or omit token/AST provenance from the same SignalGraph. Keep required indicator selectors such as SuperTrend node.output intact.',
  },
  indicator_arg_unknown: {
    humanReason:
      'The arg key is not in the indicator catalog. The schema is strict — unknown keys make the node invalid even if the value would be sensible.',
    suggestedFix:
      'Inspect `capabilities.indicators[].argNames` for this indicator and rename or drop the unsupported arg.',
  },
  indicator_arg_required_missing: {
    humanReason:
      'A required arg for this indicator is missing. The strict schema rejects the node without it.',
    suggestedFix:
      'Add the missing arg using a typical default value from the indicator guide.',
  },
  indicator_unsupported_in_catalog: {
    humanReason:
      'The indicator id is not in the workspace capability catalog. The engine has no implementation to evaluate it.',
    suggestedFix:
      'Switch to a capability-listed indicator (see `capabilities.indicators`) or call resolve_strategy_semantics for a substitute.',
  },
};

interface SyntheticCodeMatch {
  code: keyof typeof CODE_PROFILES;
  ontologyHints?: string[];
}

/**
 * Map SDK preflight messages (which all share `code: 'strategy_draft_schema'`)
 * onto the more specific synthetic codes declared in `CODE_PROFILES`. Path is
 * the primary signal; message text disambiguates the few cases path alone
 * cannot. Returning `undefined` falls through to FALLBACK_PROFILE — that's
 * fine for issues outside the indicator-args family.
 */
function inferSyntheticCode(
  issue: ValidationIssueLike,
): SyntheticCodeMatch | undefined {
  const path = issue.path ?? '';
  const message = issue.message ?? '';

  // Path patterns are anchored with a regex per family so positional indices
  // (`signalGraph.nodes[3].args.period`) match without leaking through string
  // indexOf checks that would also match unrelated phrases in messages.
  const indicatorArgsPath = /^signalGraph\.nodes\[\d+\]\.args(?:\.|$)/;
  const indicatorOutputPath = /^signalGraph\.nodes\[\d+\]\.output$/;
  const indicatorIdPath = /^signalGraph\.nodes\[\d+\]\.indicator$/;

  if (indicatorArgsPath.test(path) && path.endsWith('.args.period')) {
    return { code: 'indicator_arg_period_alias' };
  }
  if (indicatorArgsPath.test(path) && path.endsWith('.args.output')) {
    return { code: 'indicator_arg_output_misplaced' };
  }
  if (
    indicatorOutputPath.test(path) &&
    /not supported for indicator/.test(message)
  ) {
    return { code: 'indicator_output_unsupported' };
  }
  if (
    indicatorOutputPath.test(path) &&
    /is required for indicator/.test(message)
  ) {
    return { code: 'indicator_output_required' };
  }
  if (issue.code === 'PROVENANCE_MISMATCH') {
    return { code: 'provenance_desync' };
  }
  if (
    indicatorArgsPath.test(path) &&
    /is required for indicator/.test(message)
  ) {
    return { code: 'indicator_arg_required_missing' };
  }
  if (
    indicatorArgsPath.test(path) &&
    /is not supported for indicator/.test(message)
  ) {
    return { code: 'indicator_arg_unknown' };
  }
  if (
    indicatorIdPath.test(path) &&
    /must be one of the capability catalog indicators/.test(message)
  ) {
    return { code: 'indicator_unsupported_in_catalog' };
  }

  return undefined;
}

const FALLBACK_PROFILE = {
  humanReason:
    'Validation rejected this part of the draft. The engine will not accept the strategy until it is addressed.',
  suggestedFix:
    'Read the original validation message and adjust the draft. If you cannot map the code, prefer narrowing the change to the smallest possible patch.',
};

function classifyIssue(
  group: ValidationGroup,
  issue: ValidationIssueLike,
): ExplainedIssue {
  // Try the issue's own code first; if it falls through to FALLBACK_PROFILE,
  // try to infer a synthetic code from path/message before settling for the
  // generic explanation. This means SDK preflight issues (all stamped
  // `strategy_draft_schema`) still pick up the targeted indicator-arg
  // remediation language we declare in CODE_PROFILES.
  const directProfile = issue.code ? CODE_PROFILES[issue.code] : undefined;
  const synthetic = directProfile ? undefined : inferSyntheticCode(issue);
  const profile =
    directProfile ??
    (synthetic ? CODE_PROFILES[synthetic.code] : undefined) ??
    FALLBACK_PROFILE;

  const profileHints =
    'ontologyHints' in profile && Array.isArray(profile.ontologyHints)
      ? [...profile.ontologyHints]
      : [];
  const hints = synthetic?.ontologyHints
    ? [...profileHints, ...synthetic.ontologyHints]
    : profileHints;

  // Reported code preference order:
  //   1. Issue code if it has a dedicated CODE_PROFILES entry (already
  //      specific — keep the producer's intent).
  //   2. Synthetic code when the issue is a generic schema error we recognise.
  //   3. Original issue code (may be `strategy_draft_schema` or undefined).
  const reportedCode = directProfile
    ? issue.code
    : (synthetic?.code ?? issue.code);

  return {
    group,
    severity: issue.severity ?? 'error',
    ...(reportedCode !== undefined ? { code: reportedCode } : {}),
    ...(issue.path !== undefined ? { path: issue.path } : {}),
    message: issue.message,
    humanReason: profile.humanReason,
    suggestedFix: issue.suggestion ?? profile.suggestedFix,
    ontologyHints: hints,
  };
}

function flattenIssues(validation: ValidationSummaryLike): ExplainedIssue[] {
  const groups: ValidationGroup[] = ['signalGraph', 'settings', 'conflicts'];
  const out: ExplainedIssue[] = [];
  for (const group of groups) {
    const list = validation.issues?.[group];
    if (!list) continue;
    for (const issue of list) {
      out.push(classifyIssue(group, issue));
    }
  }
  return out;
}

export function explainValidationIssues(input: {
  validation: ValidationSummaryLike;
  draft?: StrategyDraftLike;
}): ExplainValidationIssuesOutput {
  const issues = flattenIssues(input.validation);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const guidance: string[] = [];
  if (errorCount > 0) {
    guidance.push(
      'Fix every error before re-running run_guided_research_round; the runner will not persist or backtest with valid=false.',
    );
  }
  if (issues.some((i) => i.code === 'unsupported_timeframe')) {
    guidance.push(
      'Re-read get_capabilities and pick a timeframe explicitly listed in capabilities.enums.timeframes.',
    );
  }
  if (issues.some((i) => i.code === 'unsupported_indicator')) {
    guidance.push(
      'Replace unsupported indicators using resolve_strategy_semantics so the substitute is capability-grounded.',
    );
  }
  if (
    issues.some(
      (i) =>
        i.code === 'indicator_arg_period_alias' ||
        i.code === 'indicator_arg_output_misplaced',
    )
  ) {
    guidance.push(
      'Indicator nodes use `args.length` and a top-level `output`. preflight_strategy_draft auto-normalizes both, but raw drafts going straight to validate_strategy must hand-fix them.',
    );
  }
  if (
    issues.some(
      (i) =>
        i.code === 'indicator_arg_unknown' ||
        i.code === 'indicator_arg_required_missing' ||
        i.code === 'indicator_output_required' ||
        i.code === 'indicator_output_unsupported' ||
        i.code === 'indicator_unsupported_in_catalog',
    )
  ) {
    guidance.push(
      'Read `capabilities.indicators[].argNames` and `outputs` for the affected indicator before re-authoring; the schema is strict about both.',
    );
  }
  if (issues.some((i) => i.code === 'provenance_desync')) {
    guidance.push(
      'Treat provenance mismatches as representation drift. Keep the valid SignalGraph shape and regenerate/omit provenance before retrying.',
    );
  }
  return { errorCount, warningCount, issues, guidance };
}

function patchForIssue(
  issue: ExplainedIssue,
  draft: StrategyDraftLike | undefined,
): RepairPatch | undefined {
  if (issue.code === 'invalid_position_style') {
    return {
      op: 'replace',
      path: '/settings/positionStyle',
      value: 'single',
      rationale: "Reset positionStyle to 'single' with explicit entry sizing.",
    };
  }
  if (issue.code === 'missing_qty') {
    const style = asJsonObject(draft?.settings)?.positionStyle;
    if (style === 'accumulate') {
      return {
        op: 'add',
        path: '/settings/accumulation',
        value: {
          triggerMode: 'scheduled',
          schedule: { cadence: 'weekly' },
        },
        rationale:
          'Provide a weekly scheduled cadence so accumulate mode has a definite trigger.',
      };
    }
    // 10% equity is an opinionated default chosen so the strategy validates
    // *and* yields meaningful PnL on a typical workspace balance — fixed
    // qty=1 used to validate but produced negligible returns on USD-quoted
    // pairs. Refine after first backtest, do not lower this without thought.
    return {
      op: 'add',
      path: '/signalGraph/strategy/entry/action/sizing',
      value: { mode: 'percent_equity', value: 10 },
      rationale:
        'Default percent-equity sizing lets validation pass; the agent can refine risk later.',
    };
  }
  if (issue.code === 'invalid_warmup_period') {
    return {
      op: 'replace',
      path: '/settings/warmupPeriod',
      value: 200,
      rationale:
        'Raise warmupPeriod to 200 bars; safe baseline that covers most slow indicators.',
    };
  }
  if (issue.code === 'invalid_initial_balance') {
    return {
      op: 'replace',
      path: '/backtest/initialBalance',
      value: 10_000,
      rationale: 'Use 10000 as a sensible default initial balance.',
    };
  }
  if (issue.code === 'unsupported_timeframe') {
    return {
      op: 'replace',
      path: '/backtest/timeframe',
      value: '1h',
      rationale:
        'Fall back to 1h, the most broadly supported timeframe; replace once the agent confirms the desired timeframe is in capabilities.',
    };
  }
  // Issues without a deterministic patch (missing entry/exit rules,
  // structural rewrites, unknown codes) fall through to unaddressedIssues so
  // the agent can re-author them via resolve_strategy_semantics. We
  // intentionally do NOT emit a speculative `remove` patch: RFC 6902 forbids
  // removing a non-existent path, and a remove against a path the validator
  // flagged is rarely the right repair.
  return undefined;
}

export function suggestMinimalRepairs(input: {
  draft: StrategyDraftLike;
  validation: ValidationSummaryLike;
}): SuggestMinimalRepairsOutput {
  const explained = explainValidationIssues({
    validation: input.validation,
    draft: input.draft,
  });
  const patches: RepairPatch[] = [];
  const unaddressed: ExplainedIssue[] = [];
  for (const issue of explained.issues) {
    if (issue.severity === 'warning') continue;
    const patch = patchForIssue(issue, input.draft);
    if (patch) {
      patches.push(patch);
    } else {
      unaddressed.push(issue);
    }
  }
  const notes: string[] = [];
  if (unaddressed.length > 0) {
    notes.push(
      'Some errors require structural changes (entry/exit rules, indicator substitutions) and were left for the agent.',
    );
  }
  if (patches.length === 0 && unaddressed.length === 0) {
    notes.push('No errors found; nothing to patch.');
  }
  return { patches, unaddressedIssues: unaddressed, notes };
}
