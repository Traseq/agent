import { getToolDefinitions } from './tool-schema.js';
import { AGENT_TOOL_REGISTRY } from '../semantics/index.js';

export { getToolDefinitions };

function toolToMarkdown(tool: {
  name: string;
  description: string;
  endpoint: { method: string; path: string };
  input_schema: Record<string, unknown>;
}): string {
  const params = tool.input_schema.properties as
    | Record<string, unknown>
    | undefined;
  const required = (tool.input_schema.required ?? []) as string[];

  const paramLines = params
    ? Object.entries(params).map(([key, schema]) => {
        const s = schema as Record<string, unknown>;
        const req = required.includes(key) ? ' (required)' : ' (optional)';
        const type = typeof s.type === 'string' ? s.type : 'object';
        const desc =
          typeof s.description === 'string' ? ` — ${s.description}` : '';
        return `  - \`${key}\`: ${type}${req}${desc}`;
      })
    : [];

  return [
    `### ${tool.name}`,
    '',
    tool.description,
    '',
    `**Endpoint**: \`${tool.endpoint.method} ${tool.endpoint.path}\``,
    ...(paramLines.length > 0 ? ['', '**Parameters**:', ...paramLines] : []),
  ].join('\n');
}

export const tools = {
  definitions: getToolDefinitions,
  agentDefinitions: () => AGENT_TOOL_REGISTRY,

  asMarkdown(): string {
    const defs = getToolDefinitions();
    const localDefs = AGENT_TOOL_REGISTRY;
    return [
      '# Traseq API Tools',
      '',
      'Use the guided research tools first when the user wants a service-style research workflow. Use lower-level platform tools when you need direct automation control.',
      'Platform tools require a valid Traseq API key in the `x-api-key` header. Agent-local tools run inside `@traseq/agent` and may fetch `get_capabilities` when needed.',
      '',
      '## Workflow Order',
      '',
      '1. `start_research_engagement` — Frame the research task, assumptions, decision points, and evidence boundaries.',
      '2. `resolve_strategy_semantics` — Resolve user intent into capability-grounded signalGraph fragments.',
      '3. Author a complete `StrategyDraftLike` outside of `@traseq/agent`.',
      '4. `run_guided_research_round` — Validate, persist after validation, backtest, evaluate, and report.',
      '5. `summarize_research_engagement` — Render saved evidence as a service memo.',
      '',
      'Lower-level order remains available for automation: get_manifest, get_workspace_context, get_usage, get_capabilities, validate_strategy, create/finalize, run_backtest, then get/wait results.',
      '',
      '## Agent-Local Tools',
      '',
      ...localDefs.map((tool) =>
        [
          `### ${tool.name}`,
          '',
          tool.description,
          '',
          '**Execution**: local agent tool',
        ].join('\n'),
      ),
      '',
      '## Platform Tools',
      '',
      '---',
      '',
      ...defs.map(toolToMarkdown),
    ].join('\n');
  },
};
