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
      'These are the available tools for interacting with the Traseq platform and local agent knowledge.',
      'Platform tools require a valid Traseq API key in the `x-api-key` header. Agent-local tools run inside `@traseq/agent` and may fetch `get_capabilities` when needed.',
      '',
      '## Workflow Order',
      '',
      '1. `get_manifest` — Discover the API contract.',
      '2. `get_workspace_context` — Check subscription tier and scopes.',
      '3. `get_capabilities` — Load indicator catalog and node shapes.',
      '4. `resolve_strategy_semantics` — Resolve user intent into capability-grounded signalGraph fragments.',
      '5. `validate_strategy` — Validate before persisting.',
      '6. `create_strategy` — Create a draft strategy.',
      '7. `finalize_strategy_version` — Lock the version.',
      '8. `run_backtest` — Queue a backtest.',
      '9. `get_backtest` — Poll until terminal status.',
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
