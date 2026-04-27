import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStrategyDraft } from '@traseq/sdk';
import {
  getAgentContext,
  OPERATION_REGISTRY,
  AGENT_TOOL_REGISTRY,
  SKILL_CONTENT,
  references,
  runPlatformTool,
  templates,
  tools,
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(__dirname, '..');

describe('package metadata', () => {
  it('ships the README declared in package files', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf8'),
    );
    const readmePath = resolve(PACKAGE_DIR, 'README.md');

    assert.ok(packageJson.files.includes('README.md'));
    assert.ok(existsSync(readmePath), 'README.md is missing');

    const readme = readFileSync(readmePath, 'utf8');
    assert.ok(readme.includes('## MCP'));
    assert.ok(readme.includes('## API Key Scopes'));
    assert.ok(readme.includes('confirm: true'));
  });
});

describe('getAgentContext', () => {
  it('returns non-empty string with all sections', () => {
    const context = getAgentContext();
    assert.ok(typeof context === 'string');
    assert.ok(context.length > 0);
  });

  it('contains all four sections', () => {
    const context = getAgentContext();
    assert.ok(
      context.includes('# Traseq Strategy Agent'),
      'missing skill section',
    );
    assert.ok(context.includes('# Traseq API Tools'), 'missing tools section');
    assert.ok(
      context.includes('# Domain Constants Reference'),
      'missing references section',
    );
    assert.ok(
      context.includes('# Strategy Templates'),
      'missing templates section',
    );
  });

  it('supports section filtering', () => {
    const skillOnly = getAgentContext({ sections: ['skill'] });
    assert.ok(skillOnly.includes('# Traseq Strategy Agent'));
    assert.ok(!skillOnly.includes('# Traseq API Tools'));

    const toolsOnly = getAgentContext({ sections: ['tools'] });
    assert.ok(toolsOnly.includes('# Traseq API Tools'));
    assert.ok(!toolsOnly.includes('# Traseq Strategy Agent'));
  });

  it('respects section order', () => {
    const context = getAgentContext({ sections: ['templates', 'skill'] });
    const templatesIdx = context.indexOf('# Strategy Templates');
    const skillIdx = context.indexOf('# Traseq Strategy Agent');
    assert.ok(templatesIdx < skillIdx, 'templates should come before skill');
  });
});

describe('SKILL_CONTENT', () => {
  it('exports a non-empty string', () => {
    assert.ok(typeof SKILL_CONTENT === 'string');
    assert.ok(SKILL_CONTENT.length > 100);
  });

  it('contains all workflow phases', () => {
    assert.ok(SKILL_CONTENT.includes('Phase 1: Discovery'));
    assert.ok(SKILL_CONTENT.includes('Phase 2: Strategy Composition'));
    assert.ok(SKILL_CONTENT.includes('Phase 3: Validation and Repair'));
    assert.ok(SKILL_CONTENT.includes('Phase 4: Create and Backtest'));
    assert.ok(SKILL_CONTENT.includes('Phase 5: Results Analysis'));
    assert.ok(SKILL_CONTENT.includes('Phase 6: Iteration'));
    assert.ok(SKILL_CONTENT.includes('resolve_strategy_semantics'));
  });
});

describe('references', () => {
  it('has all reference modules', () => {
    assert.ok(typeof references.domainConstants === 'string');
    assert.ok(typeof references.nodeKinds === 'string');
    assert.ok(typeof references.strategyComposition === 'string');
    assert.ok(typeof references.indicatorGuide === 'string');
    assert.ok(typeof references.backtestConfiguration === 'string');
    assert.ok(typeof references.resultsInterpretation === 'string');
    assert.ok(typeof references.iterationPlaybook === 'string');
  });

  it('asMarkdown() joins all references', () => {
    const md = references.asMarkdown();
    assert.ok(md.includes('# Domain Constants Reference'));
    assert.ok(md.includes('# SignalGraph Node Kinds Reference'));
    assert.ok(md.includes('# Strategy Composition Patterns'));
    assert.ok(md.includes('# Indicator Guide'));
    assert.ok(md.includes('# Backtest Configuration Reference'));
    assert.ok(md.includes('# Results Interpretation Reference'));
    assert.ok(md.includes('# Iteration Playbook'));
  });

  it('domain constants include expected enums', () => {
    const dc = references.domainConstants;
    assert.ok(dc.includes('open'), 'missing market field: open');
    assert.ok(dc.includes('close'), 'missing market field: close');
    assert.ok(dc.includes('volume'), 'missing market field: volume');
    assert.ok(dc.includes('position_exists'), 'missing state field');
    assert.ok(dc.includes('cross_up'), 'missing cross op');
    assert.ok(dc.includes('percent_equity'), 'missing sizing mode');
    assert.ok(dc.includes('doji'), 'missing pattern');
  });
});

describe('templates', () => {
  it('has 5 templates', () => {
    assert.equal(templates.all.length, 5);
  });

  it('each template has required fields', () => {
    for (const t of templates.all) {
      assert.ok(typeof t.id === 'string', `${t.id} missing id`);
      assert.ok(typeof t.name === 'string', `${t.id} missing name`);
      assert.ok(
        typeof t.description === 'string',
        `${t.id} missing description`,
      );
      assert.ok(typeof t.thesis === 'string', `${t.id} missing thesis`);
      assert.ok(
        Array.isArray(t.adaptationHints),
        `${t.id} missing adaptationHints`,
      );
      assert.ok(
        t.adaptationHints.length > 0,
        `${t.id} has empty adaptationHints`,
      );
    }
  });

  it('each template draft has valid structure', () => {
    for (const t of templates.all) {
      const d = t.draft;
      assert.ok(typeof d.name === 'string', `${t.id} draft missing name`);
      assert.equal(
        d.signalGraph.protocol,
        'traseq.signal-graph',
        `${t.id} wrong protocol`,
      );
      assert.equal(d.signalGraph.version, 2, `${t.id} wrong version`);
      assert.ok(Array.isArray(d.signalGraph.nodes), `${t.id} nodes not array`);
      assert.ok(d.signalGraph.nodes.length > 0, `${t.id} no nodes`);
      assert.ok(
        d.signalGraph.strategy.kind === 'strategy',
        `${t.id} missing strategy.kind`,
      );
      assert.ok(
        ['single', 'pyramid', 'accumulate'].includes(d.settings.positionStyle),
        `${t.id} invalid positionStyle`,
      );
      if (d.settings.positionStyle === 'pyramid') {
        assert.ok(
          d.settings.maxConcurrentPositions >= 1,
          `${t.id} invalid maxConcurrentPositions`,
        );
      }
      assert.ok(d.settings.warmupPeriod >= 0, `${t.id} invalid warmupPeriod`);
      assert.ok(
        typeof d.backtest.timeframe === 'string',
        `${t.id} missing timeframe`,
      );
      assert.ok(
        typeof d.backtest.signalInstrument.symbol === 'string',
        `${t.id} missing symbol`,
      );
    }
  });

  it('each template draft passes the SDK authoring schema', () => {
    for (const t of templates.all) {
      const result = validateStrategyDraft(t.draft);
      if (!result.ok) {
        assert.fail(
          `${t.id} schema issues: ${result.issues
            .slice(0, 6)
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(' | ')}`,
        );
      }
    }
  });

  it('byId returns correct template', () => {
    const tf = templates.byId('trend-following');
    assert.ok(tf !== undefined);
    assert.equal(tf.id, 'trend-following');

    const missing = templates.byId('nonexistent');
    assert.equal(missing, undefined);
  });

  it('asMarkdown() includes all templates', () => {
    const md = templates.asMarkdown();
    for (const t of templates.all) {
      assert.ok(md.includes(t.name), `markdown missing template: ${t.name}`);
    }
  });
});

describe('tools', () => {
  it('has tool definitions', () => {
    const defs = tools.definitions();
    assert.ok(Array.isArray(defs));
    assert.ok(defs.length >= 7);
  });

  it('has local agent tool definitions', () => {
    const defs = tools.agentDefinitions();
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('get_semantics'));
    assert.ok(names.includes('resolve_strategy_semantics'));
  });

  it('includes expected tools', () => {
    const defs = tools.definitions();
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('get_manifest'));
    assert.ok(names.includes('get_capabilities'));
    assert.ok(names.includes('validate_strategy'));
    assert.ok(names.includes('run_backtest'));
    assert.ok(names.includes('get_backtest'));
  });

  it('asMarkdown() includes workflow order', () => {
    const md = tools.asMarkdown();
    assert.ok(md.includes('## Workflow Order'));
    assert.ok(md.includes('## Agent-Local Tools'));
    assert.ok(md.includes('resolve_strategy_semantics'));
    assert.ok(md.includes('## Platform Tools'));
    assert.ok(md.includes('get_manifest'));
    assert.ok(md.includes('run_backtest'));
  });

  it('covers every public OpenAPI endpoint in the operation registry', () => {
    const spec = JSON.parse(
      readFileSync(
        resolve(
          PACKAGE_DIR,
          '..',
          '..',
          'docs/public-docs/openapi/traseq-public-agent.json',
        ),
        'utf8',
      ),
    );
    const registryEndpoints = new Set(
      OPERATION_REGISTRY.map(
        (operation) =>
          `${operation.endpoint.method} ${operation.endpoint.path.replace(/\{[^}]+\}/g, ':param')}`,
      ),
    );
    const uncovered = [];

    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith('/public/v1')) continue;

      for (const method of Object.keys(methods)) {
        if (method === 'parameters') continue;

        const key = `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, ':param')}`;
        if (!registryEndpoints.has(key)) {
          uncovered.push(key);
        }
      }
    }

    assert.deepEqual(uncovered, []);
  });

  it('keeps local agent tools out of the platform operation registry', () => {
    const platformNames = new Set(OPERATION_REGISTRY.map((tool) => tool.name));
    for (const tool of AGENT_TOOL_REGISTRY) {
      assert.equal(platformNames.has(tool.name), false);
    }
  });
});

describe('platform tool safety', () => {
  it('requires confirm=true in every destructive tool schema', () => {
    const destructiveTools = OPERATION_REGISTRY.filter(
      (tool) => tool.destructive,
    );
    assert.ok(destructiveTools.length > 0, 'no destructive tools found');

    for (const tool of destructiveTools) {
      const properties = tool.input_schema.properties ?? {};
      const required = tool.input_schema.required ?? [];
      assert.equal(
        properties.confirm?.type,
        'boolean',
        `${tool.name} missing confirm boolean`,
      );
      assert.ok(
        required.includes('confirm'),
        `${tool.name} does not require confirm`,
      );
    }
  });

  it('blocks destructive tools locally before hitting the API', async () => {
    for (const tool of OPERATION_REGISTRY.filter(
      (operation) => operation.destructive,
    )) {
      await assert.rejects(
        () => runPlatformTool({}, tool.name, {}),
        /requires confirm: true/,
        `${tool.name} did not reject without confirm`,
      );
    }
  });
});

const ID = '00000000-0000-4000-8000-000000000001';
const STRATEGY_PAYLOAD = {
  signalGraph: {
    protocol: 'traseq.signal-graph',
    version: 2,
    nodes: [],
    strategy: { kind: 'strategy' },
  },
  settings: { positionStyle: 'single', warmupPeriod: 200 },
};

const TOOL_INPUTS = {
  get_manifest: {},
  get_health: {},
  get_workspace_context: {},
  get_usage: {},
  get_capabilities: {},
  list_system_strategies: {},
  get_system_strategy: { key: 'trend-following' },
  copy_system_strategy: { key: 'trend-following', name: 'Template copy' },
  validate_strategy: STRATEGY_PAYLOAD,
  list_strategies: {},
  create_strategy: { name: 'Agent strategy', ...STRATEGY_PAYLOAD },
  get_strategy: { strategyId: ID },
  update_strategy: { strategyId: ID, name: 'Renamed strategy' },
  create_strategy_version: { strategyId: ID, ...STRATEGY_PAYLOAD },
  get_strategy_version: { strategyId: ID, version: 1 },
  update_strategy_version: { strategyId: ID, version: 1, ...STRATEGY_PAYLOAD },
  finalize_strategy_version: { strategyId: ID, ...STRATEGY_PAYLOAD },
  delete_strategy_version: { strategyId: ID, version: 1, confirm: true },
  archive_strategy_version: { strategyId: ID, version: 1 },
  restore_strategy_version: { strategyId: ID, version: 1 },
  create_pine_export: { strategyId: ID, version: 1 },
  validate_conflicts: { blocks: [] },
  list_backtests: {},
  run_backtest: {
    strategyVersionId: ID,
    config: { timeframe: '4h', signalInstrument: { symbol: 'BTCUSDT' } },
  },
  get_backtest: { backtestId: ID },
  get_backtest_progress: { backtestId: ID },
  get_backtest_chart_data: { backtestId: ID },
  get_backtest_price_preview: { backtestId: ID },
  set_primary_backtest: { backtestId: ID },
  delete_backtest: { backtestId: ID, confirm: true },
  wait_backtest: { backtestId: ID, intervalMs: 1, timeoutMs: 10 },
  preview_robustness_analysis: { sourceBacktestId: ID },
  create_robustness_analysis: { sourceBacktestId: ID },
  list_analysis_runs: {},
  get_analysis_run: { analysisRunId: ID },
  update_analysis_run: { analysisRunId: ID, title: 'Review' },
  delete_analysis_run: { analysisRunId: ID, confirm: true },
  wait_analysis_run: { analysisRunId: ID, intervalMs: 1, timeoutMs: 10 },
  list_comparison_sets: {},
  get_comparison_set: { comparisonSetId: ID },
  create_comparison_set: { name: 'Comparison', backtestIds: [ID] },
  update_comparison_set: { comparisonSetId: ID, name: 'Updated comparison' },
  delete_comparison_set: { comparisonSetId: ID, confirm: true },
  list_blocks: {},
  get_block: { blockId: ID },
  create_block: { name: 'Reusable signal', tokens: [] },
  update_block: { blockId: ID, name: 'Updated block' },
  delete_block: { blockId: ID, confirm: true },
  pin_block: { blockId: ID },
  unpin_block: { blockId: ID },
};

const CLIENT_METHOD_BY_TOOL = {
  get_manifest: 'getManifest',
  get_health: 'getHealth',
  get_workspace_context: 'getWorkspaceContext',
  get_usage: 'getUsage',
  get_capabilities: 'getCapabilities',
  list_system_strategies: 'listSystemStrategies',
  get_system_strategy: 'getSystemStrategy',
  copy_system_strategy: 'copySystemStrategy',
  validate_strategy: 'validateStrategy',
  list_strategies: 'listStrategies',
  create_strategy: 'createStrategy',
  get_strategy: 'getStrategy',
  update_strategy: 'updateStrategy',
  create_strategy_version: 'createStrategyVersion',
  get_strategy_version: 'getStrategyVersion',
  update_strategy_version: 'updateStrategyVersion',
  finalize_strategy_version: 'finalizeStrategyVersion',
  delete_strategy_version: 'deleteStrategyVersion',
  archive_strategy_version: 'archiveStrategyVersion',
  restore_strategy_version: 'restoreStrategyVersion',
  create_pine_export: 'createPineExport',
  validate_conflicts: 'validateConflicts',
  list_backtests: 'listBacktests',
  run_backtest: 'runBacktest',
  get_backtest: 'getBacktest',
  get_backtest_progress: 'getBacktestProgress',
  get_backtest_chart_data: 'getBacktestChartData',
  get_backtest_price_preview: 'getBacktestPricePreview',
  set_primary_backtest: 'setPrimaryBacktest',
  delete_backtest: 'deleteBacktest',
  wait_backtest: 'waitForBacktestCompletion',
  preview_robustness_analysis: 'previewRobustnessAnalysis',
  create_robustness_analysis: 'createRobustnessAnalysis',
  list_analysis_runs: 'listAnalysisRuns',
  get_analysis_run: 'getAnalysisRun',
  update_analysis_run: 'updateAnalysisRun',
  delete_analysis_run: 'deleteAnalysisRun',
  wait_analysis_run: 'waitForAnalysisRun',
  list_comparison_sets: 'listComparisonSets',
  get_comparison_set: 'getComparisonSet',
  create_comparison_set: 'createComparisonSet',
  update_comparison_set: 'updateComparisonSet',
  delete_comparison_set: 'deleteComparisonSet',
  list_blocks: 'listBlocks',
  get_block: 'getBlock',
  create_block: 'createBlock',
  update_block: 'updateBlock',
  delete_block: 'deleteBlock',
  pin_block: 'pinBlock',
  unpin_block: 'unpinBlock',
};

describe('platform tool dispatch', () => {
  it('has dispatch coverage fixtures for every registered operation', () => {
    const registeredNames = OPERATION_REGISTRY.map((tool) => tool.name).sort();
    assert.deepEqual(Object.keys(TOOL_INPUTS).sort(), registeredNames);
    assert.deepEqual(
      Object.keys(CLIENT_METHOD_BY_TOOL).sort(),
      registeredNames,
    );
  });

  it('routes every registered operation to a TraseqClient method', async () => {
    for (const tool of OPERATION_REGISTRY) {
      const calls = [];
      const client = new Proxy(
        {},
        {
          get(_target, prop) {
            return (...args) => {
              calls.push({ method: String(prop), args });
              return { method: String(prop), args };
            };
          },
        },
      );

      const result = await runPlatformTool(
        client,
        tool.name,
        TOOL_INPUTS[tool.name],
      );
      assert.equal(calls.length, 1, `${tool.name} did not call the SDK client`);
      assert.equal(
        calls[0].method,
        CLIENT_METHOD_BY_TOOL[tool.name],
        `${tool.name} called the wrong SDK method`,
      );
      assert.equal(result.method, CLIENT_METHOD_BY_TOOL[tool.name]);
    }
  });
});
