import { asJsonObject, isJsonObject } from '../normalize.js';
import type { JsonObject, StrategyDraftLike } from '../types.js';

/**
 * A patch applied during draft normalization. Mirrors the JSON-Patch shape
 * used elsewhere in the agent (`semantics/repair.ts`) so callers can render
 * normalize/repair output uniformly.
 */
export interface DraftNormalizePatch {
  op: 'rename' | 'lift' | 'remove' | 'dedupe';
  path: string;
  rationale: string;
}

export interface NormalizeStrategyDraftResult {
  draft: StrategyDraftLike;
  patches: DraftNormalizePatch[];
  /**
   * True when the input draft already conforms — useful for callers that want
   * to skip emitting "we normalized" messaging when nothing changed.
   */
  changed: boolean;
}

interface IndicatorCapabilityShape {
  argNames: Set<string>;
  /** Allowed `output` enum values when the indicator is multi-output. */
  outputs?: Set<string>;
  /** True when the capability schema accepts an `output` selector at all. */
  hasOutput: boolean;
}

interface IndicatorCatalog {
  byId: Map<string, IndicatorCapabilityShape>;
  /** True when the capabilities document carried an indicator catalog. */
  hasCatalog: boolean;
}

const INDICATOR_KIND = 'indicator';

/**
 * Normalize a draft so deterministic, mechanical errors (vocabulary drift
 * between `period`/`length`, args.output that should live at top-level, etc.)
 * are fixed before the SDK preflight runs. Decisions stay narrow:
 *
 *   - rename `args.period` -> `args.length` on indicator nodes only when the
 *     indicator catalog accepts `length` AND does not accept `period`. We
 *     never silently coerce a value that the catalog actually allows.
 *   - lift `args.output` to top-level `output` when the catalog declares an
 *     `output` selector. If the indicator has no output, we drop the bogus
 *     selector instead so the LLM sees one issue (`unknown_indicator_output`)
 *     instead of two (`unknown_indicator_arg` + `unknown_output`).
 *   - drop top-level `output` from non-multi-output indicators (this is the
 *     only place we *delete* user-supplied data; it is always recoverable from
 *     git/round-trip and the alternative is a hard validation failure).
 *   - dedupe `length`/`period` when both are present, keeping `length`.
 *
 * The function is deliberately conservative: when the capabilities document
 * has no indicator catalog (e.g. tests that pass `undefined`), it only fixes
 * the unambiguous cases (`args.period` -> `args.length`, `args.output` lift)
 * and leaves catalog-dependent decisions alone.
 */
export function normalizeStrategyDraft(
  draft: StrategyDraftLike,
  capabilities?: unknown,
): NormalizeStrategyDraftResult {
  const catalog = buildIndicatorCatalog(capabilities);
  const patches: DraftNormalizePatch[] = [];

  // Deep clone so callers can keep their original draft for diff/audit. The
  // signal graph is the only sub-tree we touch, but cloning the whole draft
  // is simpler and the cost is negligible at LLM-throughput scale.
  const next = deepCloneDraft(draft);
  const signalGraph = asJsonObject(next.signalGraph);
  if (!signalGraph) {
    return { draft: next, patches, changed: false };
  }

  const nodes = signalGraph.nodes;
  if (!Array.isArray(nodes)) {
    return { draft: next, patches, changed: false };
  }

  nodes.forEach((rawNode, index) => {
    if (!isJsonObject(rawNode)) return;
    if (rawNode.kind !== INDICATOR_KIND) return;

    const indicatorId =
      typeof rawNode.indicator === 'string' ? rawNode.indicator : undefined;
    const shape =
      indicatorId !== undefined ? catalog.byId.get(indicatorId) : undefined;
    const nodePath = `signalGraph.nodes[${index}]`;

    normalizeIndicatorNode(rawNode, shape, catalog, nodePath, patches);
  });

  return { draft: next, patches, changed: patches.length > 0 };
}

function normalizeIndicatorNode(
  node: JsonObject,
  shape: IndicatorCapabilityShape | undefined,
  catalog: IndicatorCatalog,
  nodePath: string,
  patches: DraftNormalizePatch[],
): void {
  const args = isJsonObject(node.args) ? node.args : undefined;

  if (args) {
    renameArgPeriodToLength(args, shape, `${nodePath}.args`, patches);
    dedupeLengthAndPeriod(args, shape, `${nodePath}.args`, patches);
    liftArgsOutput(node, args, shape, nodePath, patches);
  }

  dropUnsupportedTopLevelOutput(node, shape, catalog, nodePath, patches);
}

function renameArgPeriodToLength(
  args: JsonObject,
  shape: IndicatorCapabilityShape | undefined,
  argsPath: string,
  patches: DraftNormalizePatch[],
): void {
  if (!('period' in args)) return;

  // When we have a catalog, only rename if `length` is the accepted name and
  // `period` is NOT. This avoids "fixing" a hypothetical future indicator
  // that legitimately exposes both. When we don't have a catalog, the rename
  // is unambiguous because no indicator schema currently uses `period` for
  // the lookback (rolling nodes do, but rolling nodes aren't `kind:
  // 'indicator'`).
  if (shape) {
    const acceptsPeriod = shape.argNames.has('period');
    const acceptsLength = shape.argNames.has('length');
    if (acceptsPeriod || !acceptsLength) return;
  }

  const value = args.period;
  // If `length` already exists, dedupe will handle it — we still drop period
  // so the strict capabilities schema doesn't reject the unknown key.
  if (!('length' in args)) {
    args.length = value;
  }
  delete args.period;
  patches.push({
    op: 'rename',
    path: `${argsPath}.period`,
    rationale:
      'Indicator args use `length`, not `period`. Renamed so capability ' +
      'validation accepts the node.',
  });
}

function dedupeLengthAndPeriod(
  args: JsonObject,
  shape: IndicatorCapabilityShape | undefined,
  argsPath: string,
  patches: DraftNormalizePatch[],
): void {
  if (!('length' in args) || !('period' in args)) return;
  // If a future indicator catalog ever accepts both, leave the user's input
  // intact; the validator can decide.
  if (shape && shape.argNames.has('period') && shape.argNames.has('length')) {
    return;
  }
  delete args.period;
  patches.push({
    op: 'dedupe',
    path: `${argsPath}.period`,
    rationale:
      'Both `length` and `period` were set on indicator args. Dropped ' +
      '`period` because the indicator schema only accepts `length`.',
  });
}

function liftArgsOutput(
  node: JsonObject,
  args: JsonObject,
  shape: IndicatorCapabilityShape | undefined,
  nodePath: string,
  patches: DraftNormalizePatch[],
): void {
  if (!('output' in args)) return;

  // No catalog: lift to the conventional location; engine will reject if the
  // indicator does not accept output. Better to surface one error than two.
  if (!shape) {
    if (!('output' in node)) {
      node.output = args.output;
    }
    delete args.output;
    patches.push({
      op: 'lift',
      path: `${nodePath}.args.output`,
      rationale:
        'Indicator nodes carry `output` at the top level, not inside ' +
        '`args`. Lifted the selector.',
    });
    return;
  }

  // Catalog present: only lift if the indicator actually has an output
  // selector. Otherwise drop, because keeping it under either location will
  // fail validation.
  if (!shape.hasOutput) {
    delete args.output;
    patches.push({
      op: 'remove',
      path: `${nodePath}.args.output`,
      rationale:
        'Indicator does not declare an output selector; dropped the ' +
        '`output` value supplied inside args.',
    });
    return;
  }

  if (!('output' in node)) {
    node.output = args.output;
  }
  delete args.output;
  patches.push({
    op: 'lift',
    path: `${nodePath}.args.output`,
    rationale:
      'Indicator nodes carry `output` at the top level, not inside ' +
      '`args`. Lifted the selector.',
  });
}

function dropUnsupportedTopLevelOutput(
  node: JsonObject,
  shape: IndicatorCapabilityShape | undefined,
  catalog: IndicatorCatalog,
  nodePath: string,
  patches: DraftNormalizePatch[],
): void {
  if (!('output' in node)) return;
  // We need both a catalog and a known indicator before we feel comfortable
  // deleting top-level output (since this is the only delete that touches
  // user-visible state at the node root, not inside args).
  if (!catalog.hasCatalog || !shape) return;
  if (shape.hasOutput) return;

  delete node.output;
  patches.push({
    op: 'remove',
    path: `${nodePath}.output`,
    rationale:
      'Indicator does not declare an output selector. Dropped the ' +
      '`output` field so the node passes capability validation.',
  });
}

function buildIndicatorCatalog(capabilities: unknown): IndicatorCatalog {
  const catalogObject = asJsonObject(capabilities);
  const indicators = Array.isArray(catalogObject?.indicators)
    ? (catalogObject.indicators as unknown[])
    : undefined;

  if (!indicators || indicators.length === 0) {
    return { byId: new Map(), hasCatalog: false };
  }

  const byId = new Map<string, IndicatorCapabilityShape>();
  for (const raw of indicators) {
    if (!isJsonObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : undefined;
    if (!id) continue;

    const argNames = new Set<string>();
    if (Array.isArray(raw.argNames)) {
      for (const name of raw.argNames) {
        if (typeof name === 'string') argNames.add(name);
      }
    }
    if (argNames.size === 0 && Array.isArray(raw.args)) {
      for (const arg of raw.args) {
        if (isJsonObject(arg) && typeof arg.name === 'string') {
          argNames.add(arg.name);
        }
      }
    }

    const outputDescriptor = asJsonObject(raw.output);
    const outputs =
      Array.isArray(raw.outputs) &&
      raw.outputs.every((value) => typeof value === 'string')
        ? new Set(raw.outputs as string[])
        : outputDescriptor?.type === 'enum' &&
            Array.isArray(outputDescriptor.enumValues)
          ? new Set(
              (outputDescriptor.enumValues as unknown[]).filter(
                (value): value is string => typeof value === 'string',
              ),
            )
          : undefined;

    byId.set(id, {
      argNames,
      ...(outputs ? { outputs } : {}),
      hasOutput: outputDescriptor !== undefined || outputs !== undefined,
    });
  }

  return { byId, hasCatalog: true };
}

function deepCloneDraft(draft: StrategyDraftLike): StrategyDraftLike {
  return JSON.parse(JSON.stringify(draft)) as StrategyDraftLike;
}
