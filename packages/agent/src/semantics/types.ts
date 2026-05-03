import type { CapabilityDocument } from '../client/index.js';

export type SemanticRole =
  | 'entry_trigger'
  | 'confirmation_filter'
  | 'exit'
  | 'risk'
  | 'context_filter';

export type TokenRecipeOutput = 'bool' | 'risk' | 'entry_action';

export type SemanticCandidateStatus =
  | 'recommended'
  | 'expressible'
  | 'risky'
  | 'unavailable';

export type SemanticComplexity = 'simple' | 'balanced' | 'advanced';

export interface SemanticFacetInput {
  id: string;
  role?: SemanticRole | string;
  weight?: number;
}

export interface SemanticResolveConstraints {
  thesis?: string;
  timeframe?: '15m' | '1h' | '4h' | '1d';
  side?: 'long' | 'short';
  complexity?: SemanticComplexity;
  maxCandidates?: number;
}

export interface ResolveStrategySemanticsInput {
  facets?: SemanticFacetInput[];
  prompt?: string;
  constraints?: SemanticResolveConstraints;
  capabilities?: CapabilityDocument;
  includeUnavailable?: boolean;
}

export interface GetSemanticsInput {
  family?: string;
  includeFragments?: boolean;
}

export interface SemanticRequiredCapabilities {
  nodeKinds: string[];
  indicators?: string[];
  operators?: string[];
}

export interface SignalGraphFragment {
  nodes: Record<string, unknown>[];
  assemblyHints: Record<string, unknown>;
  settingsHints?: Record<string, unknown>;
}

export interface TokenRecipeParameter {
  name: string;
  type: 'number' | 'string' | 'enum';
  default?: string | number;
  enumValues?: string[];
  description: string;
}

export interface TokenRecipeDefinition {
  recipeId: string;
  implementationId: string;
  role: SemanticRole;
  produces: TokenRecipeOutput;
  validAs: string[];
  /** Human-readable short label, used as the default block name. */
  displayName: string;
  semanticSummary: string;
  params: TokenRecipeParameter[];
  tokens: Record<string, unknown>[];
}

export interface SemanticTradeoffs {
  strengths: string[];
  risks: string[];
  assumptions: string[];
}

export interface SemanticImplementationCandidate {
  id: string;
  status: SemanticCandidateStatus;
  role: SemanticRole;
  semanticIds: string[];
  score: number;
  fragment: SignalGraphFragment;
  tokenRecipe?: TokenRecipeDefinition;
  tradeoffs: SemanticTradeoffs;
  requiredCapabilities: SemanticRequiredCapabilities;
  validationHints: string[];
}

export interface ResolvedSemanticFacet {
  id: string;
  family: string;
  role: SemanticRole;
  rationale: string;
}

export interface SemanticResolutionResult {
  resolvedFacets: ResolvedSemanticFacet[];
  candidates: SemanticImplementationCandidate[];
  assemblyPlan: {
    recommendedCandidateIds: string[];
    notes: string[];
  };
  warnings: string[];
}

export interface SemanticFacetDefinition {
  id: string;
  family: string;
  role: SemanticRole;
  description: string;
  keywords: string[];
  rationale: string;
  antiPatterns: string[];
  implementationIds: string[];
}

export interface SemanticImplementationDefinition {
  id: string;
  semanticIds: string[];
  role: SemanticRole;
  description: string;
  complexity: SemanticComplexity;
  curatedPriority: number;
  risky?: boolean;
  fragment: SignalGraphFragment;
  tokenRecipe?: TokenRecipeDefinition;
  tradeoffs: SemanticTradeoffs;
  requiredCapabilities: SemanticRequiredCapabilities;
  validationHints: string[];
}

export interface SemanticOntologyDocument {
  protocol: 'traseq.agent.semantics';
  version: 1;
  families: string[];
  facets: SemanticFacetDefinition[];
  implementations?: SemanticImplementationDefinition[];
}
