import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyDraft } from '@traseq/sdk';
import {
  AGENT_TOOL_REGISTRY,
  SEMANTIC_FACETS,
  SEMANTIC_IMPLEMENTATIONS,
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
  ],
  operators: {
    compare: ['gt', 'lt'],
    cross: ['cross_up'],
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
    const result = resolve('突破前高但不要追太遠');
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
    const result = resolve('RSI 超賣反彈');
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

  it('resolves volume breakout into trigger and confirmation candidates', () => {
    const result = resolve('放量突破');
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
    const result = resolve('先壓縮再突破');
    const ids = candidateIds(result);

    assert.ok(ids.includes('stateful.compression_then_breakout'));
    assert.equal(result.candidates[0].id, 'stateful.compression_then_breakout');
  });

  it('resolves holding-bars exit semantics', () => {
    const result = resolve('進場後 N 根沒動就出場');
    const ids = candidateIds(result);

    assert.ok(ids.includes('position.exit_after_10_bars'));
    assert.ok(result.candidates.some((candidate) => candidate.role === 'exit'));
  });

  it('filters unavailable candidates by live capabilities', () => {
    const result = resolveStrategySemantics({
      prompt: 'RSI 超賣反彈',
      capabilities: {
        ...FULL_CAPABILITIES,
        indicators: [{ id: 'ema' }],
      },
    });

    assert.equal(result.candidates.length, 0);

    const withUnavailable = resolveStrategySemantics({
      prompt: 'RSI 超賣反彈',
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

  it('ranks simple capability-supported candidates above risky candidates', () => {
    const result = resolve('爆量 放量');
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
  it('registers the expected local tools', () => {
    const names = AGENT_TOOL_REGISTRY.map((tool) => tool.name).sort();
    assert.ok(names.includes('get_semantics'));
    assert.ok(names.includes('resolve_strategy_semantics'));
    assert.ok(names.includes('run_research_draft'));
    assert.ok(names.includes('evaluate_research_result'));
    assert.ok(names.includes('format_research_report'));
  });

  it('runs get_semantics without a platform client', async () => {
    const result = await runAgentTool('get_semantics', {
      family: 'volume',
    });

    assert.ok(result.facets.every((facet) => facet.family === 'volume'));
  });

  it('uses supplied capabilities without fetching platform capabilities', async () => {
    const result = await runAgentTool(
      'resolve_strategy_semantics',
      {
        prompt: '放量突破',
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
      { prompt: 'RSI 超賣反彈' },
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
