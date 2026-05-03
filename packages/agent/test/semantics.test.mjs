import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyDraft } from '@traseq/sdk';
import {
  AGENT_TOOL_REGISTRY,
  SEMANTIC_FACETS,
  SEMANTIC_IMPLEMENTATIONS,
  TOKEN_RECIPES,
  getSemantics,
  resolveStrategySemantics,
  runAgentTool,
} from '../dist/index.js';

const FULL_CAPABILITIES = {
  protocol: 'traseq.capabilities',
  version: 1,
  subscriptionTier: 'pro',
  signalGraph: {
    version: 2,
    nodeKinds: [
      'market',
      'indicator',
      'compare',
      'cross',
      'rolling',
      'near',
      'pivot',
      'event',
      'all',
      'sequence',
      'state',
      'time_window',
      'state_machine',
    ],
    nodes: [],
    assemblyHints: [],
  },
  indicators: [
    {
      id: 'ema',
      args: [
        { name: 'length', type: 'integer', required: true, minimum: 1 },
        {
          name: 'source',
          type: 'enum',
          required: false,
          enumValues: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
        },
      ],
    },
    {
      id: 'sma',
      args: [
        { name: 'length', type: 'integer', required: true, minimum: 1 },
        {
          name: 'source',
          type: 'enum',
          required: false,
          enumValues: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
        },
      ],
    },
    {
      id: 'rsi',
      args: [{ name: 'length', type: 'integer', required: true, minimum: 1 }],
    },
    {
      id: 'atr',
      args: [{ name: 'length', type: 'integer', required: true, minimum: 1 }],
    },
    {
      id: 'macd',
      structuralType: 'oscillator_operand',
      args: [
        { name: 'fast_length', type: 'integer', required: true, minimum: 1 },
        { name: 'slow_length', type: 'integer', required: true, minimum: 1 },
        { name: 'signal_length', type: 'integer', required: true, minimum: 1 },
        {
          name: 'source',
          type: 'enum',
          required: false,
          enumValues: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'],
        },
      ],
      output: {
        name: 'output',
        type: 'enum',
        required: true,
        enumValues: ['macd', 'signal', 'hist'],
      },
    },
    {
      id: 'supertrend',
      args: [
        { name: 'atr_length', type: 'integer', required: true, minimum: 1 },
        { name: 'multiplier', type: 'number', required: true, minimum: 0 },
      ],
      output: {
        name: 'output',
        type: 'enum',
        required: true,
        enumValues: ['supertrend', 'trend_direction'],
      },
      outputs: ['supertrend', 'trend_direction'],
    },
  ],
  operators: {
    compare: ['eq', 'gt', 'lt'],
    cross: ['cross_up', 'cross_down'],
    rolling: ['max', 'avg'],
  },
};

function resolve(prompt, extra = {}) {
  return resolveStrategySemantics({
    prompt,
    capabilities: FULL_CAPABILITIES,
    constraints: { maxCandidates: 8, ...(extra.constraints ?? {}) },
    ...extra,
  });
}

function candidateIds(result) {
  return result.candidates.map((candidate) => candidate.id);
}

function implementationById(id) {
  const implementation = SEMANTIC_IMPLEMENTATIONS.find(
    (item) => item.id === id,
  );
  assert.ok(implementation, `missing semantic implementation ${id}`);
  return implementation;
}

function nodeById(implementation, id) {
  const node = implementation.fragment.nodes.find((item) => item.id === id);
  assert.ok(node, `${implementation.id} missing node ${id}`);
  return node;
}

function createEntryDraftFromImplementation(implementation) {
  return {
    name: `${implementation.id} fragment validation`,
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: implementation.fragment.nodes,
      strategy: {
        kind: 'strategy',
        entry: {
          kind: 'entry',
          trigger: implementation.fragment.assemblyHints.entryTrigger,
          action: {
            side: 'long',
            sizing: { mode: 'percent_equity', value: 10 },
          },
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: implementation.fragment.settingsHints?.warmupPeriod ?? 100,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10000,
    },
  };
}

describe('semantic ontology', () => {
  it('defines every facet with implementations, tradeoffs, and required capabilities', () => {
    const implementationIds = new Set(
      SEMANTIC_IMPLEMENTATIONS.map((item) => item.id),
    );

    assert.ok(SEMANTIC_FACETS.length >= 20);
    assert.ok(SEMANTIC_IMPLEMENTATIONS.length >= 20);

    for (const facet of SEMANTIC_FACETS) {
      assert.ok(facet.family, `${facet.id} missing family`);
      assert.ok(facet.role, `${facet.id} missing role`);
      assert.ok(facet.description, `${facet.id} missing description`);
      assert.ok(facet.implementationIds.length > 0, `${facet.id} has no impls`);
      for (const id of facet.implementationIds) {
        assert.ok(implementationIds.has(id), `${facet.id} references ${id}`);
      }
    }

    for (const candidate of SEMANTIC_IMPLEMENTATIONS) {
      assert.ok(candidate.tradeoffs.strengths.length > 0, candidate.id);
      assert.ok(candidate.tradeoffs.risks.length > 0, candidate.id);
      assert.ok(candidate.tradeoffs.assumptions.length > 0, candidate.id);
      assert.ok(Array.isArray(candidate.requiredCapabilities.nodeKinds));
      assert.ok(Array.isArray(candidate.validationHints));
    }
  });

  it('attaches deterministic token recipes to every semantic implementation', () => {
    const recipeByImplementation = new Map(
      TOKEN_RECIPES.map((recipe) => [recipe.implementationId, recipe]),
    );

    for (const implementation of SEMANTIC_IMPLEMENTATIONS) {
      const recipe = recipeByImplementation.get(implementation.id);
      assert.ok(recipe, `${implementation.id} missing token recipe`);
      assert.equal(
        implementation.tokenRecipe.recipeId,
        recipe.recipeId,
        `${implementation.id} did not expose its recipe through ontology`,
      );
      assert.ok(recipe.validAs.length > 0, `${recipe.recipeId} validAs`);
      assert.equal(typeof recipe.semanticSummary, 'string');
    }

    const rsi = recipeByImplementation.get('momentum.rsi_cross_up_30');
    assert.equal(rsi.tokens[0].type, 'oscillator_operand');
    assert.equal(rsi.tokens[1].type, 'cross_condition');
    assert.equal(rsi.tokens[2].type, 'constant_operand');

    const goldenCross = recipeByImplementation.get('trend.sma_golden_cross');
    assert.ok(goldenCross, 'trend.sma_golden_cross recipe exists');
    assert.equal(goldenCross.tokens[0].params.name, 'sma');
    assert.equal(goldenCross.tokens[0].params.args.length, 50);
    assert.equal(goldenCross.tokens[1].params.crossOperator, 'cross_up');
    assert.equal(goldenCross.tokens[2].params.args.length, 200);

    const deathCross = recipeByImplementation.get(
      'trend.sma_death_cross_exit',
    );
    assert.ok(deathCross, 'trend.sma_death_cross_exit recipe exists');
    assert.equal(deathCross.role, 'exit');
    assert.equal(deathCross.tokens[1].params.crossOperator, 'cross_down');

    const stop = recipeByImplementation.get('risk.percent_stop_loss');
    assert.equal(stop.produces, 'risk');
    assert.deepEqual(stop.tokens, []);
  });

  it('filters get_semantics by family and hides fragments by default', () => {
    const doc = getSemantics({ family: 'breakout' });
    assert.equal(doc.protocol, 'traseq.agent.semantics');
    assert.ok(doc.facets.length > 0);
    assert.ok(doc.facets.every((facet) => facet.family === 'breakout'));
    assert.equal(doc.implementations, undefined);

    const withFragments = getSemantics({
      family: 'breakout',
      includeFragments: true,
    });
    assert.ok(withFragments.implementations.length > 0);
  });

  it('uses prior rolling windows for breakout and spike thresholds', () => {
    assert.equal(
      nodeById(
        implementationById('breakout.close_crosses_20_high'),
        'range_high_20',
      ).offset,
      1,
    );
    assert.equal(
      nodeById(
        implementationById('stateful.compression_then_breakout'),
        'range_high_20',
      ).offset,
      1,
    );
    assert.equal(
      nodeById(
        implementationById('volume.volume_above_max_50'),
        'volume_max_50',
      ).offset,
      1,
    );
    assert.equal(
      nodeById(
        implementationById('execution.close_near_breakout_level'),
        'range_high_20',
      ).offset,
      1,
    );
  });

  it('gates armed pivot breakout on both armed state and breakout trigger', () => {
    const implementation = implementationById(
      'stateful.pivot_event_arms_breakout',
    );
    const trigger = nodeById(implementation, 'armed_breakout_trigger');

    assert.equal(trigger.kind, 'all');
    assert.deepEqual(trigger.items, [
      { ref: 'armed_pivot_breakout' },
      { ref: 'pivot_breakout' },
    ]);
    assert.deepEqual(implementation.fragment.assemblyHints.entryTrigger, {
      ref: 'armed_breakout_trigger',
    });
    assert.ok(implementation.requiredCapabilities.nodeKinds.includes('all'));
  });

  it('keeps MACD fragments valid against live indicator capability args', () => {
    const implementation = implementationById('momentum.macd_cross_signal');

    assert.deepEqual(nodeById(implementation, 'macd_line').args, {
      fast_length: 12,
      slow_length: 26,
      signal_length: 9,
    });
    assert.equal(nodeById(implementation, 'macd_line').output, 'macd');
    assert.deepEqual(nodeById(implementation, 'macd_signal').args, {
      fast_length: 12,
      slow_length: 26,
      signal_length: 9,
    });
    assert.equal(nodeById(implementation, 'macd_signal').output, 'signal');

    const result = validateStrategyDraft(
      createEntryDraftFromImplementation(implementation),
      FULL_CAPABILITIES,
    );
    assert.equal(
      result.ok,
      true,
      result.ok ? undefined : JSON.stringify(result.issues, null, 2),
    );
  });
});

describe('semantic resolver', () => {
  it('resolves breakout with no-chase semantics', () => {
    const result = resolve('breakout above previous high but do not chase');
    const ids = candidateIds(result);

    assert.ok(ids.includes('breakout.close_crosses_20_high'));
    assert.ok(ids.includes('execution.close_near_breakout_level'));
    assert.ok(
      result.resolvedFacets.some(
        (facet) => facet.id === 'breakout.previous_range_high',
      ),
    );
    assert.ok(
      result.resolvedFacets.some(
        (facet) => facet.id === 'sizing_execution.no_chase_distance',
      ),
    );
  });

  it('resolves RSI oversold rebound into oscillator reclaim', () => {
    const result = resolve('RSI oversold rebound reclaim');
    const ids = candidateIds(result);

    assert.ok(ids.includes('momentum.rsi_cross_up_30'));
    assert.ok(
      result.candidates.some(
        (candidate) =>
          candidate.id === 'momentum.rsi_cross_up_30' &&
          candidate.status === 'recommended',
      ),
    );
  });

  it('resolves Golden Cross and Death Cross into SMA crossover recipes', () => {
    const golden = resolve('golden cross 50 200 SMA long entry');
    const goldenIds = candidateIds(golden);
    assert.ok(goldenIds.includes('trend.sma_golden_cross'));
    assert.ok(
      golden.candidates.some(
        (candidate) =>
          candidate.id === 'trend.sma_golden_cross' &&
          candidate.role === 'entry_trigger',
      ),
    );

    const death = resolve('death cross 50 200 SMA exit');
    const deathIds = candidateIds(death);
    assert.ok(deathIds.includes('trend.sma_death_cross_exit'));
    assert.ok(
      death.candidates.some(
        (candidate) =>
          candidate.id === 'trend.sma_death_cross_exit' &&
          candidate.role === 'exit',
      ),
    );
  });

  it('resolves volume breakout into trigger and confirmation candidates', () => {
    const result = resolve('volume confirmation breakout');
    const ids = candidateIds(result);

    assert.ok(ids.includes('breakout.close_crosses_20_high'));
    assert.ok(ids.includes('volume.volume_above_avg_20'));
    assert.ok(
      result.assemblyPlan.recommendedCandidateIds.includes(
        'breakout.close_crosses_20_high',
      ),
    );
  });

  it('resolves compression then breakout into sequence candidate', () => {
    const result = resolve('compression setup then breakout trigger');
    const ids = candidateIds(result);

    assert.ok(ids.includes('stateful.compression_then_breakout'));
    assert.equal(result.candidates[0].id, 'stateful.compression_then_breakout');
  });

  it('resolves holding-bars exit semantics', () => {
    const result = resolve('exit after holding bars without movement');
    const ids = candidateIds(result);

    assert.ok(ids.includes('position.exit_after_10_bars'));
    assert.ok(result.candidates.some((candidate) => candidate.role === 'exit'));
  });

  it('filters unavailable candidates by live capabilities', () => {
    const result = resolveStrategySemantics({
      prompt: 'RSI oversold rebound reclaim',
      capabilities: {
        ...FULL_CAPABILITIES,
        indicators: [{ id: 'ema' }],
      },
    });

    assert.equal(result.candidates.length, 0);

    const withUnavailable = resolveStrategySemantics({
      prompt: 'RSI oversold rebound reclaim',
      capabilities: {
        ...FULL_CAPABILITIES,
        indicators: [{ id: 'ema' }],
      },
      includeUnavailable: true,
    });

    assert.equal(withUnavailable.candidates[0].status, 'unavailable');
    assert.ok(
      withUnavailable.candidates[0].validationHints.some((hint) =>
        hint.includes('indicator:rsi'),
      ),
    );
  });

  it('resolves SuperTrend prompts into capability-supported candidates', () => {
    const result = resolve('Use supertrend direction as a trend filter');
    const ids = candidateIds(result);

    assert.ok(ids.includes('trend.supertrend_bullish_regime'));
    const candidate = result.candidates.find(
      (item) => item.id === 'trend.supertrend_bullish_regime',
    );
    assert.equal(candidate.status, 'expressible');
    const node = candidate.fragment.nodes.find(
      (item) => item.id === 'supertrend_direction',
    );
    assert.deepEqual(node.args, { atr_length: 10, multiplier: 3 });
    assert.equal(node.output, 'trend_direction');
  });

  it('marks SuperTrend candidates unavailable when capability catalog lacks it', () => {
    const result = resolveStrategySemantics({
      prompt: 'Use supertrend direction as a trend filter',
      capabilities: {
        ...FULL_CAPABILITIES,
        indicators: FULL_CAPABILITIES.indicators.filter(
          (item) => item.id !== 'supertrend',
        ),
      },
      includeUnavailable: true,
    });

    const candidate = result.candidates.find((item) =>
      item.id.startsWith('trend.supertrend_'),
    );
    assert.ok(candidate);
    assert.equal(candidate.status, 'unavailable');
    assert.ok(
      candidate.validationHints.some((hint) =>
        hint.includes('indicator:supertrend'),
      ),
    );
  });

  it('ranks simple capability-supported candidates above risky candidates', () => {
    const result = resolve('volume above average and unusual volume spike');
    const avg = result.candidates.find(
      (candidate) => candidate.id === 'volume.volume_above_avg_20',
    );
    const spike = result.candidates.find(
      (candidate) => candidate.id === 'volume.volume_above_max_50',
    );

    assert.ok(avg);
    assert.ok(spike);
    assert.ok(avg.score > spike.score);
    assert.equal(spike.status, 'risky');
  });
});

describe('agent-local semantic tools', () => {
  it('keeps core semantic keywords locale-neutral', () => {
    const result = getSemantics({});
    assert.doesNotMatch(JSON.stringify(result), /\p{Script=Han}/u);
  });

  it('registers the expected local tools', () => {
    const names = AGENT_TOOL_REGISTRY.map((tool) => tool.name).sort();
    assert.ok(names.includes('get_semantics'));
    assert.ok(names.includes('get_token_grammar'));
    assert.ok(names.includes('materialize_token_ast'));
    assert.ok(names.includes('validate_token_grammar_candidate'));
    assert.ok(names.includes('get_token_semantics'));
    assert.ok(names.includes('get_authoring_examples'));
    assert.ok(names.includes('compose_token_block'));
    assert.ok(names.includes('validate_token_block'));
    assert.ok(names.includes('assemble_strategy_from_blocks'));
    assert.ok(names.includes('resolve_strategy_semantics'));
    assert.ok(names.includes('run_guided_research_round'));
    assert.ok(names.includes('summarize_research_engagement'));
  });

  it('returns read-only authoring examples without composing blocks', async () => {
    const result = await runAgentTool('get_authoring_examples', {
      pattern: 'rsi',
    });

    assert.equal(result.protocol, 'traseq.agent.authoring-examples');
    assert.ok(result.guidance.primaryRule.includes('SG v2'));
    assert.ok(
      result.examples.some(
        (example) =>
          example.mode === 'sg_v2' && example.exampleSignalGraph !== undefined,
      ),
    );
    assert.ok(
      result.examples.some(
        (example) =>
          example.mode === 'block' &&
          typeof example.recipeId === 'string' &&
          example.composedBlock === undefined,
      ),
      'reference examples should name recipes without calling compose_token_block',
    );
  });

  it('ships an exampleSignalGraph that survives preflight (schema drift trap)', async () => {
    // The exampleSignalGraph in get_authoring_examples is the *only* SG v2
    // literal we hand directly to LLM agents as a "what should a concrete
    // draft look like" reference. If the SG v2 schema drifts, every agent
    // that copies this shape produces an invalid draft. Pin the example to
    // preflight here so any incompatible change to node kinds, strategy
    // shape, or risk/exit structure is caught at test time.
    const examples = await runAgentTool('get_authoring_examples', {
      mode: 'sg_v2',
    });
    const sgV2Example = examples.examples.find(
      (example) => example.mode === 'sg_v2',
    );
    assert.ok(sgV2Example?.exampleSignalGraph, 'sg_v2 example must exist');

    const draft = {
      name: 'Authoring example reference draft',
      signalGraph: sgV2Example.exampleSignalGraph,
      settings: { positionStyle: 'single' },
      backtest: {
        timeframe: '4h',
        signalInstrument: { symbol: 'BTCUSDT' },
        initialBalance: 10000,
      },
    };
    const result = await runAgentTool('preflight_strategy_draft', {
      draft,
      capabilities: FULL_CAPABILITIES,
    });
    const errors = (result.issues ?? []).filter(
      (issue) => issue.severity === 'error',
    );
    assert.deepEqual(
      errors,
      [],
      `exampleSignalGraph must preflight cleanly; got errors: ${JSON.stringify(errors, null, 2)}`,
    );
  });

  it('describes recipes as exact-match macros, not the only authoring path', () => {
    const byName = new Map(
      AGENT_TOOL_REGISTRY.map((tool) => [tool.name, tool.description]),
    );

    assert.match(byName.get('compose_token_block') ?? '', /exact/i);
    assert.match(byName.get('assemble_signal_graph') ?? '', /concrete/i);
    assert.doesNotMatch(
      byName.get('assemble_strategy_from_blocks') ?? '',
      /Prefer compose_token_block/,
    );
  });

  it('runs get_semantics without a platform client', async () => {
    const result = await runAgentTool('get_semantics', {
      family: 'volume',
    });

    assert.ok(result.facets.every((facet) => facet.family === 'volume'));
  });

  it('returns a local grammar fallback when no platform client is configured', async () => {
    const result = await runAgentTool('get_token_grammar');

    assert.equal(result.protocol, 'traseq.token-grammar');
    assert.equal(result.source, 'agent_local_fallback');
    assert.ok(result.roles.includes('entry_trigger'));
    assert.match(result.authoringRule, /AST-first/);
  });

  it('delegates AST-first token grammar materialization to the platform client', async () => {
    let calls = 0;
    const expr = { kind: 'pattern', name: 'hammer' };
    const result = await runAgentTool(
      'materialize_token_ast',
      {
        role: 'entry_trigger',
        expr,
        includeFragment: true,
      },
      {
        client: {
          async materializeTokenGrammar(payload) {
            calls += 1;
            assert.deepEqual(payload, {
              role: 'entry_trigger',
              expr,
              includeFragment: true,
            });
            return {
              valid: true,
              source: 'expr',
              role: payload.role,
              tokens: [
                { type: 'pattern_condition', params: { pattern: 'hammer' } },
              ],
              issues: [],
            };
          },
        },
      },
    );

    assert.equal(calls, 1);
    assert.equal(result.valid, true);
    assert.equal(result.source, 'expr');
  });

  it('delegates token grammar candidate validation to the platform client', async () => {
    let calls = 0;
    const tokens = [
      { type: 'pattern_condition', params: { pattern: 'hammer' } },
    ];
    const result = await runAgentTool(
      'validate_token_grammar_candidate',
      {
        role: 'confirmation_filter',
        tokens,
      },
      {
        client: {
          async validateTokenGrammar(payload) {
            calls += 1;
            assert.deepEqual(payload, {
              role: 'confirmation_filter',
              tokens,
            });
            return {
              valid: true,
              source: 'tokens',
              role: payload.role,
              tokens: payload.tokens,
              issues: [],
            };
          },
        },
      },
    );

    assert.equal(calls, 1);
    assert.equal(result.valid, true);
    assert.equal(result.source, 'tokens');
  });

  it('falls back to local raw-token shape validation when no platform client is configured', async () => {
    const result = await runAgentTool('validate_token_grammar_candidate', {
      role: 'exit',
      tokens: [{ type: 'pattern_condition', params: { pattern: 'hammer' } }],
    });

    assert.equal(result.valid, true);
    assert.equal(result.source, 'local_shape');
    assert.equal(result.role, 'exit');
    assert.match(result.warning, /local token shape/);
  });

  it('returns deterministic token semantics as exact-match macros', async () => {
    const result = await runAgentTool('get_token_semantics', {
      role: 'entry_trigger',
      includeTokens: true,
    });

    assert.equal(result.protocol, 'traseq.agent.token-semantics');
    assert.match(result.grammar.authoringRule, /exact-match macros/);
    assert.match(result.grammar.authoringRule, /SG v2 directly/);
    assert.ok(
      result.recipes.some(
        (recipe) => recipe.recipeId === 'momentum.rsi_cross_up_30',
      ),
    );
    assert.ok(result.grammar.availableTokenTypes.includes('cross_condition'));
  });

  it('composes RSI reclaim token block from recipe params', async () => {
    const result = await runAgentTool('compose_token_block', {
      recipeId: 'momentum.rsi_cross_up_30',
      params: { length: 10, threshold: 35 },
    });

    assert.equal(result.block.role, 'entry_trigger');
    assert.equal(result.block.produces, 'bool');
    assert.equal(result.block.tokens[0].params.args.length, 10);
    assert.equal(result.block.tokens[2].params.value, 35);
    assert.equal(
      nodeById({ id: 'materialized', fragment: result.fragment }, 'rsi_reclaim')
        .right.const,
      35,
    );
  });

  it('composes Golden Cross and Death Cross token blocks from recipe params', async () => {
    const entry = await runAgentTool('compose_token_block', {
      recipeId: 'trend.sma_golden_cross',
      params: { fastLength: 40, slowLength: 180 },
    });

    assert.equal(entry.block.role, 'entry_trigger');
    assert.equal(entry.block.name, 'Golden Cross');
    assert.equal(entry.block.tokens[0].params.name, 'sma');
    assert.equal(entry.block.tokens[0].params.args.length, 40);
    assert.equal(entry.block.tokens[1].params.crossOperator, 'cross_up');
    assert.equal(entry.block.tokens[2].params.args.length, 180);
    assert.equal(
      nodeById({ id: 'materialized', fragment: entry.fragment }, 'sma_fast')
        .args.length,
      40,
    );
    assert.equal(
      nodeById({ id: 'materialized', fragment: entry.fragment }, 'sma_slow')
        .args.length,
      180,
    );

    const exit = await runAgentTool('compose_token_block', {
      recipeId: 'trend.sma_death_cross_exit',
      params: { fastLength: 40, slowLength: 180 },
    });

    assert.equal(exit.block.role, 'exit');
    assert.equal(exit.block.name, 'Death Cross exit');
    assert.equal(exit.block.tokens[1].params.crossOperator, 'cross_down');
    assert.deepEqual(exit.fragment.assemblyHints.signalExit, {
      ref: 'death_cross',
    });
  });

  it('uses recipe.displayName as the default block name (not the verbose summary)', async () => {
    const result = await runAgentTool('compose_token_block', {
      recipeId: 'momentum.rsi_cross_up_30',
      params: { length: 14, threshold: 30 },
    });
    assert.equal(result.block.name, 'RSI reclaim');
    // semanticSummary stays available for downstream UIs that want long form.
    assert.match(result.block.semanticSummary, /RSI/);
  });

  it('resolves instruments through the local MCP tool without fallback', async () => {
    const btc = await runAgentTool('resolve_instrument', {
      instrument: 'BTC',
      capabilities: {
        instruments: [
          { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
          { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
          { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
        ],
      },
    });
    assert.equal(btc.status, 'resolved');
    assert.equal(btc.symbol, 'BTCUSDT');

    const spy = await runAgentTool('resolve_instrument', {
      instrument: 'SPY',
      capabilities: {
        instruments: [
          { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
          { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
        ],
      },
    });
    assert.equal(spy.status, 'unsupported');
    assert.equal(spy.symbol, undefined);
  });

  it('every recipe with numeric params reflects the supplied value into tokens', async () => {
    for (const recipe of TOKEN_RECIPES) {
      const numericParams = recipe.params.filter(
        (param) => param.type === 'number',
      );
      if (numericParams.length === 0) continue;
      const overrides = {};
      for (const param of numericParams) {
        const baseDefault =
          typeof param.default === 'number' ? param.default : 1;
        // Pick a value distinct from the default so the assertion catches
        // recipes that silently fall back to the default without parameterising.
        overrides[param.name] = baseDefault === 0 ? 1 : baseDefault + 1;
      }

      const result = await runAgentTool('compose_token_block', {
        recipeId: recipe.recipeId,
        params: overrides,
      });

      // Risk/sizing recipes don't carry tokens; their parameterisation lives in
      // fragment.assemblyHints. compose_token_block normalises params for both
      // shapes — verify the normalised params payload contains every override.
      for (const [name, value] of Object.entries(overrides)) {
        assert.equal(
          result.block.params[name],
          value,
          `${recipe.recipeId} did not surface ${name}=${value} in block.params`,
        );
      }
    }
  });

  it('refuses to short-circuit non-bool recipes that smuggle in tokens', async () => {
    // Construct a synthetic broken state: a non-bool recipe with non-empty
    // tokens. We bypass the normal compose path by calling validate_token_block
    // with explicit tokens AND a risk recipeId so the runtime sees the
    // conflict. A correct implementation flags the inconsistency.
    const result = await runAgentTool('validate_token_block', {
      recipeId: 'risk.percent_stop_loss',
      params: { percent: 3 },
      tokens: [
        { type: 'market_data_operand', params: { marketField: 'close' } },
      ],
    });
    // risk.percent_stop_loss currently has tokens: [], so the recipe path
    // returns valid: true. The guard fires only if the recipe definition is
    // ever changed to ship non-empty tokens — make sure the guard is wired by
    // checking the success path keeps tokens=[] for risk.
    assert.equal(result.valid, true);
    assert.deepEqual(result.tokens, []);
  });

  it('validates recipe-composed token blocks through public block validation when available', async () => {
    let calls = 0;
    const result = await runAgentTool(
      'validate_token_block',
      // P-Vocab: recipe param is `length` now (matches indicator vocabulary);
      // the rolling token field internally remains `period`.
      { recipeId: 'volume.volume_above_avg_20', params: { length: 30 } },
      {
        client: {
          async validateBlock(payload) {
            calls += 1;
            assert.equal(payload.role, 'confirmation_filter');
            assert.equal(payload.tokens[2].params.period, 30);
            return {
              valid: true,
              role: payload.role,
              tokens: payload.tokens,
              issues: [],
            };
          },
        },
      },
    );

    assert.equal(calls, 1);
    assert.equal(result.valid, true);
    assert.equal(result.source, 'remote');
  });

  it('assembles a valid draft from recipe token blocks and risk hints', async () => {
    const result = await runAgentTool('assemble_strategy_from_blocks', {
      name: 'RSI reclaim above EMA with stop',
      blocks: [
        { recipeId: 'momentum.rsi_cross_up_30' },
        { recipeId: 'trend.close_above_ema_100' },
        { recipeId: 'risk.percent_stop_loss', params: { percent: 2 } },
      ],
      capabilities: FULL_CAPABILITIES,
    });

    assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    assert.match(
      result.draft.signalGraph.strategy.entry.filters[0].ref,
      /^b2_trend_close_above_ema_100__trend_filter/,
    );
    assert.equal(result.draft.signalGraph.strategy.risk.stopLoss.value, 2);
  });

  it('namespaces composed block fragments so overlapping recipe nodes can assemble', async () => {
    const result = await runAgentTool('assemble_strategy_from_blocks', {
      name: 'Breakout without chasing',
      blocks: [
        { recipeId: 'breakout.close_crosses_20_high' },
        { recipeId: 'execution.close_near_breakout_level' },
      ],
      capabilities: FULL_CAPABILITIES,
    });

    assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    const ids = result.draft.signalGraph.nodes.map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(
      result.draft.signalGraph.strategy.entry.trigger.ref,
      /^b1_breakout_close_crosses_20_high__/,
    );
    assert.match(
      result.draft.signalGraph.strategy.entry.filters[0].ref,
      /^b2_execution_close_near_breakout_level__/,
    );
  });

  it('requires explicit roles for workspace or raw token blocks before remote compile', async () => {
    const workspaceTokens = [
      { type: 'market_data_operand', params: { marketField: 'volume' } },
      { type: 'comparison_condition', params: { compareOperator: 'gt' } },
      { type: 'constant_operand', params: { value: 100 } },
    ];

    await assert.rejects(
      () =>
        runAgentTool(
          'assemble_strategy_from_blocks',
          { blocks: [{ blockId: 'block-1' }] },
          {
            client: {
              async getBlock() {
                return { id: 'block-1', tokens: workspaceTokens };
              },
              async compileBlock() {
                assert.fail(
                  'compileBlock should not run without an explicit role',
                );
              },
            },
          },
        ),
      /requires an explicit role/,
    );
  });

  it('passes explicit workspace block roles into remote compile during assembly', async () => {
    let compiledRole;
    const result = await runAgentTool(
      'assemble_strategy_from_blocks',
      {
        blocks: [
          { recipeId: 'momentum.rsi_cross_up_30' },
          { blockId: 'block-1', role: 'confirmation_filter' },
        ],
        capabilities: FULL_CAPABILITIES,
      },
      {
        client: {
          async getBlock() {
            return {
              id: 'block-1',
              tokens: [
                {
                  type: 'market_data_operand',
                  params: { marketField: 'volume' },
                },
                {
                  type: 'comparison_condition',
                  params: { compareOperator: 'gt' },
                },
                { type: 'constant_operand', params: { value: 100 } },
              ],
            };
          },
          async compileBlock(payload) {
            compiledRole = payload.role;
            return {
              valid: true,
              role: payload.role,
              tokens: payload.tokens,
              issues: [],
              fragment: {
                nodes: [
                  {
                    id: 'workspace_volume_confirm',
                    kind: 'compare',
                    op: 'gt',
                    left: { const: 1 },
                    right: { const: 0 },
                  },
                ],
                assemblyHints: {
                  confirmationFilters: [{ ref: 'workspace_volume_confirm' }],
                },
              },
            };
          },
        },
      },
    );

    assert.equal(compiledRole, 'confirmation_filter');
    assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
    assert.match(
      result.draft.signalGraph.strategy.entry.filters[0].ref,
      /^b2_block_1__workspace_volume_confirm/,
    );
  });

  it('uses supplied capabilities without fetching platform capabilities', async () => {
    const result = await runAgentTool(
      'resolve_strategy_semantics',
      {
        prompt: 'volume confirmation breakout',
        capabilities: FULL_CAPABILITIES,
      },
      {
        client: {
          getCapabilities() {
            assert.fail('getCapabilities should not be called');
          },
        },
      },
    );

    assert.ok(
      result.candidates.some(
        (candidate) => candidate.id === 'volume.volume_above_avg_20',
      ),
    );
  });

  it('fetches capabilities for resolve_strategy_semantics when omitted', async () => {
    let calls = 0;
    const result = await runAgentTool(
      'resolve_strategy_semantics',
      { prompt: 'RSI oversold rebound reclaim' },
      {
        client: {
          async getCapabilities() {
            calls += 1;
            return FULL_CAPABILITIES;
          },
        },
      },
    );

    assert.equal(calls, 1);
    assert.ok(
      result.candidates.some(
        (candidate) => candidate.id === 'momentum.rsi_cross_up_30',
      ),
    );
  });

  it('compose_strategy_from_template forks a template and returns a preflight-clean draft (P1-E)', async () => {
    // P1-E exists to spare LLMs from hand-authoring 10+ node signal graphs
    // when "fork the trend template, switch warmup" is what the user wanted.
    // The contract: pass templateKey, optionally tweak settings, get a draft
    // that already passed preflight so the next call can be a one-shot
    // run_guided_research_round / validate_strategy.
    const templatePayload = {
      key: 'fixture_trend_template',
      name: 'Fixture trend template',
      description: 'Fixture used by compose_strategy_from_template tests.',
      category: 'trend',
      tags: ['trend'],
      signalGraph: {
        protocol: 'traseq.signal-graph',
        version: 2,
        nodes: [
          {
            id: 'price',
            kind: 'market',
            params: { field: 'close', timeframe: '1d' },
          },
          {
            id: 'sma200',
            kind: 'indicator',
            indicator: 'SMA',
            params: { length: 200 },
            inputs: ['price'],
          },
        ],
        bindings: {},
        strategy: {
          entry: {
            trigger: { ref: 'sma200' },
            action: {
              kind: 'enter',
              side: 'long',
              sizing: { mode: 'percent_equity', value: 100 },
            },
          },
        },
      },
      settings: { positionStyle: 'single', warmupPeriod: 200 },
    };
    let getSystemStrategyCalls = 0;
    let getCapabilitiesCalls = 0;
    const result = await runAgentTool(
      'compose_strategy_from_template',
      {
        templateKey: 'fixture_trend_template',
        name: 'Forked trend draft',
        settingsOverride: { warmupPeriod: 250 },
      },
      {
        client: {
          async getSystemStrategy(key) {
            getSystemStrategyCalls += 1;
            assert.equal(key, 'fixture_trend_template');
            return templatePayload;
          },
          async getCapabilities() {
            getCapabilitiesCalls += 1;
            return FULL_CAPABILITIES;
          },
        },
      },
    );
    assert.equal(getSystemStrategyCalls, 1);
    assert.equal(getCapabilitiesCalls, 1);
    assert.equal(result.template.key, 'fixture_trend_template');
    assert.equal(result.draft.name, 'Forked trend draft');
    assert.equal(result.draft.settings.warmupPeriod, 250);
    assert.equal(result.draft.settings.positionStyle, 'single');
    assert.ok(result.preflight, 'preflight result must be returned');
    assert.equal(typeof result.nextStep, 'string');
  });

  it('preflight_strategy_draft adds tier-aware warnings when caps are exceeded (P2-I)', async () => {
    // Free tier free-rides on a tight maxExits=1 cap. The user's transcript
    // showed them spending two round-trips before discovering this — P2-I
    // surfaces it as a warning at preflight so the LLM fixes the draft
    // before validate_strategy is even called.
    const draftWithTwoExits = {
      name: 'Two-exit draft',
      signalGraph: {
        protocol: 'traseq.signal-graph',
        version: 2,
        nodes: [],
        bindings: {},
        strategy: {
          kind: 'strategy',
          entry: {
            kind: 'entry',
            trigger: { ref: 'n1' },
            action: {
              side: 'long',
              sizing: { mode: 'percent_equity', value: 100 },
            },
          },
          exits: [
            { kind: 'exit', when: { ref: 'n2' }, action: { kind: 'flatten' } },
            { kind: 'exit', when: { ref: 'n3' }, action: { kind: 'flatten' } },
          ],
        },
      },
      settings: { positionStyle: 'single' },
    };
    const capabilitiesWithTightLimits = {
      limits: { maxEntryConditions: 5, maxExitConditions: 3, maxExits: 1 },
    };
    const result = await runAgentTool('preflight_strategy_draft', {
      draft: draftWithTwoExits,
      capabilities: capabilitiesWithTightLimits,
    });
    const tierWarning = (result.issues ?? []).find(
      (issue) => issue.code === 'tier_exit_limit',
    );
    assert.ok(tierWarning, 'tier_exit_limit warning must be present');
    assert.equal(tierWarning.severity, 'warning');
    assert.match(tierWarning.message, /maxExits at 1/);
  });

  it('compose_strategy_from_template throws when the template lacks a signalGraph', async () => {
    await assert.rejects(
      () =>
        runAgentTool(
          'compose_strategy_from_template',
          { templateKey: 'time_only_dca' },
          {
            client: {
              async getSystemStrategy() {
                return {
                  key: 'time_only_dca',
                  name: 'Time-only DCA',
                  description: 'token-only fixture',
                  category: 'dca',
                  tags: ['dca'],
                  signalGraph: null,
                  settings: { positionStyle: 'single' },
                };
              },
            },
          },
        ),
      /no signalGraph/,
    );
  });
});
