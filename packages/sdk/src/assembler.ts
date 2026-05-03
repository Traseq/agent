import type {
  BacktestConfig,
  JsonObject,
  StrategyDraft,
  StrategySettings,
  Timeframe,
  TraseqValidationIssue,
} from './types.js';
import { preflightStrategyDraft } from './authoring-schema.js';

type EntrySide = 'long' | 'short';
type EntrySizingMode =
  | 'fixed'
  | 'fixed_cash'
  | 'percent_equity'
  | 'percent_balance';

interface RefObject extends JsonObject {
  ref: string;
}

interface EntryActionHint extends JsonObject {
  side?: EntrySide;
  sizing?: JsonObject & {
    mode?: EntrySizingMode;
    value?: number;
  };
}

interface ExitHint extends JsonObject {
  when?: RefObject;
  action?: JsonObject & {
    mode?: 'fixed' | 'percent_position';
    value?: number;
  };
  reason?: string;
  priority?: number;
}

interface SignalGraphAssemblyHints extends JsonObject {
  entryTrigger?: RefObject;
  contextFilters?: RefObject[];
  confirmationFilters?: RefObject[];
  signalExit?: RefObject | ExitHint;
  exit?: ExitHint;
  risk?: JsonObject;
  entryActionHint?: EntryActionHint;
  settingsHints?: JsonObject;
}

interface SignalGraphFragmentLike extends JsonObject {
  nodes?: JsonObject[];
  assemblyHints?: SignalGraphAssemblyHints;
  settingsHints?: JsonObject;
}

export interface AssembleSignalGraphDraftInput {
  name?: string;
  description?: string;
  fragments: SignalGraphFragmentLike[];
  settings?: Partial<StrategySettings> & JsonObject;
  backtest?: Partial<BacktestConfig> & JsonObject;
  instrument?: string;
  timeframe?: Timeframe;
  initialBalance?: number;
  side?: EntrySide;
  sizing?: {
    mode: EntrySizingMode;
    value: number;
  };
  capabilities?: unknown;
}

export interface AssembleSignalGraphDraftResult {
  valid: boolean;
  draft?: StrategyDraft;
  issues: TraseqValidationIssue[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): value is RefObject {
  return (
    isObject(value) && typeof value.ref === 'string' && value.ref.length > 0
  );
}

function issue(path: string, message: string): TraseqValidationIssue {
  const field = path.startsWith('fragments')
    ? 'fragments'
    : path.split('.')[0] || 'request';
  return {
    code: 'signal_graph_assembly',
    path,
    field,
    message,
    severity: 'error',
  };
}

// Plain-object deep-merge with last-wins semantics for arrays and primitives.
// We deliberately do not concat arrays here: callers (e.g. risk hint merging)
// build complete arrays per fragment, and a concat would silently duplicate
// entries when two fragments contribute the same rule.
function mergeObject(target: JsonObject, source: unknown): JsonObject {
  if (!isObject(source)) {
    return target;
  }

  for (const [key, value] of Object.entries(source)) {
    if (isObject(value) && isObject(target[key])) {
      target[key] = mergeObject({ ...(target[key] as JsonObject) }, value);
    } else {
      target[key] = value as JsonObject[string];
    }
  }
  return target;
}

function normalizeRefArray(value: unknown): RefObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRef);
}

function exitFromHint(value: unknown): ExitHint | undefined {
  if (isRef(value)) {
    return { when: value };
  }
  if (!isObject(value)) {
    return undefined;
  }
  const when = isRef(value.when) ? value.when : undefined;
  if (!when) {
    return undefined;
  }
  return value as ExitHint;
}

function longestLookback(nodes: JsonObject[]): number {
  let max = 0;
  for (const node of nodes) {
    const kind = typeof node.kind === 'string' ? node.kind : '';
    const args = isObject(node.args) ? node.args : {};
    for (const [name, value] of Object.entries(args)) {
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        /(?:length|period|window|slow|fast|signal)/iu.test(name)
      ) {
        max = Math.max(max, Math.trunc(value));
      }
    }
    for (const key of ['period', 'left', 'right', 'window']) {
      const value = node[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        max = Math.max(max, Math.trunc(value));
      }
    }
    if (kind === 'indicator' && max === 0) {
      max = Math.max(max, 1);
    }
  }
  return max;
}

export function assembleSignalGraphDraft(
  input: AssembleSignalGraphDraftInput,
): AssembleSignalGraphDraftResult {
  const issues: TraseqValidationIssue[] = [];
  const nodes: JsonObject[] = [];
  const nodeIds = new Set<string>();
  let entryTrigger: RefObject | undefined;
  const filters: RefObject[] = [];
  let exit: ExitHint | undefined;
  let risk: JsonObject = {};
  let entryAction: EntryActionHint = {
    side: input.side ?? 'long',
    sizing: input.sizing ?? { mode: 'percent_equity', value: 10 },
  };
  let settingsHints: JsonObject = {};

  input.fragments.forEach((fragment, fragmentIndex) => {
    if (!isObject(fragment)) {
      issues.push(
        issue(`fragments[${fragmentIndex}]`, 'Fragment must be an object.'),
      );
      return;
    }

    if (Object.prototype.hasOwnProperty.call(fragment, 'bindings')) {
      issues.push(
        issue(
          `fragments[${fragmentIndex}].bindings`,
          'Use assemblyHints instead of legacy fragment bindings.',
        ),
      );
    }

    for (const node of Array.isArray(fragment.nodes) ? fragment.nodes : []) {
      if (
        !isObject(node) ||
        typeof node.id !== 'string' ||
        node.id.length === 0
      ) {
        issues.push(
          issue(
            `fragments[${fragmentIndex}].nodes`,
            'Every fragment node must be an object with a non-empty id.',
          ),
        );
        continue;
      }
      if (nodeIds.has(node.id)) {
        issues.push(
          issue(
            `fragments[${fragmentIndex}].nodes.${node.id}`,
            `Duplicate signalGraph node id "${node.id}".`,
          ),
        );
        continue;
      }
      nodeIds.add(node.id);
      nodes.push(node);
    }

    const fragmentSettingsHints = isObject(fragment.settingsHints)
      ? fragment.settingsHints
      : {};
    const hints = isObject(fragment.assemblyHints)
      ? fragment.assemblyHints
      : undefined;
    if (!hints) {
      settingsHints = mergeObject(settingsHints, fragmentSettingsHints);
      return;
    }

    if (isRef(hints.entryTrigger)) {
      entryTrigger ??= hints.entryTrigger;
    }
    filters.push(...normalizeRefArray(hints.contextFilters));
    filters.push(...normalizeRefArray(hints.confirmationFilters));

    exit ??= exitFromHint(hints.signalExit) ?? exitFromHint(hints.exit);
    risk = mergeObject(risk, hints.risk);
    entryAction = mergeObject(
      entryAction,
      hints.entryActionHint,
    ) as EntryActionHint;
    settingsHints = mergeObject(
      settingsHints,
      mergeObject({ ...fragmentSettingsHints }, hints.settingsHints),
    );
  });

  if (!entryTrigger) {
    issues.push(
      issue(
        'fragments',
        'At least one fragment must provide assemblyHints.entryTrigger.',
      ),
    );
  }
  if (nodes.length === 0) {
    issues.push(
      issue('fragments', 'At least one signalGraph node is required.'),
    );
  }

  // Priority: input.settings > fragment settingsHints > inferred default.
  // mergeObject already enforces this priority via overlay order, so we only
  // need a sensible default for the case where no override is provided.
  const inferredWarmupPeriod = Math.max(200, longestLookback(nodes) * 2);
  const settings = mergeObject(
    mergeObject(
      {
        positionStyle: 'single',
        warmupPeriod: inferredWarmupPeriod,
      },
      settingsHints,
    ),
    input.settings,
  ) as unknown as StrategySettings;
  const signalInstrument = isObject(input.backtest?.signalInstrument)
    ? input.backtest.signalInstrument
    : { symbol: input.instrument ?? 'BTCUSDT' };
  const backtest = mergeObject(
    {
      timeframe: input.timeframe ?? '4h',
      signalInstrument,
      initialBalance: input.initialBalance ?? 10_000,
    },
    input.backtest,
  ) as unknown as BacktestConfig;

  if (issues.length > 0 || !entryTrigger) {
    return { valid: false, issues };
  }

  const strategy: JsonObject = {
    kind: 'strategy',
    entry: {
      kind: 'entry',
      trigger: entryTrigger,
      ...(filters.length > 0 ? { filters } : {}),
      action: {
        side: entryAction.side ?? 'long',
        sizing: entryAction.sizing ?? { mode: 'percent_equity', value: 10 },
      },
    },
    ...(exit
      ? {
          exits: [
            {
              kind: 'exit',
              when: exit.when,
              action: exit.action ?? { mode: 'percent_position', value: 100 },
              ...(exit.reason ? { reason: exit.reason } : {}),
              ...(typeof exit.priority === 'number'
                ? { priority: exit.priority }
                : {}),
            },
          ],
        }
      : {}),
    ...(Object.keys(risk).length > 0 ? { risk } : {}),
  };

  const draft: StrategyDraft = {
    name: input.name?.trim() || 'Assembled strategy',
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes,
      strategy,
    },
    settings,
    backtest,
  };

  const preflight = preflightStrategyDraft(draft, input.capabilities);
  return {
    valid: preflight.valid,
    draft: preflight.draft ?? draft,
    issues: preflight.issues,
  };
}
