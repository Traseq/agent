import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDED_AGENT_TOOL_NAMES,
  GUIDED_PLATFORM_OPS,
  OPERATION_REGISTRY,
  operationStage,
  parseMcpProfile,
  platformOperationsForProfile,
  toToolList,
} from '../dist/index.js';

describe('mcp profile filter', () => {
  it('parseMcpProfile defaults to guided', () => {
    assert.equal(parseMcpProfile(undefined), 'guided');
    assert.equal(parseMcpProfile('guided'), 'guided');
    assert.equal(parseMcpProfile('full'), 'full');
    assert.equal(parseMcpProfile('garbage'), 'guided');
  });

  it('platformOperationsForProfile only returns guided allowlist in guided mode', () => {
    const guided = platformOperationsForProfile('guided');
    for (const op of guided) {
      assert.ok(
        GUIDED_PLATFORM_OPS.has(op.name),
        `${op.name} leaked into guided profile`,
      );
    }
    const full = platformOperationsForProfile('full');
    assert.ok(
      full.length > guided.length,
      'full profile must expose more tools than guided',
    );
  });

  it('toToolList in guided profile excludes destructive ops like delete_strategy_version', () => {
    const tools = toToolList('guided');
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(
      names.has('start_research_engagement'),
      'guided tools should always be present',
    );
    assert.ok(
      !names.has('delete_strategy_version'),
      'destructive op should be hidden in guided profile',
    );
    assert.ok(
      !names.has('create_strategy'),
      'write op should be hidden in guided profile',
    );
  });

  it('guided profile exposes only guided agent tools, including token composition', () => {
    // Why this number is fixed: every agent tool a guided client sees adds to
    // Claude Desktop's tools/list payload, which past ~30 entries forces clients
    // into a deferred-tool flow (one extra ToolSearch round-trip per first call).
    // The guided set below is the user-facing workflow surface; lower-level
    // resolver/preflight helpers stay hidden.
    const tools = toToolList('guided');
    const agentToolNames = tools
      .map((tool) => tool.name)
      .filter((name) => GUIDED_AGENT_TOOL_NAMES.has(name));
    assert.equal(agentToolNames.length, GUIDED_AGENT_TOOL_NAMES.size);
    const exposed = new Set(tools.map((tool) => tool.name));
    for (const name of [
      'get_token_grammar',
      'materialize_token_ast',
      'validate_token_grammar_candidate',
      'get_token_semantics',
      'compose_token_block',
      'validate_token_block',
      'assemble_strategy_from_blocks',
    ]) {
      assert.ok(exposed.has(name), `${name} should be guided-visible`);
    }
    const hidden = [
      'get_semantics',
      'resolve_strategy_semantics',
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'run_research_draft',
      'evaluate_research_result',
      'format_research_report',
      'suggest_minimal_repairs',
    ];
    for (const name of hidden) {
      assert.ok(
        !exposed.has(name),
        `${name} should be hidden from the guided profile tools/list`,
      );
    }
  });

  it('full profile keeps every agent tool exposed for advanced operators', () => {
    const tools = toToolList('full');
    const exposed = new Set(tools.map((tool) => tool.name));
    for (const advanced of [
      'resolve_strategy_semantics',
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'suggest_minimal_repairs',
    ]) {
      assert.ok(
        exposed.has(advanced),
        `${advanced} must remain available under --profile=full`,
      );
    }
  });

  it('toToolList in full profile exposes write/destructive ops with stage hints', () => {
    const tools = toToolList('full');
    const create = tools.find((tool) => tool.name === 'create_strategy');
    assert.ok(create, 'full profile must expose create_strategy');
    assert.match(create.description, /Stage:\s*write/);
    assert.match(
      create.description,
      /Do not call before run_guided_research_round/,
    );
    const del = tools.find((tool) => tool.name === 'delete_strategy_version');
    assert.ok(del, 'full profile must expose delete_strategy_version');
    assert.match(del.description, /Stage:\s*destructive/);
    assert.match(del.description, /confirm=true/);
  });

  it('classifies side-effect-free POST ops as read so guided mode can expose them', () => {
    // The mcp profile module hard-codes a small allowlist of POST operations
    // that are deliberately side-effect-free (validation, compile, cost
    // estimation). For each one that's actually registered, operationStage
    // must report `read`; if a future PR adds an entry to the allowlist it
    // will need to ship the operation too.
    const expectRead = [
      'validate_strategy',
      'compile_block',
      'validate_block',
      'materialize_token_grammar',
      'validate_token_grammar',
    ];
    let assertions = 0;
    for (const name of expectRead) {
      const op = OPERATION_REGISTRY.find((entry) => entry.name === name);
      if (!op) continue;
      assert.equal(operationStage(op), 'read');
      assertions += 1;
    }
    assert.ok(
      assertions >= expectRead.length,
      `every side-effect-free POST op listed must be present in OPERATION_REGISTRY (saw ${assertions}/${expectRead.length})`,
    );

    // Sanity: regular POST writes still classify as `write`.
    const writeOp = OPERATION_REGISTRY.find(
      (entry) => entry.name === 'create_strategy',
    );
    assert.ok(writeOp);
    assert.equal(operationStage(writeOp), 'write');

    // delete_block is destructive — confirm enforcement comes from the runner.
    const destructive = OPERATION_REGISTRY.find(
      (entry) => entry.name === 'delete_block',
    );
    assert.ok(destructive);
    assert.equal(operationStage(destructive), 'destructive');
    assert.equal(destructive.destructive, true);
  });
});
