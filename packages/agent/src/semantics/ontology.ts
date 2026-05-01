import type {
  SemanticFacetDefinition,
  SemanticImplementationDefinition,
  SemanticOntologyDocument,
  SemanticRole,
} from './types.js';

const families = [
  'trend',
  'momentum',
  'mean_reversion',
  'breakout',
  'compression_range',
  'volume',
  'volatility',
  'market_structure',
  'temporal',
  'stateful_setup',
  'position_account_state',
  'risk_exit',
  'sizing_execution',
] as const;

function facet(
  id: string,
  family: (typeof families)[number],
  role: SemanticRole,
  description: string,
  keywords: string[],
  implementationIds: string[],
  antiPatterns: string[] = [],
): SemanticFacetDefinition {
  return {
    id,
    family,
    role,
    description,
    keywords,
    rationale: `Facet "${id}" maps user intent to ${role} semantics.`,
    antiPatterns,
    implementationIds,
  };
}

function implementation(
  definition: SemanticImplementationDefinition,
): SemanticImplementationDefinition {
  return definition;
}

export const SEMANTIC_FACETS: readonly SemanticFacetDefinition[] = [
  facet(
    'trend.price_above_ma',
    'trend',
    'context_filter',
    'Price trades above a moving average to express bullish trend regime.',
    ['trend', 'uptrend', 'above ma', 'ema', 'sma', '趨勢', '多頭', '均線上方'],
    ['trend.close_above_ema_100'],
  ),
  facet(
    'trend.ma_alignment',
    'trend',
    'context_filter',
    'Fast moving average above slow moving average to express trend alignment.',
    ['ma alignment', 'fast above slow', 'golden cross', '均線排列', '黃金交叉'],
    ['trend.ema_fast_above_slow'],
  ),
  facet(
    'momentum.oscillator_reclaim',
    'momentum',
    'entry_trigger',
    'Momentum oscillator crosses back above a threshold.',
    [
      'reclaim',
      'rsi reclaim',
      'cross above',
      'momentum',
      '動能',
      '站回',
      '收復',
    ],
    ['momentum.rsi_cross_up_30'],
  ),
  facet(
    'momentum.macd_cross',
    'momentum',
    'entry_trigger',
    'MACD line crosses above signal line.',
    ['macd', 'signal line', 'momentum cross', '動能交叉'],
    ['momentum.macd_cross_signal'],
  ),
  facet(
    'mean_reversion.oversold_reversal',
    'mean_reversion',
    'entry_trigger',
    'Oversold oscillator recovers and signals mean-reversion entry.',
    [
      'oversold',
      'mean reversion',
      'rsi 30',
      'rebound',
      '超賣',
      '反彈',
      '均值回歸',
    ],
    ['momentum.rsi_cross_up_30'],
  ),
  facet(
    'mean_reversion.price_deviation_revert',
    'mean_reversion',
    'entry_trigger',
    'Price stretches below a mean and begins reverting.',
    ['deviation', 'revert to mean', 'pullback', '偏離', '回歸', '拉回'],
    ['mean_reversion.close_near_ema_after_pullback'],
  ),
  facet(
    'breakout.previous_range_high',
    'breakout',
    'entry_trigger',
    'Close breaks above a recent range high.',
    [
      'breakout',
      'range high',
      '20-bar high',
      'previous high',
      '突破',
      '前高',
      '區間高點',
    ],
    ['breakout.close_crosses_20_high'],
  ),
  facet(
    'breakout.pivot_breakout',
    'breakout',
    'entry_trigger',
    'Close breaks a confirmed pivot high.',
    [
      'pivot breakout',
      'swing high',
      'structure breakout',
      '結構突破',
      '轉折高點',
    ],
    ['breakout.close_crosses_pivot_high'],
  ),
  facet(
    'compression_range.low_range_before_breakout',
    'compression_range',
    'context_filter',
    'Range or volatility compresses before a breakout.',
    ['compression', 'squeeze', 'narrow range', '壓縮', '收斂', '窄幅'],
    ['compression.atr_below_average', 'stateful.compression_then_breakout'],
  ),
  facet(
    'volume.relative_volume_confirmation',
    'volume',
    'confirmation_filter',
    'Volume is higher than its recent average.',
    [
      'volume confirmation',
      'relative volume',
      'volume above average',
      '放量',
      '量能',
      '成交量確認',
    ],
    ['volume.volume_above_avg_20'],
  ),
  facet(
    'volume.volume_spike',
    'volume',
    'confirmation_filter',
    'Current volume spikes above recent maximum or baseline.',
    ['volume spike', 'unusual volume', '爆量', '異常量'],
    ['volume.volume_above_max_50'],
  ),
  facet(
    'volatility.regime_filter',
    'volatility',
    'context_filter',
    'ATR or volatility identifies tradable high/low-volatility regime.',
    ['volatility regime', 'atr filter', '波動', '波動過濾'],
    ['volatility.atr_above_avg_50'],
  ),
  facet(
    'volatility.expansion',
    'volatility',
    'confirmation_filter',
    'Volatility expands as a confirmation signal.',
    ['volatility expansion', 'atr rising', '波動擴張', 'atr上升'],
    ['volatility.atr_crosses_avg_20'],
  ),
  facet(
    'market_structure.pivot_event',
    'market_structure',
    'confirmation_filter',
    'A fresh pivot confirmation event marks market structure change.',
    ['pivot confirmed', 'swing confirmed', '結構確認', 'pivot確認'],
    ['structure.pivot_low_confirmed'],
  ),
  facet(
    'market_structure.higher_high',
    'market_structure',
    'confirmation_filter',
    'Recent pivot high exceeds the previous pivot high.',
    ['higher high', 'market structure', '更高高點', '高點抬高'],
    ['structure.last_pivot_high_above_previous'],
  ),
  facet(
    'temporal.session_filter',
    'temporal',
    'context_filter',
    'Restrict strategy evaluation to an execution session.',
    ['session', 'trading hours', 'time filter', '時段', '交易時間'],
    ['temporal.weekday_session'],
  ),
  facet(
    'temporal.weekday_filter',
    'temporal',
    'context_filter',
    'Restrict strategy evaluation to selected weekdays.',
    ['weekday', 'weekdays only', '星期', '週內'],
    ['temporal.weekday_session'],
  ),
  facet(
    'stateful_setup.setup_then_trigger',
    'stateful_setup',
    'entry_trigger',
    'A setup must occur before a later trigger.',
    ['setup then trigger', 'sequence', '先', '之後', '然後', '先壓縮再突破'],
    ['stateful.compression_then_breakout'],
  ),
  facet(
    'stateful_setup.armed_trigger',
    'stateful_setup',
    'entry_trigger',
    'A setup arms a later trigger for a limited number of bars.',
    ['armed', 'ttl', 'within bars', '等待觸發', '有效期'],
    ['stateful.pivot_event_arms_breakout'],
  ),
  facet(
    'position_account_state.holding_bars_exit',
    'position_account_state',
    'exit',
    'Exit if a position has been open for too many bars.',
    [
      'bars since entry',
      'time stop',
      'holding bars',
      '進場後',
      '幾根',
      '沒動',
      '出場',
    ],
    ['position.exit_after_10_bars'],
  ),
  facet(
    'position_account_state.pnl_exit',
    'position_account_state',
    'exit',
    'Exit or filter based on unrealized position PnL.',
    ['pnl', 'unrealized', 'drawdown', '浮盈', '浮虧', '損益'],
    ['position.exit_unrealized_loss'],
  ),
  facet(
    'risk_exit.stop_loss',
    'risk_exit',
    'risk',
    'Attach a fixed-percent stop loss.',
    ['stop loss', 'sl', 'risk', '停損', '風控'],
    ['risk.percent_stop_loss'],
  ),
  facet(
    'risk_exit.take_profit',
    'risk_exit',
    'risk',
    'Attach a fixed-percent take profit.',
    ['take profit', 'tp', 'target', '停利', '目標價'],
    ['risk.percent_take_profit'],
  ),
  facet(
    'risk_exit.trailing_stop',
    'risk_exit',
    'risk',
    'Attach a trailing stop after price moves favorably.',
    ['trailing', 'trail stop', '移動停損', '追蹤停損'],
    ['risk.trailing_stop'],
  ),
  facet(
    'sizing_execution.percent_equity',
    'sizing_execution',
    'risk',
    'Size entries as a percent of equity.',
    ['percent equity', 'position size', 'sizing', '倉位', '資金比例'],
    ['sizing.percent_equity_10'],
  ),
  facet(
    'sizing_execution.no_chase_distance',
    'sizing_execution',
    'confirmation_filter',
    'Avoid chasing entries too far away from the trigger level.',
    [
      'do not chase',
      'avoid chasing',
      'not too far',
      '不要追太遠',
      '避免追高',
      '距離',
    ],
    ['execution.close_near_breakout_level'],
  ),
];

export const SEMANTIC_IMPLEMENTATIONS: readonly SemanticImplementationDefinition[] =
  [
    implementation({
      id: 'trend.close_above_ema_100',
      semanticIds: ['trend.price_above_ma'],
      role: 'context_filter',
      description: 'Close is above EMA(100).',
      complexity: 'simple',
      curatedPriority: 90,
      requiredCapabilities: {
        nodeKinds: ['market', 'indicator', 'compare'],
        indicators: ['ema'],
        operators: ['gt'],
      },
      fragment: {
        nodes: [
          { id: 'close_price', kind: 'market', field: 'close' },
          {
            id: 'ema_100',
            kind: 'indicator',
            indicator: 'ema',
            args: { length: 100 },
          },
          {
            id: 'trend_filter',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'close_price' },
            right: { ref: 'ema_100' },
          },
        ],
        assemblyHints: { contextFilters: [{ ref: 'trend_filter' }] },
        settingsHints: { warmupPeriod: 200 },
      },
      tradeoffs: {
        strengths: [
          'Simple trend regime filter.',
          'Usually keeps trade count reasonable.',
        ],
        risks: ['Late in fast reversals.', 'Can miss early trend changes.'],
        assumptions: ['EMA(100) is a baseline trend proxy.'],
      },
      validationHints: ['Warmup should be at least 200 bars for EMA(100).'],
    }),
    implementation({
      id: 'trend.ema_fast_above_slow',
      semanticIds: ['trend.ma_alignment'],
      role: 'context_filter',
      description: 'EMA(20) is above EMA(50).',
      complexity: 'simple',
      curatedPriority: 84,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'compare'],
        indicators: ['ema'],
        operators: ['gt'],
      },
      fragment: {
        nodes: [
          {
            id: 'ema_fast',
            kind: 'indicator',
            indicator: 'ema',
            args: { length: 20 },
          },
          {
            id: 'ema_slow',
            kind: 'indicator',
            indicator: 'ema',
            args: { length: 50 },
          },
          {
            id: 'ma_alignment',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'ema_fast' },
            right: { ref: 'ema_slow' },
          },
        ],
        assemblyHints: { contextFilters: [{ ref: 'ma_alignment' }] },
        settingsHints: { warmupPeriod: 100 },
      },
      tradeoffs: {
        strengths: ['Captures trend alignment without price noise.'],
        risks: ['May lag after sharp reversals.'],
        assumptions: ['20/50 lengths are balanced defaults.'],
      },
      validationHints: [
        'Use as a filter when another node provides the trigger.',
      ],
    }),
    implementation({
      id: 'momentum.rsi_cross_up_30',
      semanticIds: [
        'momentum.oscillator_reclaim',
        'mean_reversion.oversold_reversal',
      ],
      role: 'entry_trigger',
      description: 'RSI(14) crosses up through 30.',
      complexity: 'simple',
      curatedPriority: 96,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'cross'],
        indicators: ['rsi'],
        operators: ['cross_up'],
      },
      fragment: {
        nodes: [
          {
            id: 'rsi_14',
            kind: 'indicator',
            indicator: 'rsi',
            args: { length: 14 },
          },
          {
            id: 'rsi_reclaim',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'rsi_14' },
            right: { const: 30 },
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'rsi_reclaim' } },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: [
          'Directly expresses oversold recovery.',
          'Simple and inspectable.',
        ],
        risks: [
          'Counter-trend entries can keep falling without a regime filter.',
        ],
        assumptions: ['RSI(14) and 30 are default oversold settings.'],
      },
      validationHints: [
        'Pair with a trend or structure filter when false rebounds are costly.',
      ],
    }),
    implementation({
      id: 'momentum.macd_cross_signal',
      semanticIds: ['momentum.macd_cross'],
      role: 'entry_trigger',
      description: 'MACD line crosses above signal line.',
      complexity: 'balanced',
      curatedPriority: 72,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'cross'],
        indicators: ['macd'],
        operators: ['cross_up'],
      },
      fragment: {
        nodes: [
          {
            id: 'macd_line',
            kind: 'indicator',
            indicator: 'macd',
            args: { fast_length: 12, slow_length: 26, signal_length: 9 },
            output: 'macd',
          },
          {
            id: 'macd_signal',
            kind: 'indicator',
            indicator: 'macd',
            args: { fast_length: 12, slow_length: 26, signal_length: 9 },
            output: 'signal',
          },
          {
            id: 'macd_bull_cross',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'macd_line' },
            right: { ref: 'macd_signal' },
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'macd_bull_cross' } },
        settingsHints: { warmupPeriod: 80 },
      },
      tradeoffs: {
        strengths: ['Captures momentum turn with a familiar indicator.'],
        risks: ['MACD can whipsaw in ranges.'],
        assumptions: ['Standard 12/26/9 MACD parameters.'],
      },
      validationHints: [
        'Check indicator output names against live capabilities if validation fails.',
      ],
    }),
    implementation({
      id: 'mean_reversion.close_near_ema_after_pullback',
      semanticIds: ['mean_reversion.price_deviation_revert'],
      role: 'entry_trigger',
      description: 'Close returns near EMA(20) after a pullback.',
      complexity: 'balanced',
      curatedPriority: 64,
      requiredCapabilities: {
        nodeKinds: ['market', 'indicator', 'near'],
        indicators: ['ema'],
      },
      fragment: {
        nodes: [
          { id: 'close_price', kind: 'market', field: 'close' },
          {
            id: 'ema_20',
            kind: 'indicator',
            indicator: 'ema',
            args: { length: 20 },
          },
          {
            id: 'close_near_mean',
            kind: 'near',
            left: { ref: 'close_price' },
            right: { ref: 'ema_20' },
            tolerance: { mode: 'percent', value: 0.5 },
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'close_near_mean' } },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: ['Expresses mean reversion without hardcoded price levels.'],
        risks: [
          'Needs an additional oversold or trend context to avoid weak signals.',
        ],
        assumptions: [
          'EMA(20) is the local mean and 0.5% is a default proximity.',
        ],
      },
      validationHints: [
        'Consider using this as a confirmation rather than the only trigger.',
      ],
    }),
    implementation({
      id: 'breakout.close_crosses_20_high',
      semanticIds: ['breakout.previous_range_high'],
      role: 'entry_trigger',
      description: 'Close crosses above the rolling 20-bar high.',
      complexity: 'simple',
      curatedPriority: 98,
      requiredCapabilities: {
        nodeKinds: ['market', 'rolling', 'cross'],
        operators: ['max', 'cross_up'],
      },
      fragment: {
        nodes: [
          { id: 'close_price', kind: 'market', field: 'close' },
          { id: 'high_price', kind: 'market', field: 'high' },
          {
            id: 'range_high_20',
            kind: 'rolling',
            op: 'max',
            source: { ref: 'high_price' },
            period: 20,
            offset: 1,
          },
          {
            id: 'breakout_trigger',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'close_price' },
            right: { ref: 'range_high_20' },
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'breakout_trigger' } },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: [
          'Direct expression of recent-range breakout.',
          'No special indicator required.',
        ],
        risks: ['Can fire on false breakouts without confirmation.'],
        assumptions: ['20 bars approximates the recent range.'],
      },
      validationHints: [
        'Pair with volume or trend confirmation when the user wants fewer false breakouts.',
      ],
    }),
    implementation({
      id: 'breakout.close_crosses_pivot_high',
      semanticIds: ['breakout.pivot_breakout'],
      role: 'entry_trigger',
      description: 'Close crosses above the last confirmed pivot high.',
      complexity: 'balanced',
      curatedPriority: 78,
      requiredCapabilities: {
        nodeKinds: ['market', 'pivot', 'cross'],
        operators: ['cross_up'],
      },
      fragment: {
        nodes: [
          { id: 'close_price', kind: 'market', field: 'close' },
          {
            id: 'last_pivot_high',
            kind: 'pivot',
            pivotKind: 'high',
            left: 5,
            right: 5,
            select: 'last',
          },
          {
            id: 'pivot_breakout',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'close_price' },
            right: { ref: 'last_pivot_high' },
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'pivot_breakout' } },
        settingsHints: { warmupPeriod: 60 },
      },
      tradeoffs: {
        strengths: ['More structure-aware than a plain rolling high.'],
        risks: ['Pivot confirmation introduces delay.'],
        assumptions: ['5-left/5-right pivot confirmation.'],
      },
      validationHints: ['Explain pivot confirmation delay to the user.'],
    }),
    implementation({
      id: 'compression.atr_below_average',
      semanticIds: ['compression_range.low_range_before_breakout'],
      role: 'context_filter',
      description: 'ATR(14) is below its 50-bar average.',
      complexity: 'balanced',
      curatedPriority: 74,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'rolling', 'compare'],
        indicators: ['atr'],
        operators: ['avg', 'lt'],
      },
      fragment: {
        nodes: [
          {
            id: 'atr_14',
            kind: 'indicator',
            indicator: 'atr',
            args: { length: 14 },
          },
          {
            id: 'atr_avg_50',
            kind: 'rolling',
            op: 'avg',
            source: { ref: 'atr_14' },
            period: 50,
          },
          {
            id: 'volatility_compressed',
            kind: 'compare',
            op: 'lt',
            left: { ref: 'atr_14' },
            right: { ref: 'atr_avg_50' },
          },
        ],
        assemblyHints: { contextFilters: [{ ref: 'volatility_compressed' }] },
        settingsHints: { warmupPeriod: 100 },
      },
      tradeoffs: {
        strengths: [
          'Captures compressed volatility before expansion attempts.',
        ],
        risks: ['May over-filter on already quiet markets.'],
        assumptions: ['ATR below its average is the compression proxy.'],
      },
      validationHints: [
        'Combine with a breakout trigger through all/sequence logic.',
      ],
    }),
    implementation({
      id: 'volume.volume_above_avg_20',
      semanticIds: ['volume.relative_volume_confirmation'],
      role: 'confirmation_filter',
      description: 'Current volume is above its 20-bar average.',
      complexity: 'simple',
      curatedPriority: 92,
      requiredCapabilities: {
        nodeKinds: ['market', 'rolling', 'compare'],
        operators: ['avg', 'gt'],
      },
      fragment: {
        nodes: [
          { id: 'volume_now', kind: 'market', field: 'volume' },
          {
            id: 'volume_avg_20',
            kind: 'rolling',
            op: 'avg',
            source: { ref: 'volume_now' },
            period: 20,
          },
          {
            id: 'volume_confirmation',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'volume_now' },
            right: { ref: 'volume_avg_20' },
          },
        ],
        assemblyHints: {
          confirmationFilters: [{ ref: 'volume_confirmation' }],
        },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: [
          'Simple relative volume confirmation.',
          'Avoids hardcoded absolute volume.',
        ],
        risks: ['Volume confirmation can arrive late on breakout candles.'],
        assumptions: ['20-bar average is the relative volume baseline.'],
      },
      validationHints: ['Use as an AND filter with a price trigger.'],
    }),
    implementation({
      id: 'volume.volume_above_max_50',
      semanticIds: ['volume.volume_spike'],
      role: 'confirmation_filter',
      description: 'Current volume exceeds recent maximum volume.',
      complexity: 'balanced',
      curatedPriority: 66,
      risky: true,
      requiredCapabilities: {
        nodeKinds: ['market', 'rolling', 'compare'],
        operators: ['max', 'gt'],
      },
      fragment: {
        nodes: [
          { id: 'volume_now', kind: 'market', field: 'volume' },
          {
            id: 'volume_max_50',
            kind: 'rolling',
            op: 'max',
            source: { ref: 'volume_now' },
            period: 50,
            offset: 1,
          },
          {
            id: 'volume_spike',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'volume_now' },
            right: { ref: 'volume_max_50' },
          },
        ],
        assemblyHints: { confirmationFilters: [{ ref: 'volume_spike' }] },
        settingsHints: { warmupPeriod: 100 },
      },
      tradeoffs: {
        strengths: ['Finds exceptional volume events.'],
        risks: ['Very strict and can create zero-trade strategies.'],
        assumptions: ['A new 50-bar volume high is meaningful.'],
      },
      validationHints: [
        'Prefer relative volume first unless the user explicitly asks for spike-only signals.',
      ],
    }),
    implementation({
      id: 'volatility.atr_above_avg_50',
      semanticIds: ['volatility.regime_filter'],
      role: 'context_filter',
      description: 'ATR(14) is above its 50-bar average.',
      complexity: 'balanced',
      curatedPriority: 70,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'rolling', 'compare'],
        indicators: ['atr'],
        operators: ['avg', 'gt'],
      },
      fragment: {
        nodes: [
          {
            id: 'atr_14',
            kind: 'indicator',
            indicator: 'atr',
            args: { length: 14 },
          },
          {
            id: 'atr_avg_50',
            kind: 'rolling',
            op: 'avg',
            source: { ref: 'atr_14' },
            period: 50,
          },
          {
            id: 'high_vol_regime',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'atr_14' },
            right: { ref: 'atr_avg_50' },
          },
        ],
        assemblyHints: { contextFilters: [{ ref: 'high_vol_regime' }] },
        settingsHints: { warmupPeriod: 100 },
      },
      tradeoffs: {
        strengths: ['Separates higher-volatility regimes.'],
        risks: [
          'Can bias toward late entries after volatility has already expanded.',
        ],
        assumptions: [
          'ATR(14) relative to 50-bar average is the regime proxy.',
        ],
      },
      validationHints: [
        'Use with breakout or trailing-stop logic when volatility is part of the thesis.',
      ],
    }),
    implementation({
      id: 'volatility.atr_crosses_avg_20',
      semanticIds: ['volatility.expansion'],
      role: 'confirmation_filter',
      description: 'ATR crosses above its 20-bar average.',
      complexity: 'balanced',
      curatedPriority: 65,
      requiredCapabilities: {
        nodeKinds: ['indicator', 'rolling', 'cross'],
        indicators: ['atr'],
        operators: ['avg', 'cross_up'],
      },
      fragment: {
        nodes: [
          {
            id: 'atr_14',
            kind: 'indicator',
            indicator: 'atr',
            args: { length: 14 },
          },
          {
            id: 'atr_avg_20',
            kind: 'rolling',
            op: 'avg',
            source: { ref: 'atr_14' },
            period: 20,
          },
          {
            id: 'volatility_expansion',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'atr_14' },
            right: { ref: 'atr_avg_20' },
          },
        ],
        assemblyHints: {
          confirmationFilters: [{ ref: 'volatility_expansion' }],
        },
        settingsHints: { warmupPeriod: 60 },
      },
      tradeoffs: {
        strengths: ['Captures fresh volatility expansion.'],
        risks: ['Expansion can happen after the best entry point.'],
        assumptions: ['ATR expansion confirms participation.'],
      },
      validationHints: [
        'Avoid stacking this with too many filters in the first draft.',
      ],
    }),
    implementation({
      id: 'structure.pivot_low_confirmed',
      semanticIds: ['market_structure.pivot_event'],
      role: 'confirmation_filter',
      description: 'A new pivot low is confirmed.',
      complexity: 'balanced',
      curatedPriority: 58,
      requiredCapabilities: {
        nodeKinds: ['event'],
      },
      fragment: {
        nodes: [
          {
            id: 'new_swing_low',
            kind: 'event',
            name: 'pivot_confirmed',
            args: { pivotKind: 'low', left: 5, right: 5 },
          },
        ],
        assemblyHints: { confirmationFilters: [{ ref: 'new_swing_low' }] },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: ['Represents discrete market-structure confirmation.'],
        risks: ['Pivot confirmation is delayed by right bars.'],
        assumptions: [
          'Swing low confirmation is useful for bullish reversal context.',
        ],
      },
      validationHints: [
        'Explain confirmation delay when presenting strategy semantics.',
      ],
    }),
    implementation({
      id: 'structure.last_pivot_high_above_previous',
      semanticIds: ['market_structure.higher_high'],
      role: 'confirmation_filter',
      description: 'Last pivot high is above the previous pivot high.',
      complexity: 'advanced',
      curatedPriority: 54,
      requiredCapabilities: {
        nodeKinds: ['pivot', 'compare'],
        operators: ['gt'],
      },
      fragment: {
        nodes: [
          {
            id: 'last_pivot_high',
            kind: 'pivot',
            pivotKind: 'high',
            left: 5,
            right: 5,
            select: 'last',
          },
          {
            id: 'prev_pivot_high',
            kind: 'pivot',
            pivotKind: 'high',
            left: 5,
            right: 5,
            select: 'prev',
          },
          {
            id: 'higher_high',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'last_pivot_high' },
            right: { ref: 'prev_pivot_high' },
          },
        ],
        assemblyHints: { confirmationFilters: [{ ref: 'higher_high' }] },
        settingsHints: { warmupPeriod: 80 },
      },
      tradeoffs: {
        strengths: ['Directly captures higher-high structure.'],
        risks: ['May be sparse on short histories.'],
        assumptions: ['Two confirmed pivot highs are available.'],
      },
      validationHints: [
        'If validation or backtest shows sparse trades, fall back to rolling high breakout.',
      ],
    }),
    implementation({
      id: 'temporal.weekday_session',
      semanticIds: ['temporal.session_filter', 'temporal.weekday_filter'],
      role: 'context_filter',
      description: 'Only trade during weekday hours.',
      complexity: 'simple',
      curatedPriority: 55,
      requiredCapabilities: {
        nodeKinds: ['time_window'],
      },
      fragment: {
        nodes: [
          {
            id: 'weekday_session',
            kind: 'time_window',
            weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            between: {
              start: { hour: 8, minute: 0 },
              end: { hour: 20, minute: 0 },
            },
          },
        ],
        assemblyHints: { contextFilters: [{ ref: 'weekday_session' }] },
      },
      tradeoffs: {
        strengths: ['Simple execution window constraint.'],
        risks: ['May be irrelevant for 24/7 crypto strategies.'],
        assumptions: [
          'Weekday daytime session is the intended execution window.',
        ],
      },
      validationHints: [
        'Ask the user for timezone when session semantics matter.',
      ],
    }),
    implementation({
      id: 'stateful.compression_then_breakout',
      semanticIds: [
        'compression_range.low_range_before_breakout',
        'stateful_setup.setup_then_trigger',
        'breakout.previous_range_high',
      ],
      role: 'entry_trigger',
      description: 'Compression must occur before a range breakout.',
      complexity: 'advanced',
      curatedPriority: 88,
      requiredCapabilities: {
        nodeKinds: [
          'indicator',
          'rolling',
          'compare',
          'market',
          'cross',
          'sequence',
        ],
        indicators: ['atr'],
        operators: ['avg', 'lt', 'max', 'cross_up'],
      },
      fragment: {
        nodes: [
          {
            id: 'atr_14',
            kind: 'indicator',
            indicator: 'atr',
            args: { length: 14 },
          },
          {
            id: 'atr_avg_50',
            kind: 'rolling',
            op: 'avg',
            source: { ref: 'atr_14' },
            period: 50,
          },
          {
            id: 'compression_setup',
            kind: 'compare',
            op: 'lt',
            left: { ref: 'atr_14' },
            right: { ref: 'atr_avg_50' },
          },
          { id: 'close_price', kind: 'market', field: 'close' },
          { id: 'high_price', kind: 'market', field: 'high' },
          {
            id: 'range_high_20',
            kind: 'rolling',
            op: 'max',
            source: { ref: 'high_price' },
            period: 20,
            offset: 1,
          },
          {
            id: 'breakout_trigger',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'close_price' },
            right: { ref: 'range_high_20' },
          },
          {
            id: 'setup_then_breakout',
            kind: 'sequence',
            steps: [
              { expr: { ref: 'compression_setup' }, maxBars: 20 },
              { expr: { ref: 'breakout_trigger' } },
            ],
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'setup_then_breakout' } },
        settingsHints: { warmupPeriod: 120 },
      },
      tradeoffs: {
        strengths: ['Composes compression and breakout semantics directly.'],
        risks: ['Advanced and can over-filter; monitor trade count.'],
        assumptions: [
          'Compression should happen within 20 bars before breakout.',
        ],
      },
      validationHints: [
        'If zero trades, relax sequence maxBars or remove one confirmation.',
      ],
    }),
    implementation({
      id: 'stateful.pivot_event_arms_breakout',
      semanticIds: ['stateful_setup.armed_trigger', 'breakout.pivot_breakout'],
      role: 'entry_trigger',
      description: 'A pivot event arms a later pivot breakout.',
      complexity: 'advanced',
      curatedPriority: 52,
      risky: true,
      requiredCapabilities: {
        nodeKinds: [
          'event',
          'market',
          'pivot',
          'cross',
          'state_machine',
          'all',
        ],
        operators: ['cross_up'],
      },
      fragment: {
        nodes: [
          {
            id: 'pivot_high_confirmed',
            kind: 'event',
            name: 'pivot_confirmed',
            args: { pivotKind: 'high', left: 5, right: 5 },
          },
          { id: 'close_price', kind: 'market', field: 'close' },
          {
            id: 'last_pivot_high',
            kind: 'pivot',
            pivotKind: 'high',
            left: 5,
            right: 5,
            select: 'last',
          },
          {
            id: 'pivot_breakout',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'close_price' },
            right: { ref: 'last_pivot_high' },
          },
          {
            id: 'armed_pivot_breakout',
            kind: 'state_machine',
            set: { ref: 'pivot_high_confirmed' },
            reset: { ref: 'pivot_breakout' },
            ttlBars: 20,
          },
          {
            id: 'armed_breakout_trigger',
            kind: 'all',
            items: [{ ref: 'armed_pivot_breakout' }, { ref: 'pivot_breakout' }],
          },
        ],
        assemblyHints: { entryTrigger: { ref: 'armed_breakout_trigger' } },
        settingsHints: { warmupPeriod: 80 },
      },
      tradeoffs: {
        strengths: ['Captures stateful setup/trigger behavior.'],
        risks: [
          'Requires careful validation because state semantics can differ from user intent.',
        ],
        assumptions: ['The pivot event arms the strategy for 20 bars.'],
      },
      validationHints: [
        'Validate that the armed state and pivot breakout fire within the expected TTL window.',
      ],
    }),
    implementation({
      id: 'position.exit_after_10_bars',
      semanticIds: ['position_account_state.holding_bars_exit'],
      role: 'exit',
      description: 'Exit after holding a position for more than 10 bars.',
      complexity: 'simple',
      curatedPriority: 86,
      requiredCapabilities: {
        nodeKinds: ['state', 'compare'],
        operators: ['gt'],
      },
      fragment: {
        nodes: [
          {
            id: 'bars_since_entry',
            kind: 'state',
            field: 'position_bars_since_entry',
          },
          {
            id: 'time_stop_exit',
            kind: 'compare',
            op: 'gt',
            left: { ref: 'bars_since_entry' },
            right: { const: 10 },
          },
        ],
        assemblyHints: {
          exit: {
            when: { ref: 'time_stop_exit' },
            action: { mode: 'percent_position', value: 100 },
          },
        },
      },
      tradeoffs: {
        strengths: ['Directly expresses time-stop semantics.'],
        risks: [
          'Can exit winners too early if no profit condition is included.',
        ],
        assumptions: ['10 bars is a default holding timeout.'],
      },
      validationHints: [
        'Adapt the bar count to the timeframe and user holding-period intent.',
      ],
    }),
    implementation({
      id: 'position.exit_unrealized_loss',
      semanticIds: ['position_account_state.pnl_exit'],
      role: 'exit',
      description: 'Exit when unrealized PnL falls below a threshold.',
      complexity: 'balanced',
      curatedPriority: 50,
      risky: true,
      requiredCapabilities: {
        nodeKinds: ['state', 'compare'],
        operators: ['lt'],
      },
      fragment: {
        nodes: [
          {
            id: 'unrealized_pnl',
            kind: 'state',
            field: 'position_unrealized_pnl',
          },
          {
            id: 'loss_limit_exit',
            kind: 'compare',
            op: 'lt',
            left: { ref: 'unrealized_pnl' },
            right: { const: -100 },
          },
        ],
        assemblyHints: {
          exit: {
            when: { ref: 'loss_limit_exit' },
            action: { mode: 'percent_position', value: 100 },
          },
        },
      },
      tradeoffs: {
        strengths: ['Uses account/position state directly.'],
        risks: ['Absolute PnL threshold may not scale across account sizes.'],
        assumptions: ['The user wants account-currency loss control.'],
      },
      validationHints: [
        'Prefer percent stop loss for scale-invariant risk unless PnL semantics are explicit.',
      ],
    }),
    implementation({
      id: 'risk.percent_stop_loss',
      semanticIds: ['risk_exit.stop_loss'],
      role: 'risk',
      description: 'Add a 2% stop loss.',
      complexity: 'simple',
      curatedPriority: 95,
      requiredCapabilities: { nodeKinds: [] },
      fragment: {
        nodes: [],
        assemblyHints: { risk: { stopLoss: { mode: 'percent', value: 2 } } },
      },
      tradeoffs: {
        strengths: ['Simple, scale-invariant risk control.'],
        risks: ['Too tight for volatile instruments/timeframes.'],
        assumptions: ['2% stop is a moderate default.'],
      },
      validationHints: ['Align stop distance with volatility and timeframe.'],
    }),
    implementation({
      id: 'risk.percent_take_profit',
      semanticIds: ['risk_exit.take_profit'],
      role: 'risk',
      description: 'Add a 6% take-profit target.',
      complexity: 'simple',
      curatedPriority: 78,
      requiredCapabilities: { nodeKinds: [] },
      fragment: {
        nodes: [],
        assemblyHints: {
          risk: { takeProfits: [{ triggerPercent: 6, closePercent: 100 }] },
        },
      },
      tradeoffs: {
        strengths: ['Makes profit-taking explicit.'],
        risks: ['Fixed targets can truncate trend-following winners.'],
        assumptions: ['6% target is a default illustration.'],
      },
      validationHints: [
        'Compare fixed take-profit against trailing or signal exits.',
      ],
    }),
    implementation({
      id: 'risk.trailing_stop',
      semanticIds: ['risk_exit.trailing_stop'],
      role: 'risk',
      description: 'Add a trailing stop that activates after profit.',
      complexity: 'balanced',
      curatedPriority: 72,
      requiredCapabilities: { nodeKinds: [] },
      fragment: {
        nodes: [],
        assemblyHints: {
          risk: {
            trailingStop: { distancePercent: 3, activateAfterPercent: 2 },
          },
        },
      },
      tradeoffs: {
        strengths: ['Lets winners run while controlling giveback.'],
        risks: ['Can chop out during volatile pullbacks.'],
        assumptions: ['3% trail after 2% activation is a balanced default.'],
      },
      validationHints: ['Use wider distances on higher-volatility markets.'],
    }),
    implementation({
      id: 'sizing.percent_equity_10',
      semanticIds: ['sizing_execution.percent_equity'],
      role: 'risk',
      description: 'Use 10% equity position sizing.',
      complexity: 'simple',
      curatedPriority: 60,
      requiredCapabilities: { nodeKinds: [] },
      fragment: {
        nodes: [],
        assemblyHints: {
          entryActionHint: {
            side: 'long',
            sizing: { mode: 'percent_equity', value: 10 },
          },
        },
      },
      tradeoffs: {
        strengths: ['Keeps sizing relative to account equity.'],
        risks: ['Not a complete risk model without stops.'],
        assumptions: ['10% equity is a conservative first-draft sizing hint.'],
      },
      validationHints: [
        'Respect explicit user risk tolerance over this default.',
      ],
    }),
    implementation({
      id: 'execution.close_near_breakout_level',
      semanticIds: [
        'sizing_execution.no_chase_distance',
        'breakout.previous_range_high',
      ],
      role: 'confirmation_filter',
      description: 'Close remains near the breakout level to avoid chasing.',
      complexity: 'balanced',
      curatedPriority: 82,
      requiredCapabilities: {
        nodeKinds: ['market', 'rolling', 'near'],
        operators: ['max'],
      },
      fragment: {
        nodes: [
          { id: 'close_price', kind: 'market', field: 'close' },
          { id: 'high_price', kind: 'market', field: 'high' },
          {
            id: 'range_high_20',
            kind: 'rolling',
            op: 'max',
            source: { ref: 'high_price' },
            period: 20,
            offset: 1,
          },
          {
            id: 'not_chasing',
            kind: 'near',
            left: { ref: 'close_price' },
            right: { ref: 'range_high_20' },
            tolerance: { mode: 'percent', value: 1 },
          },
        ],
        assemblyHints: { confirmationFilters: [{ ref: 'not_chasing' }] },
        settingsHints: { warmupPeriod: 50 },
      },
      tradeoffs: {
        strengths: [
          'Turns “do not chase” into a concrete distance constraint.',
        ],
        risks: ['May reject valid strong breakouts.'],
        assumptions: ['Within 1% of the breakout level is acceptable.'],
      },
      validationHints: ['Relax tolerance if backtest trade count is too low.'],
    }),
  ];

const FACET_BY_ID = new Map<string, SemanticFacetDefinition>(
  SEMANTIC_FACETS.map((item) => [item.id, item]),
);

const IMPLEMENTATION_BY_ID = new Map<string, SemanticImplementationDefinition>(
  SEMANTIC_IMPLEMENTATIONS.map((item) => [item.id, item]),
);

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getSemanticOntology(
  options: { family?: string; includeFragments?: boolean } = {},
): SemanticOntologyDocument {
  const selectedFacets =
    options.family === undefined
      ? [...SEMANTIC_FACETS]
      : SEMANTIC_FACETS.filter((item) => item.family === options.family);
  const selectedIds = new Set(selectedFacets.map((item) => item.id));
  const doc: SemanticOntologyDocument = {
    protocol: 'traseq.agent.semantics',
    version: 1,
    families: [...families],
    facets: selectedFacets.map((item) => cloneDeep(item)),
  };

  if (options.includeFragments === true) {
    doc.implementations = SEMANTIC_IMPLEMENTATIONS.filter((item) =>
      item.semanticIds.some((semanticId) => selectedIds.has(semanticId)),
    ).map((item) => cloneDeep(item));
  }

  return doc;
}

export function findFacet(id: string): SemanticFacetDefinition | undefined {
  return FACET_BY_ID.get(id);
}

export function findImplementation(
  id: string,
): SemanticImplementationDefinition | undefined {
  return IMPLEMENTATION_BY_ID.get(id);
}
