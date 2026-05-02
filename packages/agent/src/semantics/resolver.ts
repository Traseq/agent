import { asJsonObject, asNumber, asString } from '../normalize.js';
import {
  SEMANTIC_FACETS,
  SEMANTIC_IMPLEMENTATIONS,
  findFacet,
  getSemanticOntology,
} from './ontology.js';
import {
  buildSemanticCapabilityGraph,
  missingRequiredCapabilities,
} from './capability-graph.js';
import type {
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
  ResolvedSemanticFacet,
  SemanticCandidateStatus,
  SemanticFacetInput,
  SemanticImplementationCandidate,
  SemanticResolutionResult,
} from './types.js';

interface WeightedFacet {
  id: string;
  role?: string;
  weight: number;
  rationale: string;
}

function normalizeWeight(value: unknown): number {
  const number = asNumber(value);
  if (number === undefined || !Number.isFinite(number)) {
    return 1;
  }

  return Math.min(Math.max(number, 0.1), 5);
}

function normalizePrompt(value: unknown): string {
  return asString(value).toLowerCase();
}

function facetFromInput(input: SemanticFacetInput): WeightedFacet | undefined {
  const id = asString(input.id);
  if (!id || !findFacet(id)) {
    return undefined;
  }

  const result: WeightedFacet = {
    id,
    weight: normalizeWeight(input.weight),
    rationale: 'Explicitly supplied by the calling agent.',
  };
  const role = asString(input.role);
  if (role) {
    result.role = role;
  }
  return result;
}

const SHORT_ASCII_RE = /^[a-z0-9 ]{1,3}$/;

const WORD_BOUNDARY = /[^a-z0-9]/;

function keywordMatchesPrompt(prompt: string, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  if (SHORT_ASCII_RE.test(lower)) {
    let start = 0;
    while ((start = prompt.indexOf(lower, start)) !== -1) {
      const before = start === 0 || WORD_BOUNDARY.test(prompt[start - 1]!);
      const end = start + lower.length;
      const after = end === prompt.length || WORD_BOUNDARY.test(prompt[end]!);
      if (before && after) return true;
      start += 1;
    }
    return false;
  }
  return prompt.includes(lower);
}

function extractFacetsFromPrompt(prompt: string): WeightedFacet[] {
  if (!prompt) {
    return [];
  }

  const matches: WeightedFacet[] = [];
  for (const facet of SEMANTIC_FACETS) {
    const hit = facet.keywords.find((keyword) =>
      keywordMatchesPrompt(prompt, keyword),
    );
    if (hit) {
      matches.push({
        id: facet.id,
        weight: 1,
        rationale: `Matched prompt keyword "${hit}".`,
      });
    }
  }

  return matches;
}

function extractFacetsFromConstraints(
  input: ResolveStrategySemanticsInput,
): WeightedFacet[] {
  const constraints = asJsonObject(input.constraints) ?? {};
  const thesis = normalizePrompt(constraints.thesis);
  if (!thesis) {
    return [];
  }

  return extractFacetsFromPrompt(thesis).map((facet) => ({
    ...facet,
    weight: Math.max(facet.weight, 0.8),
    rationale: `Matched thesis constraint for ${facet.id}.`,
  }));
}

function mergeFacets(facets: WeightedFacet[]): WeightedFacet[] {
  const byId = new Map<string, WeightedFacet>();
  for (const facet of facets) {
    const previous = byId.get(facet.id);
    if (!previous || facet.weight > previous.weight) {
      byId.set(facet.id, facet);
    }
  }

  return [...byId.values()];
}

function resolveFacetInputs(input: ResolveStrategySemanticsInput): {
  facets: WeightedFacet[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const explicit =
    Array.isArray(input.facets) && input.facets.length > 0
      ? input.facets
          .map((facet) => facetFromInput(facet))
          .filter((facet): facet is WeightedFacet => facet !== undefined)
      : [];

  if (Array.isArray(input.facets)) {
    const invalid = input.facets.filter(
      (facet) => !findFacet(asString(facet.id)),
    );
    for (const facet of invalid) {
      warnings.push(`Unknown semantic facet ignored: ${asString(facet.id)}`);
    }
  }

  const fromPrompt = extractFacetsFromPrompt(normalizePrompt(input.prompt));
  const fromConstraints = extractFacetsFromConstraints(input);
  const merged = mergeFacets([...explicit, ...fromPrompt, ...fromConstraints]);

  if (merged.length === 0) {
    warnings.push(
      'No semantic facets were resolved. Provide facets explicitly for deterministic behavior.',
    );
  }

  return { facets: merged, warnings };
}

function complexityPenalty(
  complexity: string,
  preferred: string | undefined,
): number {
  if (!preferred || preferred === 'balanced') {
    return complexity === 'advanced' ? 4 : 0;
  }
  if (preferred === 'simple') {
    if (complexity === 'simple') return 0;
    if (complexity === 'balanced') return 8;
    return 18;
  }
  if (preferred === 'advanced') {
    return complexity === 'simple' ? 2 : 0;
  }
  return 0;
}

function operatorStatus(
  missing: string[],
  risky: boolean | undefined,
): SemanticCandidateStatus {
  if (missing.length > 0) {
    return 'unavailable';
  }
  if (risky === true) {
    return 'risky';
  }
  return 'expressible';
}

function cloneFragment<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function resolveStrategySemantics(
  rawInput: ResolveStrategySemanticsInput = {},
): SemanticResolutionResult {
  const input = (asJsonObject(rawInput) ?? {}) as ResolveStrategySemanticsInput;
  const warnings: string[] = [];
  const { facets, warnings: facetWarnings } = resolveFacetInputs(input);
  warnings.push(...facetWarnings);

  const capabilityGraph = buildSemanticCapabilityGraph(input.capabilities);
  if (!capabilityGraph.sourceHadCapabilities) {
    warnings.push(
      'No live capabilities were supplied. Candidate availability is based on an empty capability graph.',
    );
  }

  const constraints = asJsonObject(input.constraints) ?? {};
  const preferredComplexity = asString(constraints.complexity, 'balanced');
  const maxCandidates = Math.min(
    Math.max(Math.round(asNumber(constraints.maxCandidates) ?? 6), 1),
    12,
  );
  const includeUnavailable = input.includeUnavailable === true;
  const facetWeight = new Map(facets.map((facet) => [facet.id, facet.weight]));
  const resolvedFacets: ResolvedSemanticFacet[] = facets
    .map((item) => {
      const definition = findFacet(item.id);
      if (!definition) {
        return undefined;
      }
      return {
        id: definition.id,
        family: definition.family,
        role: definition.role,
        rationale: item.rationale,
      };
    })
    .filter((item): item is ResolvedSemanticFacet => item !== undefined);

  const selectedIds = new Set(facets.map((facet) => facet.id));
  const selectedImplementations = SEMANTIC_IMPLEMENTATIONS.filter((candidate) =>
    candidate.semanticIds.some((semanticId) => selectedIds.has(semanticId)),
  );

  const candidates: SemanticImplementationCandidate[] = selectedImplementations
    .map((candidate) => {
      const missing = missingRequiredCapabilities(
        capabilityGraph,
        candidate.requiredCapabilities,
      );
      const status = operatorStatus(missing, candidate.risky);
      const semanticScore = candidate.semanticIds.reduce(
        (sum, semanticId) => sum + (facetWeight.get(semanticId) ?? 0),
        0,
      );
      const score =
        candidate.curatedPriority +
        semanticScore * 20 -
        missing.length * 50 -
        complexityPenalty(candidate.complexity, preferredComplexity);
      const validationHints = [...candidate.validationHints];
      if (missing.length > 0) {
        validationHints.push(
          `Unavailable until capabilities support: ${missing.join(', ')}.`,
        );
      }

      return {
        id: candidate.id,
        status,
        role: candidate.role,
        semanticIds: [...candidate.semanticIds],
        score,
        fragment: cloneFragment(candidate.fragment),
        ...(candidate.tokenRecipe
          ? { tokenRecipe: cloneFragment(candidate.tokenRecipe) }
          : {}),
        tradeoffs: cloneFragment(candidate.tradeoffs),
        requiredCapabilities: cloneFragment(candidate.requiredCapabilities),
        validationHints,
      };
    })
    .filter(
      (candidate) => includeUnavailable || candidate.status !== 'unavailable',
    )
    .sort((a, b) => b.score - a.score);

  const recommendedCandidateIds: string[] = [];
  const seenRoles = new Set<string>();
  const recommendedSet = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.status === 'unavailable' || seenRoles.has(candidate.role)) {
      continue;
    }
    recommendedCandidateIds.push(candidate.id);
    seenRoles.add(candidate.role);
    if (candidate.status === 'expressible') {
      recommendedSet.add(candidate.id);
    }
    if (recommendedCandidateIds.length >= 3) {
      break;
    }
  }

  const limitedCandidates = candidates
    .slice(0, maxCandidates)
    .map((candidate) =>
      recommendedSet.has(candidate.id)
        ? { ...candidate, status: 'recommended' as const }
        : candidate,
    );
  return {
    resolvedFacets,
    candidates: limitedCandidates,
    assemblyPlan: {
      recommendedCandidateIds: recommendedCandidateIds.filter((id) =>
        limitedCandidates.some((candidate) => candidate.id === id),
      ),
      notes: [
        'Resolver returns signalGraph fragments with assemblyHints only; call assemble_signal_graph before validation or writes.',
        'Treat risky candidates as possible but not default recommendations.',
        'If trade count is too low, remove one confirmation or relax strict thresholds before adding more filters.',
      ],
    },
    warnings,
  };
}

export function getSemantics(rawInput: GetSemanticsInput = {}) {
  const input = asJsonObject(rawInput) ?? {};
  const family = asString(input.family);
  return getSemanticOntology({
    ...(family ? { family } : {}),
    includeFragments: input.includeFragments === true,
  });
}
