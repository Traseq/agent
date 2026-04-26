import type { JsonObject, ScoreBreakdown } from './types.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function getMetric(summary: JsonObject | undefined, key: string): number {
  const value = summary?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export { getMetric };

export function buildScoreBreakdown(
  summary: JsonObject | undefined,
): ScoreBreakdown {
  const returnPct = getMetric(summary, 'returnPct');
  const sharpeRatio = getMetric(summary, 'sharpeRatio');
  const sortinoRatio = getMetric(summary, 'sortinoRatio');
  const maxDrawdown = getMetric(summary, 'maxDrawdown');
  const profitFactor = getMetric(summary, 'profitFactor');
  const totalPositions = getMetric(summary, 'totalPositions');
  const sqn = getMetric(summary, 'systemQualityNumber');

  const returnScore = clamp(returnPct * 140, -30, 45);
  const sharpeScore = clamp(sharpeRatio * 18, -20, 40);
  const profitFactorScore = clamp(
    (Math.min(profitFactor, 4) - 1) * 12,
    -12,
    36,
  );
  const drawdownPenalty = clamp(maxDrawdown * 85, 0, 40);
  const consistencyScore = clamp(sortinoRatio * 8 + sqn * 2.5, -10, 28);
  const activityScore = clamp(Math.min(totalPositions, 80) * 0.18, 0, 14);

  const total = roundNumber(
    returnScore +
      sharpeScore +
      profitFactorScore +
      consistencyScore +
      activityScore -
      drawdownPenalty,
    2,
  );

  const notes: string[] = [];

  if (totalPositions < 8) {
    notes.push('Sample size is small — results have limited confidence.');
  } else if (totalPositions >= 25) {
    notes.push('Trade sample size is in the comparable range.');
  }

  if (sharpeRatio >= 1) {
    notes.push('Sharpe ratio has reached a usable level.');
  } else if (sharpeRatio <= 0) {
    notes.push('Risk-adjusted return is weak.');
  }

  if (maxDrawdown <= 0.12) {
    notes.push('Max drawdown is relatively contained.');
  } else if (maxDrawdown >= 0.25) {
    notes.push('Max drawdown is excessive — risk management needs priority.');
  }

  if (profitFactor >= 1.4) {
    notes.push('Profit factor shows a positive profit/loss structure.');
  } else if (profitFactor > 0 && profitFactor < 1) {
    notes.push('Profit factor is below 1 — trade structure is not yet positive.');
  }

  return {
    total,
    returnScore: roundNumber(returnScore),
    sharpeScore: roundNumber(sharpeScore),
    profitFactorScore: roundNumber(profitFactorScore),
    drawdownPenalty: roundNumber(drawdownPenalty),
    consistencyScore: roundNumber(consistencyScore),
    activityScore: roundNumber(activityScore),
    notes,
  };
}
