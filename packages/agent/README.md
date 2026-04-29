# @traseq/agent

Guided strategy research service kit for Traseq.

`@traseq/agent` helps external agents guide users through a professional Traseq
strategy research engagement: clarify the thesis, state assumptions, validate
drafts, run backtests, evaluate evidence, and produce a user-facing decision
memo.

It also packages the Traseq public agent API into a Node SDK wrapper, CLI
commands, MCP tools, strategy templates, semantic intent resolution, reference
material, and scoring helpers for lower-level automation.

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
If you do not have a key yet, start with the free tier and create a workspace
API key:
`https://app.traseq.com/login?redirectTo=%2Fsettings%2Fapi-keys&entry_surface=agent_cli&entry_source=missing_traseq_api_key&cta_id=start_with_free_tier`.

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

## MCP In 60 Seconds

`setup-mcp` generates a Claude/Codex-ready stdio MCP config. Dry-run is the
default, so the first command prints the exact install command and JSON without
writing secrets.

```sh
traseq-agent setup-mcp --client codex --probe
traseq-agent setup-mcp --client codex --write --probe

traseq-agent setup-mcp --client claude-code --write --probe
traseq-agent setup-mcp --client claude-desktop --print-config
traseq-agent setup-mcp --client generic --print-config
```

Without installing the package first, invoke the binary explicitly:

```sh
npx -y --package @traseq/agent traseq-agent setup-mcp --client codex --write --probe
```

If `TRASEQ_API_KEY` is not set yet, set it in the current terminal before
running setup:

```sh
export TRASEQ_API_KEY="trsq_..."
npx -y --package @traseq/agent traseq-agent setup-mcp --client codex --write --probe
```

For a one-command local install, `setup-mcp` also accepts `--api-key`, but that
value may remain in shell history:

```sh
npx -y --package @traseq/agent traseq-agent setup-mcp --client codex --write --probe --api-key "trsq_..."
```

Project-scoped config uses `${TRASEQ_API_KEY}` instead of inlining a secret.
User/local setup can inline `TRASEQ_API_KEY` for a smooth personal install.

On shared hosts, prefer the dry-run output and edit the config manually: when
`--write` runs `claude mcp add` or `codex mcp add`, the API key is briefly
visible in `ps`/`/proc` because those CLIs accept env values via argv. Claude
Desktop installs always inline the key into the config file directly (it does
not expand `${VAR}` placeholders), so make sure that file is not
world-readable.

After setup, ask the client:

```text
Help me validate a BTCUSDT 4h strategy idea. Start with Traseq research engagement first.
```

## Guided SDK

```ts
import { startResearchEngagement, runGuidedResearchRound } from '@traseq/agent';

const brief = await startResearchEngagement({
  prompt: 'Research a BTCUSDT 4h trend-following strategy',
});

console.log(brief.assumptions);
console.log(brief.decisionPoints);

// After an external agent authors a StrategyDraftLike:
const guided = await runGuidedResearchRound({
  prompt: brief.input.prompt,
  draft,
  instrument: brief.input.instrument,
  timeframe: brief.input.timeframe,
});

console.log(guided.verdict.decision);
console.log(guided.report);
```

The guided layer is provider-agnostic. Your external agent still authors the
draft; Traseq handles the research service loop around validation, persistence,
backtesting, evidence evaluation, and reporting.

## Low-Level SDK

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
traseq-agent guide --prompt "Research a BTCUSDT 4h trend-following strategy"
traseq-agent guide --prompt "Research a BTC trend strategy" --json
traseq-agent guide-run \
  --prompt "Research a BTC trend strategy" \
  --draft '{"name":"...","signalGraph":{},"settings":{"positionStyle":"single"},"backtest":{"timeframe":"4h","signalInstrument":{"symbol":"BTCUSDT"}}}'

# Lower-level automation remains available:
traseq-agent run --tool get_workspace_context
traseq-agent run --tool get_capabilities
traseq-agent run --tool get_semantics
traseq-agent run --tool resolve_strategy_semantics --input '{"prompt":"RSI oversold rebound"}'
traseq-agent score --backtest-id <backtest-id>
traseq-agent research --prompt "Research a BTCUSDT 4h trend-following strategy"
traseq-agent setup-mcp --client codex --probe
traseq-agent mcp
traseq-agent evaluate --stdin < research-result.json
traseq-agent report --stdin < research-result.json > research-report.md
traseq-agent research-run \
  --prompt "Research a BTC trend strategy" \
  --draft '{"name":"...","signalGraph":{},"settings":{"positionStyle":"single"},"backtest":{"timeframe":"4h","signalInstrument":{"symbol":"BTCUSDT"}}}'
```

The `guide` command creates a service-style research engagement brief. It reads
workspace context, usage, manifest, and capabilities, then returns assumptions,
decision points, evidence boundaries, and provider-agnostic authoring
instructions. Use `--json` when another agent should consume the brief.

The `guide-run` command executes one externally-authored draft as a guided
research round and prints a Markdown service memo by default. Use `--json` for
the full machine-readable result.

The `research` command creates a live, tool-first research brief. It reads
workspace context, usage, manifest, and capabilities, then returns prompts and a
recommended workflow for the external agent.

The `research-run` command executes one externally-authored draft through the
platform workflow: validate, create, finalize, backtest, score, and report. It
does not generate or repair strategy JSON by itself. For stdin-based workflows:

```sh
cat draft.json | traseq-agent research-run \
  --prompt "Research a BTCUSDT 4h trend-following strategy" \
  --stdin
```

The `evaluate` command reads a `runResearchRunner` JSON result from stdin and
returns a pure JSON evidence evaluation. It does not call Traseq APIs, run
backtests, create robustness analyses, create comparison sets, or produce
Markdown reports. Use `report --stdin` when a human-readable Markdown summary is
needed for Codex, Claude Code, PR comments, or saved research notes.

`traseq-agent run` supports both platform tools and agent-local tools. If
`resolve_strategy_semantics` is called without a `capabilities` object, the CLI
will fetch live capabilities first using `TRASEQ_API_KEY`.

## MCP

Run the stdio MCP server directly:

```sh
traseq-agent-mcp
# or
traseq-agent mcp
```

Use `setup-mcp` for client-specific install guidance:

```sh
traseq-agent setup-mcp --client codex
traseq-agent setup-mcp --client claude-code
traseq-agent setup-mcp --client claude-desktop --print-config
traseq-agent mcp-doctor --client auto --probe
```

Example generic MCP server configuration for **Claude Desktop**, **Claude
Code**, Codex, or another stdio MCP client:

```json
{
  "mcpServers": {
    "traseq": {
      "command": "npx",
      "args": ["-y", "--package", "@traseq/agent", "traseq-agent", "mcp"],
      "env": {
        "TRASEQ_API_KEY": "${TRASEQ_API_KEY}",
        "TRASEQ_BASE_URL": "https://api.traseq.com"
      }
    }
  }
}
```

The MCP server exposes guided research tools, semantic tools, and platform
tools. `tools/list` puts `start_research_engagement`,
`run_guided_research_round`, and `summarize_research_engagement` first, and
`prompts/list` exposes `traseq_guided_research` so clients can start with a
service-style flow instead of guessing tool order. Destructive platform tools
require `confirm: true` before the local runner will call the API.
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

## Research Runner

Use the SDK runner when an external agent can produce strategy drafts from the
Traseq context. The runner keeps the operational loop deterministic and
auditable while leaving reasoning and authoring to the caller.

```ts
import { runResearchRunner } from '@traseq/agent';

const result = await runResearchRunner({
  input: {
    prompt: 'Research a BTCUSDT 4h trend-following strategy',
    instrument: 'BTCUSDT',
    timeframe: '4h',
    rounds: 3,
  },
  producerTimeoutMs: 120_000,
  draftProducer: async (context, signal) => {
    // Your agent reads context.live.capabilities and returns StrategyDraftLike.
    // Honor the AbortSignal to cancel cleanly when the runner times out.
    return buildDraftSomewhereElse(context, signal);
  },
  repairProducer: async ({ draft, validation }, signal) => {
    // Optional: repair validation issues. The runner caps repairs at 4 attempts.
    return repairDraftSomewhereElse(draft, validation, signal);
  },
});

console.log(result.schemaVersion, result.status, result.championRound);
```

Each producer call is bounded by `producerTimeoutMs` (default 120s). When the
deadline elapses the runner aborts the supplied `AbortSignal` and rejects with
`ProducerTimeoutError`. Results carry a `schemaVersion` (currently `1`); the
`evaluate` CLI rejects mismatched schemas, so bump the version when the result
shape changes.

The runner does not call an AI provider, does not place live orders, and does
not call destructive tools. CLI `research-run` is intentionally single-round;
passing `--rounds` is rejected. Use the SDK callbacks for multi-round research.

## Research Evaluator

Use the evaluator after a runner result exists. It classifies each completed
round as `robust`, `promising`, `weak`, or `reject`, then returns risk flags and
a next decision for external agents.

```ts
import { evaluateResearchResult } from '@traseq/agent/evaluation';

const evaluation = evaluateResearchResult(result);
console.log(evaluation.confidence, evaluation.verdict.decision);
for (const round of evaluation.rounds) {
  for (const weakness of round.weaknesses) {
    console.log(weakness.code, weakness.message);
  }
}
```

The evaluator is intentionally pure and JSON-only. It does not calculate
buy-and-hold baselines, run out-of-sample tests, call robustness APIs, or write
platform resources. Treat its output as early research triage, not live-trading
approval.

Top-level `confidence` is authoritative; the verdict carries `decision`,
`summary`, and `nextAction`. Round-level `weaknesses` are `{code, message}`
pairs and align 1:1 with `riskFlags`. A `blocker` severity always forces a
`reject` confidence — these two views never disagree. The CLI exits zero
whether the verdict is keep, iterate, or reject; consumers should branch on
`verdict.decision`, not the exit code.

## Research Reports

Use the report helper when the external agent needs a service memo in addition
to machine-readable JSON. Reports are structured as Executive Verdict, What We
Tested, Evidence, Risk Flags, Decision, and Recommended Next Step.

```ts
import {
  buildResearchArtifactBundle,
  formatResearchReport,
} from '@traseq/agent/report';

const markdown = formatResearchReport(result);
const bundle = buildResearchArtifactBundle(result);

console.log(markdown);
console.log(bundle.root); // .traseq/research/<runId>
```

`buildResearchArtifactBundle` is intentionally pure. It returns deterministic
`result.json`, `evaluation.json`, and `report.md` file payloads, but does not
write them to disk. The caller decides whether to persist artifacts, attach them
to a PR, or keep them in the current agent conversation.

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

For Claude Code, Codex, or another MCP-capable agent, the higher-level local
tools provide the smoother first path:

1. `start_research_engagement`: return assumptions, decision points, evidence
   boundaries, and authoring instructions.
2. `resolve_strategy_semantics`: map the user's thesis to capability-grounded
   fragments.
3. Author a complete `StrategyDraftLike` outside of `@traseq/agent`.
4. `run_guided_research_round`: validate, create, finalize, backtest, evaluate,
   and return a service memo in one auditable call.
5. `summarize_research_engagement`: render saved runner JSON or guided results
   as a memo without network calls.

The older `run_research_draft`, `evaluate_research_result`, and
`format_research_report` tools remain available for automation compatibility.

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

Runner changes should be developed test-first. Prefer fake `TraseqClient`
fixtures for orchestration, validation gates, repair limits, lineage, champion
selection, and CLI JSON behavior. Do not add AI provider environment
requirements to these tests.

## See Also

- [Root README](../../README.md) — architecture overview, getting started, and full usage examples
- [`@traseq/sdk`](../sdk/) — low-level API client and types (included as a dependency)

## License

MIT
