import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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
