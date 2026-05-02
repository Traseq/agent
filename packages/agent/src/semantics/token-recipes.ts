import type {
  SemanticRole,
  TokenRecipeDefinition,
  TokenRecipeParameter,
} from './types.js';

type TokenDto = Record<string, unknown>;

const TT = {
  constant: 'constant_operand',
  market: 'market_data_operand',
  volume: 'volume_operand',
  price: 'price_indicator_operand',
  oscillator: 'oscillator_operand',
  volatility: 'volatility_operand',
  state: 'state_operand',
  rolling: 'rolling_operand',
  pivot: 'pivot_operand',
  compare: 'comparison_condition',
  cross: 'cross_condition',
  proximity: 'proximity_condition',
  sequence: 'sequence_condition',
  stateCondition: 'state_condition',
  time: 'time_condition',
  pivotEvent: 'pivot_event_condition',
  logicAnd: 'logic_and',
} as const;

const numberParam = (
  name: string,
  description: string,
  defaultValue: number,
  aliases?: readonly string[],
): TokenRecipeParameter => ({
  name,
  type: 'number',
  default: defaultValue,
  description,
  ...(aliases && aliases.length > 0 ? { aliases: [...aliases] } : {}),
});

const token = (type: string, params?: Record<string, unknown>): TokenDto =>
  params ? { type, params } : { type };

const constant = (value: number) => token(TT.constant, { value });
const market = (marketField: string, params: Record<string, unknown> = {}) =>
  token(TT.market, { marketField, ...params });
const volume = (params: Record<string, unknown> = {}) =>
  token(TT.volume, { marketField: 'volume', ...params });
const price = (
  name: string,
  args: Record<string, unknown>,
  params: Record<string, unknown> = {},
) => token(TT.price, { name, args, ...params });
const oscillator = (
  name: string,
  args: Record<string, unknown>,
  params: Record<string, unknown> = {},
) => token(TT.oscillator, { name, args, ...params });
const volatility = (
  name: string,
  args: Record<string, unknown>,
  params: Record<string, unknown> = {},
) => token(TT.volatility, { name, args, ...params });
const state = (field: string) => token(TT.state, { field });
const rolling = (
  rollingOperator: string,
  source: TokenDto,
  period: number,
  params: Record<string, unknown> = {},
) =>
  token(TT.rolling, {
    rollingOperator,
    period,
    source: [source],
    ...params,
  });
const pivot = (kind: 'high' | 'low', params: Record<string, unknown> = {}) =>
  token(TT.pivot, {
    kind,
    left: 5,
    right: 5,
    select: 'last',
    ...params,
  });
const compare = (compareOperator: string) =>
  token(TT.compare, { compareOperator });
const cross = (crossOperator: string) => token(TT.cross, { crossOperator });
const proximity = (
  target: TokenDto,
  tolerance: number,
  type: 'percent' | 'absolute' = 'percent',
) => token(TT.proximity, { target: [target], tolerance, type });
const sequence = (
  stages: Array<{ ruleTokens: TokenDto[]; minBars?: number; maxBars?: number }>,
) => token(TT.sequence, { stages });
const stateCondition = (
  triggerTokens: TokenDto[],
  params: Record<string, unknown> = {},
) => token(TT.stateCondition, { triggerTokens, ...params });
const pivotEvent = (kind: 'high' | 'low') =>
  token(TT.pivotEvent, { kind, left: 5, right: 5 });

const defaults = {
  close: market('close'),
  high: market('high'),
  volume: volume(),
  ema20: price('ema', { length: 20 }),
  ema50: price('ema', { length: 50 }),
  ema100: price('ema', { length: 100 }),
  rsi14: oscillator('rsi', { length: 14 }),
  atr14: volatility('atr', { length: 14 }),
};

function recipe(definition: TokenRecipeDefinition): TokenRecipeDefinition {
  return definition;
}

export const TOKEN_RECIPES: readonly TokenRecipeDefinition[] = [
  recipe({
    recipeId: 'trend.close_above_ema_100',
    implementationId: 'trend.close_above_ema_100',
    role: 'context_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.context_filter'],
    displayName: 'Close above EMA',
    semanticSummary: 'Close is above EMA(100).',
    params: [numberParam('length', 'EMA lookback length.', 100)],
    tokens: [defaults.close, compare('gt'), defaults.ema100],
  }),
  recipe({
    recipeId: 'trend.ema_fast_above_slow',
    implementationId: 'trend.ema_fast_above_slow',
    role: 'context_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.context_filter'],
    displayName: 'EMA fast above slow',
    semanticSummary: 'EMA(20) is above EMA(50).',
    params: [
      numberParam('fastLength', 'Fast EMA length.', 20),
      numberParam('slowLength', 'Slow EMA length.', 50),
    ],
    tokens: [defaults.ema20, compare('gt'), defaults.ema50],
  }),
  recipe({
    recipeId: 'momentum.rsi_cross_up_30',
    implementationId: 'momentum.rsi_cross_up_30',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger', 'entry.filter'],
    displayName: 'RSI reclaim',
    semanticSummary: 'RSI(14) crosses above 30.',
    params: [
      numberParam('length', 'RSI lookback length.', 14),
      numberParam('threshold', 'RSI reclaim threshold.', 30),
    ],
    tokens: [defaults.rsi14, cross('cross_up'), constant(30)],
  }),
  recipe({
    recipeId: 'momentum.macd_cross_signal',
    implementationId: 'momentum.macd_cross_signal',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger'],
    displayName: 'MACD bullish cross',
    semanticSummary: 'MACD line crosses above signal line.',
    params: [],
    tokens: [
      oscillator('macd', {
        fast_length: 12,
        slow_length: 26,
        signal_length: 9,
        output: 'macd',
      }),
      cross('cross_up'),
      oscillator('macd', {
        fast_length: 12,
        slow_length: 26,
        signal_length: 9,
        output: 'signal',
      }),
    ],
  }),
  recipe({
    recipeId: 'mean_reversion.close_near_ema_after_pullback',
    implementationId: 'mean_reversion.close_near_ema_after_pullback',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger', 'entry.filter'],
    displayName: 'Close near EMA pullback',
    semanticSummary: 'Close is near EMA(20).',
    params: [numberParam('tolerance', 'Percent proximity tolerance.', 0.5)],
    tokens: [defaults.close, proximity(defaults.ema20, 0.5)],
  }),
  recipe({
    recipeId: 'breakout.close_crosses_20_high',
    implementationId: 'breakout.close_crosses_20_high',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger'],
    displayName: 'Range-high breakout',
    semanticSummary: 'Close crosses above the prior 20-bar high.',
    // P-Vocab: canonical name is `length` (matches indicator vocabulary the
    // LLM uses everywhere else); accept `period` as an alias because the
    // rolling token internally still uses `period` and earlier recipes shipped
    // with that name. Auto-normalize handles the same drift on raw drafts.
    params: [
      numberParam('length', 'Rolling high lookback length.', 20, ['period']),
    ],
    tokens: [
      defaults.close,
      cross('cross_up'),
      rolling('max', defaults.high, 20, { offset: 1 }),
    ],
  }),
  recipe({
    recipeId: 'breakout.close_crosses_pivot_high',
    implementationId: 'breakout.close_crosses_pivot_high',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger'],
    displayName: 'Pivot-high breakout',
    semanticSummary: 'Close crosses above the last confirmed pivot high.',
    params: [],
    tokens: [defaults.close, cross('cross_up'), pivot('high')],
  }),
  recipe({
    recipeId: 'compression.atr_below_average',
    implementationId: 'compression.atr_below_average',
    role: 'context_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.context_filter'],
    displayName: 'ATR compression',
    semanticSummary: 'ATR(14) is below its 50-bar average.',
    params: [],
    tokens: [defaults.atr14, compare('lt'), rolling('avg', defaults.atr14, 50)],
  }),
  recipe({
    recipeId: 'volume.volume_above_avg_20',
    implementationId: 'volume.volume_above_avg_20',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'Volume above average',
    semanticSummary: 'Volume is above its 20-bar average.',
    params: [
      numberParam('length', 'Average volume lookback length.', 20, ['period']),
    ],
    tokens: [
      defaults.volume,
      compare('gt'),
      rolling('avg', defaults.volume, 20),
    ],
  }),
  recipe({
    recipeId: 'volume.volume_above_max_50',
    implementationId: 'volume.volume_above_max_50',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'Volume breakout',
    semanticSummary: 'Volume exceeds the prior 50-bar maximum.',
    params: [],
    tokens: [
      defaults.volume,
      compare('gt'),
      rolling('max', defaults.volume, 50, { offset: 1 }),
    ],
  }),
  recipe({
    recipeId: 'volatility.atr_above_avg_50',
    implementationId: 'volatility.atr_above_avg_50',
    role: 'context_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.context_filter'],
    displayName: 'ATR expansion',
    semanticSummary: 'ATR(14) is above its 50-bar average.',
    params: [],
    tokens: [defaults.atr14, compare('gt'), rolling('avg', defaults.atr14, 50)],
  }),
  recipe({
    recipeId: 'volatility.atr_crosses_avg_20',
    implementationId: 'volatility.atr_crosses_avg_20',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'ATR cross-up',
    semanticSummary: 'ATR(14) crosses above its 20-bar average.',
    params: [],
    tokens: [
      defaults.atr14,
      cross('cross_up'),
      rolling('avg', defaults.atr14, 20),
    ],
  }),
  recipe({
    recipeId: 'structure.pivot_low_confirmed',
    implementationId: 'structure.pivot_low_confirmed',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'Pivot low confirmed',
    semanticSummary: 'A new pivot low is confirmed.',
    params: [],
    tokens: [pivotEvent('low')],
  }),
  recipe({
    recipeId: 'structure.last_pivot_high_above_previous',
    implementationId: 'structure.last_pivot_high_above_previous',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'Higher pivot highs',
    semanticSummary: 'Last pivot high is above the previous pivot high.',
    params: [],
    tokens: [
      pivot('high', { select: 'last' }),
      compare('gt'),
      pivot('high', { select: 'prev' }),
    ],
  }),
  recipe({
    recipeId: 'temporal.weekday_session',
    implementationId: 'temporal.weekday_session',
    role: 'context_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.context_filter'],
    displayName: 'Weekday session',
    semanticSummary: 'Only trade Monday through Friday from 08:00 to 20:00.',
    params: [],
    tokens: [
      token(TT.time, {
        weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        between: {
          start: { hour: 8, minute: 0 },
          end: { hour: 20, minute: 0 },
        },
      }),
    ],
  }),
  recipe({
    recipeId: 'stateful.compression_then_breakout',
    implementationId: 'stateful.compression_then_breakout',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger'],
    displayName: 'Compression then breakout',
    semanticSummary: 'ATR compression occurs before a range-high breakout.',
    params: [],
    tokens: [
      sequence([
        {
          ruleTokens: [
            defaults.atr14,
            compare('lt'),
            rolling('avg', defaults.atr14, 50),
          ],
          maxBars: 20,
        },
        {
          ruleTokens: [
            defaults.close,
            cross('cross_up'),
            rolling('max', defaults.high, 20, { offset: 1 }),
          ],
        },
      ]),
    ],
  }),
  recipe({
    recipeId: 'stateful.pivot_event_arms_breakout',
    implementationId: 'stateful.pivot_event_arms_breakout',
    role: 'entry_trigger',
    produces: 'bool',
    validAs: ['entry.trigger'],
    displayName: 'Pivot-armed breakout',
    semanticSummary: 'A pivot event arms a later pivot breakout.',
    params: [],
    tokens: [
      stateCondition([pivotEvent('high')], {
        resetTokens: [defaults.close, cross('cross_up'), pivot('high')],
        maxBars: 20,
      }),
      token(TT.logicAnd),
      defaults.close,
      cross('cross_up'),
      pivot('high'),
    ],
  }),
  recipe({
    recipeId: 'position.exit_after_10_bars',
    implementationId: 'position.exit_after_10_bars',
    role: 'exit',
    produces: 'bool',
    validAs: ['strategy.exit.when'],
    displayName: 'Time-based exit',
    semanticSummary: 'Exit after holding for more than 10 bars.',
    params: [numberParam('bars', 'Maximum holding bars.', 10)],
    tokens: [state('position_bars_since_entry'), compare('gt'), constant(10)],
  }),
  recipe({
    recipeId: 'position.exit_unrealized_loss',
    implementationId: 'position.exit_unrealized_loss',
    role: 'exit',
    produces: 'bool',
    validAs: ['strategy.exit.when'],
    displayName: 'Unrealized-loss exit',
    semanticSummary: 'Exit when unrealized PnL drops below -100.',
    params: [numberParam('lossAmount', 'Unrealized loss threshold.', -100)],
    tokens: [state('position_unrealized_pnl'), compare('lt'), constant(-100)],
  }),
  recipe({
    recipeId: 'risk.percent_stop_loss',
    implementationId: 'risk.percent_stop_loss',
    role: 'risk',
    produces: 'risk',
    validAs: ['strategy.risk.stopLoss'],
    displayName: 'Percent stop loss',
    semanticSummary: 'Attach a fixed-percent stop loss.',
    params: [numberParam('percent', 'Stop-loss percent.', 2)],
    tokens: [],
  }),
  recipe({
    recipeId: 'risk.percent_take_profit',
    implementationId: 'risk.percent_take_profit',
    role: 'risk',
    produces: 'risk',
    validAs: ['strategy.risk.takeProfits'],
    displayName: 'Percent take profit',
    semanticSummary: 'Attach a fixed-percent take-profit target.',
    params: [numberParam('percent', 'Take-profit trigger percent.', 6)],
    tokens: [],
  }),
  recipe({
    recipeId: 'risk.trailing_stop',
    implementationId: 'risk.trailing_stop',
    role: 'risk',
    produces: 'risk',
    validAs: ['strategy.risk.trailingStop'],
    displayName: 'Trailing stop',
    semanticSummary: 'Attach a trailing stop after price moves favorably.',
    params: [
      numberParam('distancePercent', 'Trailing stop distance percent.', 3),
      numberParam('activateAfterPercent', 'Activation profit percent.', 2),
    ],
    tokens: [],
  }),
  recipe({
    recipeId: 'sizing.percent_equity_10',
    implementationId: 'sizing.percent_equity_10',
    role: 'risk',
    produces: 'entry_action',
    validAs: ['strategy.entry.action.sizing'],
    displayName: 'Percent-equity sizing',
    semanticSummary: 'Use 10% equity position sizing.',
    params: [numberParam('percent', 'Percent of equity to allocate.', 10)],
    tokens: [],
  }),
  recipe({
    recipeId: 'execution.close_near_breakout_level',
    implementationId: 'execution.close_near_breakout_level',
    role: 'confirmation_filter',
    produces: 'bool',
    validAs: ['entry.filter', 'entry.confirmation_filter'],
    displayName: 'Close near breakout',
    semanticSummary: 'Close remains within 1% of the breakout level.',
    params: [numberParam('tolerance', 'Percent distance tolerance.', 1)],
    tokens: [
      defaults.close,
      proximity(rolling('max', defaults.high, 20, { offset: 1 }), 1),
    ],
  }),
];

const RECIPE_BY_ID = new Map(
  TOKEN_RECIPES.map((item) => [item.recipeId, item]),
);
const RECIPE_BY_IMPLEMENTATION_ID = new Map(
  TOKEN_RECIPES.map((item) => [item.implementationId, item]),
);

export function findTokenRecipe(
  recipeId: string,
): TokenRecipeDefinition | undefined {
  return RECIPE_BY_ID.get(recipeId);
}

export function findTokenRecipeForImplementation(
  implementationId: string,
): TokenRecipeDefinition | undefined {
  return RECIPE_BY_IMPLEMENTATION_ID.get(implementationId);
}

export function tokenRoleForSemanticRole(role: SemanticRole): string {
  switch (role) {
    case 'entry_trigger':
      return 'entry.trigger';
    case 'confirmation_filter':
      return 'entry.confirmation_filter';
    case 'context_filter':
      return 'entry.context_filter';
    case 'exit':
      return 'strategy.exit.when';
    case 'risk':
      return 'strategy.risk';
  }
}

export function cloneTokenRecipe(
  recipe: TokenRecipeDefinition,
): TokenRecipeDefinition {
  return JSON.parse(JSON.stringify(recipe)) as TokenRecipeDefinition;
}
