import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDED_AGENT_TOOL_NAMES,
  GUIDED_PLATFORM_OPS,
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

  it('guided profile only exposes the 4 essential agent tools (P1-D)', () => {
    // Why this number is fixed: every agent tool a guided client sees adds to
    // Claude Desktop's tools/list payload, which past ~30 entries forces clients
    // into a deferred-tool flow (one extra ToolSearch round-trip per first call).
    // The four below are the verbs the user actually narrates; the rest are
    // internals reachable inside run_guided_research_round.
    const tools = toToolList('guided');
    const agentToolNames = tools
      .map((tool) => tool.name)
      .filter((name) => GUIDED_AGENT_TOOL_NAMES.has(name));
    assert.equal(agentToolNames.length, GUIDED_AGENT_TOOL_NAMES.size);
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
    const exposed = new Set(tools.map((tool) => tool.name));
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
});
