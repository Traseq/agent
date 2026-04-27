# @traseq/agent

Tool-first agent kit for Traseq strategy research.

`@traseq/agent` packages the Traseq public agent API into a Node SDK wrapper,
CLI commands, MCP tools, strategy templates, semantic intent resolution,
reference material, and scoring helpers. It is designed for external agents
that already have a workspace-scoped Traseq API key.

This package does not call an AI provider and does not place live orders. Your
agent is responsible for reasoning and authoring strategy payloads; Traseq
handles validation, persistence, backtests, analysis runs, comparisons, and
reusable blocks.

## Requirements

- Node.js 18 or newer.
- A Traseq API key created from the target workspace.
- API key scopes that match the operations your agent will perform.

Set these environment variables before using CLI or MCP entrypoints:

```sh
export TRASEQ_API_KEY="trsq_..."
export TRASEQ_BASE_URL="https://api.traseq.com"
```

`TRASEQ_BASE_URL` is optional and defaults to `https://api.traseq.com`.

## Install

```sh
npm install @traseq/agent
traseq-agent check-env
```

Inside the monorepo (development):

```sh
pnpm --dir packages/agent build
node packages/agent/dist/cli.js check-env
```

## SDK

```ts
import { TraseqClient, runPlatformTool } from '@traseq/agent';

const client = new TraseqClient({
  baseUrl: process.env.TRASEQ_BASE_URL ?? 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
  timeoutMs: 30_000,
  // Retries default to GET/HEAD only to avoid duplicate writes.
  retry: { maxAttempts: 3, baseDelayMs: 1_000 },
});

const context = await client.getWorkspaceContext();
const capabilities = await client.getCapabilities();

const validation = await runPlatformTool(client, 'validate_strategy', {
  signalGraph: {
    protocol: 'traseq.signal-graph',
    version: 2,
    nodes: [],
    strategy: { kind: 'strategy' },
  },
  settings: { positionStyle: 'single', warmupPeriod: 200 },
});
```

Semantic resolution is available as a local agent helper. It does not call a
Traseq backend endpoint and does not create strategies by itself.

```ts
import { resolveStrategySemantics } from '@traseq/agent/semantics';

const resolved = resolveStrategySemantics({
  prompt: 'Break above the recent range high, but do not chase too far.',
  capabilities,
  constraints: { timeframe: '4h', complexity: 'balanced' },
});

console.log(resolved.assemblyPlan.recommendedCandidateIds);
```

## CLI

```sh
traseq-agent context --section skill
traseq-agent tools
traseq-agent run --tool get_workspace_context
traseq-agent run --tool get_capabilities
traseq-agent run --tool get_semantics
traseq-agent run --tool resolve_strategy_semantics --input '{"prompt":"RSI oversold rebound"}'
traseq-agent score --backtest-id <backtest-id>
traseq-agent research --prompt "Research a BTCUSDT 4h trend-following strategy"
```

The `research` command creates a live, tool-first research brief. It reads
workspace context, usage, manifest, and capabilities, then returns prompts and a
recommended workflow for the external agent.

`traseq-agent run` supports both platform tools and agent-local tools. If
`resolve_strategy_semantics` is called without a `capabilities` object, the CLI
will fetch live capabilities first using `TRASEQ_API_KEY`.

## MCP

Run the stdio MCP server:

```sh
traseq-agent-mcp
```

Example MCP server configuration for **Claude Desktop** (`claude_desktop_config.json`) or **Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "traseq": {
      "command": "traseq-agent-mcp",
      "env": {
        "TRASEQ_API_KEY": "trsq_...",
        "TRASEQ_BASE_URL": "https://api.traseq.com"
      }
    }
  }
}
```

The MCP server exposes platform tools plus agent-local semantic tools.
Destructive platform tools require `confirm: true` before the local runner will
call the API.
When Traseq returns structured Public Agent errors, the server formats the
machine-readable reason, next steps, retryability, and Traseq app links for the
calling agent.

## Semantic Resolver

The semantic resolver helps an external AI agent move from user intent to
capability-grounded `signalGraph` fragments.

Use it when the user expresses strategy meaning, such as:

- breakout with volume confirmation
- RSI oversold rebound
- compression before breakout
- avoid chasing entries too far from the trigger level
- exit after a position has been open for a number of bars

Available local tools:

| Tool                         | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `get_semantics`              | Read the local semantic ontology and optional implementation fragments. |
| `resolve_strategy_semantics` | Resolve facets or prompt text into candidate `signalGraph` fragments.   |

The resolver output is intentionally not a complete strategy. It returns:

- resolved semantic facets
- ranked candidate fragments
- required capabilities
- tradeoffs, risks, and validation hints
- an assembly plan with recommended candidate IDs

Your agent should assemble the selected fragments into a complete
`signalGraph`, add entry action, exits or risk rules, then call
`validate_strategy` before any create or finalize operation.

## Agent Workflow

1. `get_manifest`: discover the API contract.
2. `get_workspace_context`: confirm workspace, key scopes, role, and tier.
3. `get_usage`: check current budget and limits.
4. `get_capabilities`: load the live strategy authoring contract.
5. `resolve_strategy_semantics`: map user intent to candidate fragments.
6. Assemble a complete `signalGraph` from selected fragments.
7. `validate_strategy`: repair payload issues before writes.
8. `create_strategy` or `create_strategy_version`: persist a draft.
9. `finalize_strategy_version`: lock the version for backtesting.
10. `run_backtest` and `wait_backtest`: queue and poll results.
11. `get_backtest_chart_data`, `preview_robustness_analysis`,
    `create_comparison_set`: inspect evidence and compare revisions.

## API Key Scopes

| Scope                    | Enables                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `workspace_read`         | Workspace context, usage, capabilities                                                       |
| `system_strategies_read` | Listing and reading system strategy templates                                                |
| `strategies_read`        | Reading workspace strategies and versions                                                    |
| `strategies_write`       | Validating, creating, updating, finalizing, archiving, restoring, deleting strategy versions |
| `backtests_read`         | Listing and reading backtests and progress                                                   |
| `backtests_write`        | Running, setting primary, and deleting backtests                                             |
| `analysis_runs_read`     | Listing and reading analysis runs                                                            |
| `analysis_runs_write`    | Previewing, creating, updating, and deleting robustness analysis runs                        |
| `comparison_sets_read`   | Listing and reading comparison sets                                                          |
| `comparison_sets_write`  | Creating, updating, and deleting comparison sets                                             |
| `blocks_read`            | Listing and reading reusable blocks                                                          |
| `blocks_write`           | Creating, updating, deleting, pinning, and unpinning reusable blocks                         |
| `market_read`            | Reading chart data and price previews                                                        |

Write scopes require the corresponding read scope when keys are created in the
Traseq app.

## Safety

- Always call `get_capabilities` before authoring strategy payloads.
- Resolve user intent with `resolve_strategy_semantics` before writing
  non-trivial `signalGraph` JSON.
- Always call `get_usage` before write or backtest workflows so the agent can
  see current budget and hard limits.
- Always call `validate_strategy` before create, update, or finalize.
- Keep generated strategies small enough to inspect.
- Treat backtest output as research evidence, not trading advice.
- Destructive tools require `confirm: true` and should only be used after the
  user understands the impact.

## Verification

```sh
pnpm --dir packages/sdk test
pnpm --dir packages/agent test
```

## See Also

- [Root README](../../README.md) — architecture overview, getting started, and full usage examples
- [`@traseq/sdk`](../sdk/) — low-level API client and types (included as a dependency)

## License

MIT
