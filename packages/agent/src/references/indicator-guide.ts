export const INDICATOR_GUIDE_REFERENCE = `\
# Indicator Guide

All indicators are used as \`kind: "indicator"\` nodes in the signalGraph.
The \`indicator\` field must match the ID below. The \`args\` field contains
indicator-specific arguments from \`capabilities.indicators[].args\`. For
multi-output indicators, put the selector in top-level \`output\`, never inside
\`args\`.

Common pattern:
\`\`\`json
{ "id": "my_rsi", "kind": "indicator", "indicator": "rsi", "args": { "length": 14 } }
\`\`\`

---

## Moving Averages

Smooth price data to identify trend direction. Output: numeric series.

| ID | Name | Key Args | Typical Values | Notes |
|----|------|----------|---------------|-------|
| sma | Simple MA | length | 20, 50, 200 | Equal-weighted, most lag |
| ema | Exponential MA | length | 12, 26, 50, 100, 200 | Most popular, good balance of lag vs. smoothing |
| wma | Weighted MA | length | 20, 50 | Linear-weighted, less lag than SMA |
| smma | Smoothed MA | length | 20, 50 | Very smooth, most lag |
| hma | Hull MA | length | 9, 20 | Least lag, can be noisy |
| kama | Kaufman Adaptive MA | length | 10, 20 | Adapts to volatility |
| dema | Double EMA | length | 20, 50 | Reduced lag |
| tema | Triple EMA | length | 20, 50 | Least lag of EMA variants |
| vwma | Volume-Weighted MA | length | 20 | Weights by volume, good for confirmation |

**When to use**: Trend filters (close > ema_200 = uptrend). Cross signals
(ema_12 cross_up ema_26). Support/resistance levels.

**Common pairings**: EMA(50) + EMA(200) for golden/death cross.
Close vs EMA(100) for trend filter.

---

## Trend Indicators

Identify trend direction and strength. Output: numeric series (sometimes multi-output).

| ID | Name | Key Args | Typical Values | Notes |
|----|------|----------|---------------|-------|
| macd | MACD | fast_length, slow_length, signal_length + output | 12, 26, 9 | Use output: "macd", "signal", or "hist" |
| adx | ADX | length + output | 14 | Use output: "adx", "plus_di", or "minus_di" |
| ichimoku | Ichimoku Cloud | conversion_length, base_length, lagging_span_length, displacement + output | 9, 26, 52, 26 | Multiple outputs, complex |
| psar | Parabolic SAR | step, max | 0.02, 0.2 | Trailing stop indicator |
| supertrend | SuperTrend | atr_length, multiplier + output | 10, 3 | Use output: "supertrend" for the line or "trend_direction" for +1/-1 regime |

**MACD usage**: MACD cross_up signal line = bullish. MACD > 0 = uptrend.
MACD histogram divergence = potential reversal.

**ADX usage**: ADX > 25 = strong trend (use trend strategies).
ADX < 20 = range-bound (use mean-reversion). Do not use ADX for direction.

---

## Bands & Channels

Define price envelopes for breakout or reversion strategies. Output: numeric series.

| ID | Name | Key Args | Typical Values | Notes |
|----|------|----------|---------------|-------|
| bbands | Bollinger Bands | length, multiplier + output | 20, 2 | Use output: "upper", "middle", "lower", "width", or "percent_b" |
| donchian | Donchian Channel | length + output | 20, 55 | Use output: "upper", "middle", or "lower" |
| keltner_channel | Keltner Channel | ema_length, atr_length, multiplier + output | 20, 10, 1.5 | ATR-based envelope |
| chandelier_exit | Chandelier Exit | length, atr_length, multiplier + output | 22, 22, 3 | ATR-based trailing stop level |

**Bollinger usage**: Price near lower band + RSI oversold = mean-reversion long.
Band squeeze (width narrows) = breakout imminent.

**Donchian usage**: Price > donchian upper = breakout. Classic turtle trading system.

---

## Oscillators

Measure momentum and overbought/oversold conditions. Output: numeric series (bounded).

| ID | Name | Key Args | Typical Values | Range | Notes |
|----|------|----------|---------------|-------|-------|
| rsi | RSI | length | 14 | 0-100 | Most versatile oscillator |
| stoch | Stochastic | k_length, d_length, smooth_k + output | 14, 3, 3 | 0-100 | Use output: "k" or "d" |
| stoch_rsi | Stochastic RSI | length, rsi_length, k_length, d_length + output | 14, 14, 3, 3 | 0-100 | Use output: "k" or "d" |
| williams_r | Williams %R | length | 14 | -100 to 0 | Inverted stochastic |
| cci | CCI | length | 20 | Unbounded | >100 overbought, <-100 oversold |
| roc | Rate of Change | length | 12 | Unbounded | % change over N bars |
| momentum | Momentum | length | 10 | Unbounded | Price difference over N bars |
| ultimate_osc | Ultimate Oscillator | fast, medium, slow | 7, 14, 28 | 0-100 | Multi-timeframe momentum |
| mfi | Money Flow Index | length | 14 | 0-100 | Volume-weighted RSI |
| tsi | True Strength Index | long_length, short_length | 25, 13 | -100 to 100 | Double-smoothed momentum |
| fisher | Fisher Transform | length | 10 | Unbounded | Gaussian-normalized oscillator |
| awesome_osc | Awesome Oscillator | fast_length, slow_length | 5, 34 | Unbounded | Median price momentum |

**RSI levels**:
- Oversold: < 30 (long-entry trigger for mean-reversion)
- Neutral: 30-70
- Overbought: > 70 (exit / short-entry trigger for mean-reversion)
- Trend reclaim: cross_up 45-50 in uptrend (pullback long-entry)

**Common pairings**: RSI(14) + EMA(100) trend filter. Stochastic + support level.

---

## Volatility Indicators

Measure price variability. Useful for sizing, stop loss calculation, and
regime detection. Output: numeric series.

| ID | Name | Key Args | Typical Values | Notes |
|----|------|----------|---------------|-------|
| atr | ATR | length | 14 | Average True Range, in price units |
| hist_vol | Historical Volatility | length | 20 | Annualized standard deviation |
| atr_pct | ATR % | length | 14 | ATR as % of close price |
| range_pct | Range % | — | — | Current bar range as % of close |
| body_range_pct | Body Range % | — | — | Candle body as % of full range |
| sd | Standard Deviation | length | 20 | Raw std dev of close prices |

**ATR usage**: Dynamic stop loss (e.g. 2× ATR below entry). Position sizing
(risk a fixed $ amount per ATR). Volatility filter (high ATR = trending).

---

## Volume Indicators

Analyze volume to confirm price moves. Output: numeric series.

| ID | Name | Key Args | Typical Values | Notes |
|----|------|----------|---------------|-------|
| vma | Volume MA | length | 20 | Simple MA of volume |
| vroc | Volume ROC | length | 14 | Volume rate of change |
| vol_osc | Volume Oscillator | fast_length, slow_length | 5, 20 | Fast vs slow volume MA |
| obv | On-Balance Volume | — | — | Cumulative volume by direction |
| ad_line | AD Line | — | — | Accumulation/Distribution |
| cmf | Chaikin Money Flow | length | 20 | -1 to 1, volume-weighted A/D |
| pvt | Price Volume Trend | — | — | Volume × price change % |
| vfi | Volume Flow Indicator | length | 130 | Tracks volume flow direction |
| eom | Ease of Movement | length | 14 | Price-volume efficiency |
| force_index | Force Index | length | 13 | Price change × volume |
| vwap | VWAP | — | — | Volume-weighted average price |
| volume_zscore | Volume Z-Score | length | 20 | Normalized volume |
| volume_spike | Volume Spike | length, threshold | 20, 2 | Detects unusual volume |

**Volume confirmation**: A breakout with rising volume (volume > vma_20) is
more reliable. Divergence between price and OBV signals potential reversal.

---

## Price Action

Support/resistance and structural analysis.

| ID | Name | Key Args | Notes |
|----|------|----------|-------|
| price_channel | Price Channel | length | High/low channel over N bars |
| zigzag | ZigZag | deviation | Connects swing points, filters noise |
| sr_swings | S/R Swings | length | Support and resistance from swings |
| atr_trailing_stop | ATR Trailing Stop | length, multiplier | ATR-based dynamic stop level |
| psar_trailing_stop | PSAR Trailing Stop | step, max | Parabolic SAR as a stop level |
| avwap | Anchored VWAP | — | VWAP from a specific anchor point |

---

## Indicator Selection Guidelines

1. **For trend-following**: Use a moving average (ema, sma) as a trend filter,
   plus a momentum indicator (rsi, macd) as the entry trigger.

2. **For mean-reversion**: Use a band indicator (bbands, keltner) to identify
   extremes, plus an oscillator (rsi, stoch) for confirmation.

3. **For breakout**: Use a channel (donchian, price_channel) for the breakout
   level, plus a volatility indicator (atr) or volume indicator for confirmation.

4. **For pattern-based**: Use a candlestick pattern node, plus a trend filter
   (ema) to ensure you trade in the right direction.

5. **Avoid redundancy**: Do not use RSI + Stochastic + Williams %R together.
   They measure similar things. Pick one oscillator per strategy.

6. **Match indicator to timeframe**:
   - 15m: Shorter lookbacks (ema_20, rsi_9)
   - 1h: Standard lookbacks (ema_50, rsi_14)
   - 4h: Medium lookbacks (ema_100, rsi_14)
   - 1d: Longer lookbacks (ema_200, rsi_14)
`;
