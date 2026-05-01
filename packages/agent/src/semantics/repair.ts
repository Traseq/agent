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
};

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
  const profile = (issue.code && CODE_PROFILES[issue.code]) || FALLBACK_PROFILE;
  const hints: string[] =
    'ontologyHints' in profile && Array.isArray(profile.ontologyHints)
      ? [...profile.ontologyHints]
      : [];
  return {
    group,
    severity: issue.severity ?? 'error',
    ...(issue.code !== undefined ? { code: issue.code } : {}),
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
