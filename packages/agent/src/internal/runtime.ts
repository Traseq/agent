import { TraseqClient } from '@traseq/sdk';

import { readEnv, requireEnv } from '../env.js';
import { asJsonObject } from '../normalize.js';
import type { JsonObject } from '../types.js';

const DEFAULT_BASE_URL = 'https://api.traseq.com';

export function createTraseqClient(): TraseqClient {
  return new TraseqClient({
    apiKey: requireEnv('TRASEQ_API_KEY'),
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? DEFAULT_BASE_URL,
  });
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

export function capabilitySummary(capabilities: unknown): JsonObject {
  const source = asJsonObject(capabilities) ?? {};
  const signalGraph = asJsonObject(source.signalGraph) ?? {};
  const operators = asJsonObject(source.operators) ?? {};

  return {
    protocol: source.protocol,
    version: source.version,
    subscriptionTier: source.subscriptionTier,
    limits: asJsonObject(source.limits),
    nodeKinds: countArray(signalGraph.nodes),
    bindings: countArray(signalGraph.bindings),
    indicators: countArray(source.indicators),
    compareOperators: countArray(operators.compare),
    crossOperators: countArray(operators.cross),
  };
}
