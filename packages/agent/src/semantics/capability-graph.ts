import { asJsonObject, asString } from '../normalize.js';
import type { JsonObject } from '../types.js';
import type { SemanticRequiredCapabilities } from './types.js';

export interface SemanticCapabilityGraph {
  nodeKinds: Set<string>;
  indicators: Set<string>;
  operators: Set<string>;
  bindings: Set<string>;
  limits: JsonObject;
  sourceHadCapabilities: boolean;
}

function addStringArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item === 'string') {
      target.add(item);
    }
  }
}

export function buildSemanticCapabilityGraph(
  capabilities: unknown,
): SemanticCapabilityGraph {
  const source = asJsonObject(capabilities) ?? {};
  const signalGraph = asJsonObject(source.signalGraph) ?? {};
  const operators = asJsonObject(source.operators) ?? {};
  const nodeKinds = new Set<string>();
  const indicators = new Set<string>();
  const operatorSet = new Set<string>();
  const bindings = new Set<string>();

  addStringArray(nodeKinds, signalGraph.nodeKinds);
  if (Array.isArray(signalGraph.nodes)) {
    for (const nodeSpec of signalGraph.nodes) {
      const node = asJsonObject(nodeSpec);
      const kind = asString(node?.kind);
      if (kind) {
        nodeKinds.add(kind);
      }
    }
  }

  if (Array.isArray(source.indicators)) {
    for (const indicatorSpec of source.indicators) {
      const indicator = asJsonObject(indicatorSpec);
      const id = asString(indicator?.id);
      if (id) {
        indicators.add(id);
      }
    }
  }

  for (const value of Object.values(operators)) {
    addStringArray(operatorSet, value);
  }

  if (Array.isArray(signalGraph.bindings)) {
    for (const bindingSpec of signalGraph.bindings) {
      const binding = asJsonObject(bindingSpec);
      const path = asString(binding?.path);
      if (path) {
        bindings.add(path);
      }
    }
  }

  return {
    nodeKinds,
    indicators,
    operators: operatorSet,
    bindings,
    limits: asJsonObject(source.limits) ?? {},
    sourceHadCapabilities:
      source.protocol === 'traseq.capabilities' ||
      nodeKinds.size > 0 ||
      indicators.size > 0,
  };
}

export function missingRequiredCapabilities(
  graph: SemanticCapabilityGraph,
  required: SemanticRequiredCapabilities,
): string[] {
  const missing: string[] = [];

  for (const kind of required.nodeKinds) {
    if (!graph.nodeKinds.has(kind)) {
      missing.push(`node:${kind}`);
    }
  }

  for (const indicator of required.indicators ?? []) {
    if (!graph.indicators.has(indicator)) {
      missing.push(`indicator:${indicator}`);
    }
  }

  for (const operator of required.operators ?? []) {
    if (!graph.operators.has(operator)) {
      missing.push(`operator:${operator}`);
    }
  }

  return missing;
}
