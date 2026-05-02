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
  TOKEN_RECIPES,
  findTokenRecipe,
  findTokenRecipeForImplementation,
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
export {
  GUIDED_RESEARCH_PROMPT_DESCRIPTION,
  GUIDED_RESEARCH_PROMPT_NAME,
  MCP_CLIENTS,
  MCP_SCOPES,
  MCP_SERVICE_INSTRUCTIONS,
  NEXT_PROMPT_DEFAULT,
  buildClientInstallPlan,
  buildMcpServerConfig,
  formatShellCommand,
  guidedResearchPromptText,
  probeTraseqMcpSetup,
  redactMcpInstallPlan,
  startMcpServer,
} from './mcp/index.js';
export { toToolList } from './mcp/server.js';
export {
  DEFAULT_MCP_PROFILE,
  GUIDED_AGENT_TOOL_NAMES,
  GUIDED_PLATFORM_OPS,
  operationStage,
  parseMcpProfile,
  platformOperationsForProfile,
} from './mcp/profile.js';
export type { McpProfile, OperationStage } from './mcp/profile.js';
export {
  explainValidationIssues,
  suggestMinimalRepairs,
} from './semantics/repair.js';
export { normalizeStrategyDraft } from './semantics/normalize-draft.js';
export type {
  DraftNormalizePatch,
  NormalizeStrategyDraftResult,
} from './semantics/normalize-draft.js';

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
export {
  renderUsageStatusMarkdown,
  summarizeUsageHints,
} from './usage-hints.js';
export { runResearch, normalizeRequest } from './research.js';
export {
  _clearEngagementStore,
  formatResearchEngagementBrief,
  getResearchEngagement,
  runGuidedResearchRound,
  startResearchEngagement,
  summarizeResearchEngagement,
  updateResearchEngagement,
} from './guided-research.js';
export type { ResearchEngagementPatch } from './guided-research.js';
export {
  RUNNER_SCHEMA_VERSION,
  buildBacktestConfig,
  buildDefaultStrategySettings,
  runResearchRunner,
  selectChampionRound,
} from './research-runner.js';
export { fetchWithRetry, type RetryOptions } from './http.js';
export {
  listenForSignalEvents,
  serveSignalWebhook,
  testEventAdapter,
} from './events/index.js';
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
  ResearchRiskTolerance,
  ResearchEngagementInput,
  ServiceMessage,
  ResearchDecisionPoint,
  ResearchEngagementBrief,
  ResearchContextClient,
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
  GuidedResearchRoundInput,
  GuidedResearchEvidence,
  GuidedResearchRoundResult,
  ResearchStreamEvent,
  EmitResearchEvent,
  AnalyzeRoundArgs,
} from './types.js';
export type {
  McpClient,
  McpInstallPlan,
  McpInstallPlanInput,
  McpProbeClient,
  McpProbeResult,
  McpScope,
  McpServerConfig,
  McpServerConfigInput,
  McpServerEntry,
  ResolvedMcpClient,
} from './mcp/index.js';
export type {
  FetchPolicyOptions,
  FetchRetryOptions,
  TraseqClientOptions,
  PublicManifest,
  WorkspaceContext,
  WorkspaceUsageSummary,
  CapabilityDocument,
  TokenDto,
  TokenBlockCompileRequest,
  TokenBlockCompileResponse,
  SemanticBlock,
  SemanticBlockRole,
  BlockListResponse,
  CreateBlockRequest,
  UpdateBlockRequest,
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
  SummarizeUsageHintsInput,
  UsageBottleneck,
  UsageBottleneckResource,
  UsageHintLevel,
  UsageHintTier,
  UsageHintUnit,
  UsageStatus,
} from './usage-hints.js';
export type { EventAdapter, EventAdapterContext } from './events/index.js';
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
  TokenRecipeDefinition,
  TokenRecipeOutput,
  TokenRecipeParameter,
} from './semantics/index.js';
