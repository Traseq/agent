import { DOMAIN_CONSTANTS } from '../generated/constants.js';

export const TIMEFRAME_VALUES = DOMAIN_CONSTANTS.TIMEFRAMES;
export type Timeframe = (typeof TIMEFRAME_VALUES)[number];
const TIMEFRAME_SET: ReadonlySet<string> = new Set(TIMEFRAME_VALUES);

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && TIMEFRAME_SET.has(value);
}

export const POSITION_STYLE_VALUES = [
  'single',
  'pyramid',
  'accumulate',
] as const;
export type PositionStyle = (typeof POSITION_STYLE_VALUES)[number];
const POSITION_STYLE_SET: ReadonlySet<string> = new Set(POSITION_STYLE_VALUES);

export function isPositionStyle(value: unknown): value is PositionStyle {
  return typeof value === 'string' && POSITION_STYLE_SET.has(value);
}

export const RISK_TOLERANCE_VALUES = [
  'conservative',
  'moderate',
  'aggressive',
] as const;
export type RiskTolerance = (typeof RISK_TOLERANCE_VALUES)[number];
const RISK_TOLERANCE_SET: ReadonlySet<string> = new Set(RISK_TOLERANCE_VALUES);

export function isRiskTolerance(value: unknown): value is RiskTolerance {
  return typeof value === 'string' && RISK_TOLERANCE_SET.has(value);
}

export const GUIDED_TOOL_ORDER = [
  'start_research_engagement',
  'run_guided_research_round',
  'summarize_research_engagement',
] as const;
export type GuidedToolName = (typeof GUIDED_TOOL_ORDER)[number];
export const GUIDED_TOOL_NAMES: ReadonlySet<string> = new Set(
  GUIDED_TOOL_ORDER,
);
