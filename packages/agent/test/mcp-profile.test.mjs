import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATION_REGISTRY,
  operationStage,
  parseMcpProfile,
  platformOperationsForProfile,
  toToolList,
} from '../dist/index.js';

describe('mcp profile filter', () => {
  it('parseMcpProfile defaults to hybrid and rejects unknown profiles', () => {
    assert.equal(parseMcpProfile(undefined), 'hybrid');
    assert.equal(parseMcpProfile('hybrid'), 'hybrid');
    assert.equal(parseMcpProfile('template'), 'template');
    assert.equal(parseMcpProfile('authoring'), 'authoring');
    assert.equal(parseMcpProfile('reference'), 'reference');
    assert.equal(parseMcpProfile('full'), 'full');
    assert.throws(() => parseMcpProfile('guided'), /Invalid MCP profile/);
    assert.throws(() => parseMcpProfile('garbage'), /Invalid MCP profile/);
  });

  it('platformOperationsForProfile keeps non-full profiles read-safe', () => {
    for (const profile of ['hybrid', 'template', 'authoring', 'reference']) {
      const ops = platformOperationsForProfile(profile);
      assert.ok(ops.length > 0, `${profile} should expose read-safe ops`);
      for (const op of ops) {
        assert.notEqual(
          operationStage(op),
          'write',
          `${op.name} leaked as write op into ${profile}`,
        );
        assert.notEqual(
          operationStage(op),
          'destructive',
          `${op.name} leaked as destructive op into ${profile}`,
        );
      }
    }
    const hybrid = platformOperationsForProfile('hybrid');
    const reference = platformOperationsForProfile('reference');
    assert.ok(
      hybrid.length > reference.length,
      'reference profile should expose a smaller read surface than hybrid',
    );
    const full = platformOperationsForProfile('full');
    assert.ok(
      full.length > hybrid.length,
      'full profile must expose more tools than hybrid',
    );
  });

  it('toToolList in hybrid profile excludes destructive platform ops', () => {
    const tools = toToolList('hybrid');
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(
      names.has('start_research_engagement'),
      'hybrid tools should always be present',
    );
    for (const hidden of ['delete_strategy_version', 'create_strategy']) {
      assert.ok(
        !names.has(hidden),
        `${hidden} should be hidden in hybrid profile`,
      );
    }
  });

  it('hybrid profile exposes one entry point per authoring path', () => {
    const tools = toToolList('hybrid');
    const names = new Set(tools.map((tool) => tool.name));
    // Hybrid is intentionally lean — block path collapses to compose +
    // assemble, SG v2 path to resolve + assemble + preflight. Specialists
    // (raw token grammar, get_semantics) are reachable via --profile=template
    // or --profile=authoring respectively.
    for (const name of [
      'compose_strategy_from_template',
      'compose_token_block',
      'assemble_strategy_from_blocks',
      'resolve_strategy_semantics',
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'suggest_minimal_repairs',
      'get_authoring_examples',
      'get_token_semantics',
    ]) {
      assert.ok(names.has(name), `${name} should be hybrid-visible`);
    }
    for (const name of [
      'get_token_grammar',
      'materialize_token_ast',
      'validate_token_grammar_candidate',
      'validate_token_block',
      'get_semantics',
    ]) {
      assert.ok(
        !names.has(name),
        `${name} should be hidden from hybrid; switch to --profile=template or --profile=authoring`,
      );
    }
  });

  it('template profile keeps direct SG v2 helpers hidden', () => {
    const tools = toToolList('template');
    const exposed = new Set(tools.map((tool) => tool.name));
    for (const name of [
      'validate_token_grammar_candidate',
      'get_token_semantics',
      'compose_token_block',
      'validate_token_block',
      'assemble_strategy_from_blocks',
    ]) {
      assert.ok(exposed.has(name), `${name} should be template-visible`);
    }
    for (const name of [
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'suggest_minimal_repairs',
    ]) {
      assert.ok(
        !exposed.has(name),
        `${name} should be hidden from the template profile tools/list`,
      );
    }
  });

  it('authoring profile exposes SG v2 helpers without recipe composers', () => {
    const tools = toToolList('authoring');
    const exposed = new Set(tools.map((tool) => tool.name));
    for (const name of [
      'resolve_strategy_semantics',
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'suggest_minimal_repairs',
    ]) {
      assert.ok(exposed.has(name), `${name} should be authoring-visible`);
    }
    for (const name of [
      'compose_token_block',
      'assemble_strategy_from_blocks',
    ]) {
      assert.ok(
        !exposed.has(name),
        `${name} should be hidden from the authoring profile tools/list`,
      );
    }
  });

  it('reference profile exposes examples and grammar without callable composition', () => {
    const tools = toToolList('reference');
    const exposed = new Set(tools.map((tool) => tool.name));
    for (const name of [
      'get_authoring_examples',
      'get_token_grammar',
      'get_token_semantics',
      'get_semantics',
    ]) {
      assert.ok(exposed.has(name), `${name} should be reference-visible`);
    }
    for (const name of [
      'compose_token_block',
      'materialize_token_ast',
      'assemble_strategy_from_blocks',
      'assemble_signal_graph',
      'preflight_strategy_draft',
      'run_guided_research_round',
    ]) {
      assert.ok(
        !exposed.has(name),
        `${name} should be hidden from the reference profile tools/list`,
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

  it('classifies side-effect-free POST ops as read so non-full profiles can expose them', () => {
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
