// Knowledge layer
export { getAgentContext } from './assembler.js';
export { SKILL_CONTENT } from './skill/index.js';
export { references } from './references/index.js';
export { templates } from './templates/index.js';
export { tools } from './tools/index.js';
export {
  AGENT_TOOL_REGISTRY,
  SEMANTIC_FACETS,
  SEMANTIC_IMPLEMENTATIONS,
  buildSemanticCapabilityGraph,
  getAgentToolDefinition,
  getSemanticOntology,
  getSemantics,
  missingRequiredCapabilities,
  resolveStrategySemantics,
  runAgentTool,
} from './semantics/index.js';
export {
  OPERATION_REGISTRY,
  getOperationDefinition,
} from './generated/operation-registry.js';
export {
  TraseqClient,
  TraseqApiError,
  TraseqPublicApiError,
  explainTraseqError,
  formatTraseqAgentError,
  runPlatformTool,
} from './client/index.js';
export { startMcpServer } from './mcp/index.js';

// Operational layer
export { buildScoreBreakdown } from './scoring.js';
export { analyzeRound } from './analysis.js';
export {
  EVALUATION_SCHEMA_VERSION,
  buildResearchVerdict,
  evaluateResearchResult,
  evaluateResearchRound,
} from './evaluation.js';
export { buildResearchArtifactBundle, formatResearchReport } from './report.js';
export { runResearch, normalizeRequest } from './research.js';
export {
  RUNNER_SCHEMA_VERSION,
  buildBacktestConfig,
  buildDefaultStrategySettings,
  runResearchRunner,
  selectChampionRound,
} from './research-runner.js';
export { fetchWithRetry, type RetryOptions } from './http.js';
export {
  readEnv,
  readNumberEnv,
  requireEnv,
  TRASEQ_API_KEY_SETUP_HELP,
  TRASEQ_API_KEY_SETUP_URL,
} from './env.js';
export {
  normalizeDraft,
  normalizeBacktest,
  normalizeValidation,
  normalizeChange,
  isJsonObject,
  asJsonObject,
  asString,
  asNumber,
  asStringArray,
  parseJsonObject,
} from './normalize.js';

// Types
export type {
  AgentContextOptions,
  SectionName,
  StrategyTemplate,
  JsonObject,
  Timeframe,
  StrategySettings,
  BacktestConfigLike,
  StrategyDraftLike,
  ValidationSummaryLike,
  ScoreBreakdown,
  ResearchChange,
  RoundAnalysis,
  AgentStepLog,
  NormalizedBacktestResult,
  ResearchRound,
  ResearchSummary,
  AutoAgentRequest,
  AutoAgentResearchResult,
  ResearchDraftContext,
  ResearchRepairContext,
  ResearchRunnerClient,
  ResearchRunnerLiveContext,
  ResearchRunnerOptions,
  ResearchRunnerResult,
  ResearchRunnerRound,
  ResearchRunnerStatus,
  ResearchRunnerSummary,
  ResearchConfidence,
  ResearchDecision,
  ResearchEvidenceMetrics,
  ResearchRiskFlag,
  ResearchRoundEvaluation,
  ResearchResultEvaluation,
  ResearchWeakness,
  ResearchVerdict,
  ResearchArtifactBundle,
  ResearchArtifactFile,
  ResearchWorkflowStep,
  ResearchStreamEvent,
  EmitResearchEvent,
  AnalyzeRoundArgs,
} from './types.js';
export type {
  FetchPolicyOptions,
  FetchRetryOptions,
  TraseqClientOptions,
  PublicManifest,
  WorkspaceContext,
  WorkspaceUsageSummary,
  CapabilityDocument,
  StrategyDraft,
  BacktestConfig,
  TraseqAgentErrorExplanation,
  TraseqPublicAgentMetadata,
  TraseqPublicApiErrorBody,
} from './client/index.js';
export type {
  OperationDefinition,
  OperationName,
} from './generated/operation-registry.js';
export type {
  AgentToolDefinition,
  AgentToolName,
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
  ResolvedSemanticFacet,
  SemanticCandidateStatus,
  SemanticComplexity,
  SemanticFacetDefinition,
  SemanticFacetInput,
  SemanticImplementationCandidate,
  SemanticImplementationDefinition,
  SemanticOntologyDocument,
  SemanticResolutionResult,
  SemanticResolveConstraints,
  SemanticRequiredCapabilities,
  SemanticRole,
  SemanticTradeoffs,
  SignalGraphFragment,
} from './semantics/index.js';
