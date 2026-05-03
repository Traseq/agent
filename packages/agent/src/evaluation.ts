import { buildScoreBreakdown, getMetric } from './scoring.js';
import type {
  ResearchConfidence,
  ResearchDecision,
  ResearchEvidenceMetrics,
  ResearchResultEvaluation,
  ResearchRiskFlag,
  ResearchRoundEvaluation,
  ResearchRunnerResult,
  ResearchRunnerRound,
  ResearchVerdict,
  ResearchWeakness,
  ScoreBreakdown,
} from './types.js';

export const EVALUATION_SCHEMA_VERSION = 1;

const EVALUATION_THRESHOLDS = {
  totalPositions: { robust: 20, promising: 10, limited: 20, small: 10 },
  profitFactor: { robust: 1.3, promising: 1.1, thin: 1.1 },
  sharpeRatio: { robust: 0.8, promising: 0.4, low: 0.4 },
  maxDrawdown: { robust: 0.25, promising: 0.35, elevated: 0.35, blocker: 0.45 },
} as const;

const KNOWN_STOP_REASONS = new Set([
  'validation_failed',
  'backtest_failed',
  'backtest_timeout',
  'producer_timeout',
  'producer_error',
  'create_strategy_failed',
  'create_strategy_version_failed',
  'finalize_validation_failed',
  'finalize_confirmation_required',
  'duplicate_version',
  'context_failed',
]);

const CONFIDENCE_RANK: Record<ResearchConfidence, number> = {
  reject: 0,
  weak: 1,
  promising: 2,
  robust: 3,
};

function rankConfidence(confidence: ResearchConfidence): number {
  return CONFIDENCE_RANK[confidence];
}

function minConfidence(
  left: ResearchConfidence,
  right: ResearchConfidence,
): ResearchConfidence {
  return rankConfidence(left) <= rankConfidence(right) ? left : right;
}

function metricsFromRound(round: ResearchRunnerRound): ResearchEvidenceMetrics {
  const summary = round.backtest?.summary;
  return {
    returnPct: getMetric(summary, 'returnPct'),
    sharpeRatio: getMetric(summary, 'sharpeRatio'),
    sortinoRatio: getMetric(summary, 'sortinoRatio'),
    maxDrawdown: getMetric(summary, 'maxDrawdown'),
    profitFactor: getMetric(summary, 'profitFactor'),
    totalPositions: getMetric(summary, 'totalPositions'),
  };
}

function riskFlag(
  code: string,
  severity: ResearchRiskFlag['severity'],
  message: string,
  round?: number,
): ResearchRiskFlag {
  return {
    code,
    severity,
    message,
    ...(round !== undefined ? { round } : {}),
  };
}

function buildRoundRiskFlags(
  round: number,
  metrics: ResearchEvidenceMetrics,
): ResearchRiskFlag[] {
  const flags: ResearchRiskFlag[] = [];
  const t = EVALUATION_THRESHOLDS;

  if (metrics.totalPositions <= 0) {
    flags.push(
      riskFlag(
        'zero_trades',
        'blocker',
        'The strategy produced no trades, so there is no usable evidence.',
        round,
      ),
    );
  } else if (metrics.totalPositions < t.totalPositions.small) {
    flags.push(
      riskFlag(
        'small_sample',
        'warning',
        'Trade sample is too small for reliable comparison.',
        round,
      ),
    );
  } else if (metrics.totalPositions < t.totalPositions.limited) {
    flags.push(
      riskFlag(
        'limited_sample',
        'info',
        'Trade sample is usable for exploration but still early.',
        round,
      ),
    );
  }

  if (metrics.profitFactor > 0 && metrics.profitFactor < 1) {
    flags.push(
      riskFlag(
        'negative_profit_structure',
        'blocker',
        'Profit factor is below 1, indicating gross losses exceed gross profits.',
        round,
      ),
    );
  } else if (
    metrics.profitFactor > 0 &&
    metrics.profitFactor < t.profitFactor.thin
  ) {
    flags.push(
      riskFlag(
        'thin_profit_factor',
        'warning',
        'Profit factor is marginal for an early research candidate.',
        round,
      ),
    );
  }

  if (metrics.sharpeRatio <= 0) {
    flags.push(
      riskFlag(
        'weak_risk_adjusted_return',
        'warning',
        'Sharpe ratio is non-positive.',
        round,
      ),
    );
  } else if (metrics.sharpeRatio < t.sharpeRatio.low) {
    flags.push(
      riskFlag(
        'low_sharpe',
        'info',
        'Sharpe ratio is below the promising threshold.',
        round,
      ),
    );
  }

  if (metrics.maxDrawdown >= t.maxDrawdown.blocker) {
    flags.push(
      riskFlag(
        'excessive_drawdown',
        'blocker',
        'Max drawdown is too high for a research candidate.',
        round,
      ),
    );
  } else if (metrics.maxDrawdown > t.maxDrawdown.elevated) {
    flags.push(
      riskFlag(
        'elevated_drawdown',
        'warning',
        'Max drawdown is above the promising threshold.',
        round,
      ),
    );
  }

  return flags;
}

function classifyRound(
  metrics: ResearchEvidenceMetrics,
  score: ScoreBreakdown,
  flags: readonly ResearchRiskFlag[],
): ResearchConfidence {
  if (flags.some((flag) => flag.severity === 'blocker')) {
    return 'reject';
  }

  const t = EVALUATION_THRESHOLDS;

  if (
    metrics.totalPositions >= t.totalPositions.robust &&
    metrics.sharpeRatio >= t.sharpeRatio.robust &&
    metrics.profitFactor >= t.profitFactor.robust &&
    metrics.maxDrawdown <= t.maxDrawdown.robust
  ) {
    return 'robust';
  }

  if (
    metrics.totalPositions >= t.totalPositions.promising &&
    metrics.profitFactor >= t.profitFactor.promising &&
    metrics.maxDrawdown <= t.maxDrawdown.promising &&
    (score.total > 0 || metrics.sharpeRatio >= t.sharpeRatio.promising)
  ) {
    return 'promising';
  }

  return 'weak';
}

function decisionForConfidence(
  confidence: ResearchConfidence,
): ResearchDecision {
  if (confidence === 'robust') {
    return 'keep_candidate';
  }

  if (confidence === 'reject') {
    return 'reject_candidate';
  }

  return 'continue_iterating';
}

function strengthsForRound(
  confidence: ResearchConfidence,
  metrics: ResearchEvidenceMetrics,
): string[] {
  const strengths: string[] = [];
  const t = EVALUATION_THRESHOLDS;

  if (confidence === 'robust') {
    strengths.push('Round meets the research robustness threshold.');
  } else if (confidence === 'promising') {
    strengths.push('Round has enough early evidence to continue research.');
  }

  if (metrics.totalPositions >= t.totalPositions.robust) {
    strengths.push('Trade sample is large enough for first-pass comparison.');
  }

  if (metrics.profitFactor >= t.profitFactor.robust) {
    strengths.push('Profit factor shows a constructive profit/loss structure.');
  }

  if (metrics.sharpeRatio >= t.sharpeRatio.robust) {
    strengths.push('Risk-adjusted return is usable for early research.');
  }

  return strengths.length > 0
    ? strengths
    : ['Round completed and produced measurable evidence.'];
}

function weaknessesForRound(
  flags: readonly ResearchRiskFlag[],
): ResearchWeakness[] {
  if (flags.length === 0) {
    return [
      {
        code: 'no_major_risk',
        message: 'No major first-pass evidence risks were detected.',
      },
    ];
  }

  return flags.map((flag) => ({ code: flag.code, message: flag.message }));
}

function confidenceFromRounds(
  rounds: readonly ResearchRoundEvaluation[],
): ResearchConfidence {
  if (rounds.some((round) => round.confidence === 'robust')) {
    return 'robust';
  }

  if (rounds.some((round) => round.confidence === 'promising')) {
    return 'promising';
  }

  if (rounds.some((round) => round.confidence === 'weak')) {
    return 'weak';
  }

  return 'reject';
}

function championEvaluation(
  result: ResearchRunnerResult,
  rounds: readonly ResearchRoundEvaluation[],
): ResearchRoundEvaluation | undefined {
  if (result.championRound !== undefined) {
    const found = rounds.find((round) => round.round === result.championRound);
    if (found) {
      return found;
    }
  }

  return [...rounds].sort((left, right) => {
    const confidenceDelta =
      rankConfidence(right.confidence) - rankConfidence(left.confidence);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }

    return right.score.total - left.score.total;
  })[0];
}

function failedRoundFlags(round: ResearchRunnerRound): {
  flags: ResearchRiskFlag[];
  failureReasons: string[];
} {
  const rawReason = round.failure?.reason ?? 'round_failed';
  const code = KNOWN_STOP_REASONS.has(rawReason) ? rawReason : 'round_failed';
  return {
    flags: [
      riskFlag(
        code,
        'blocker',
        `Round ${round.round} did not produce backtest evidence: ${rawReason}.`,
        round.round,
      ),
    ],
    failureReasons: [rawReason],
  };
}

export function evaluateResearchRound(
  round: ResearchRunnerRound,
): ResearchRoundEvaluation {
  const metrics = metricsFromRound(round);
  const score = round.score ?? buildScoreBreakdown(round.backtest?.summary);
  const riskFlags = buildRoundRiskFlags(round.round, metrics);
  const confidence = classifyRound(metrics, score, riskFlags);

  return {
    round: round.round,
    status: round.status,
    confidence,
    decision: decisionForConfidence(confidence),
    metrics,
    score,
    riskFlags,
    strengths: strengthsForRound(confidence, metrics),
    weaknesses: weaknessesForRound(riskFlags),
  };
}

export function buildResearchVerdict(
  evaluation: Omit<ResearchResultEvaluation, 'verdict'>,
): ResearchVerdict {
  if (evaluation.rounds.length === 0) {
    return {
      decision: 'reject_candidate',
      summary: 'No completed research rounds produced backtest evidence.',
      nextAction:
        'Repair validation or execution failures before making a strategy judgment.',
    };
  }

  const champion = evaluation.championRound
    ? evaluation.rounds.find(
        (round) => round.round === evaluation.championRound,
      )
    : undefined;
  const confidence = champion
    ? minConfidence(evaluation.confidence, champion.confidence)
    : evaluation.confidence;
  const weakOrRejected = evaluation.rounds.every(
    (round) => round.confidence === 'weak' || round.confidence === 'reject',
  );

  if (weakOrRejected && evaluation.rounds.length > 1) {
    return {
      decision: 'rethink_thesis',
      summary:
        'Completed rounds did not produce a promising evidence profile across iterations.',
      nextAction:
        'Stop micro-tuning and revise the core thesis before running more backtests.',
    };
  }

  if (confidence === 'robust') {
    return {
      decision: 'keep_candidate',
      summary: 'Champion round meets the first-pass research robustness bar.',
      nextAction:
        'Keep this candidate and move to baseline or robustness evaluation next.',
    };
  }

  if (confidence === 'promising') {
    return {
      decision: 'continue_iterating',
      summary: 'Champion round has promising early evidence but is not robust.',
      nextAction:
        'Continue with one targeted revision or run external robustness checks.',
    };
  }

  if (confidence === 'weak') {
    return {
      decision: 'continue_iterating',
      summary: 'Champion round is weak and should not be treated as robust.',
      nextAction:
        'Make one evidence-driven revision, or rethink the thesis if weakness repeats.',
    };
  }

  return {
    decision: 'reject_candidate',
    summary: 'Champion round should be rejected based on first-pass evidence.',
    nextAction:
      'Reject this candidate or repair the strategy before running another round.',
  };
}

export function evaluateResearchResult(
  result: ResearchRunnerResult,
): ResearchResultEvaluation {
  const rounds = result.rounds
    .filter((round) => round.status === 'completed')
    .map(evaluateResearchRound);
  const failed = result.rounds
    .filter((round) => round.status !== 'completed')
    .map(failedRoundFlags);
  const failedFlags = failed.flatMap((entry) => entry.flags);
  const failureReasons = [
    ...(result.failure?.reason ? [result.failure.reason] : []),
    ...failed.flatMap((entry) => entry.failureReasons),
  ];
  const champion = championEvaluation(result, rounds);
  const baseConfidence = confidenceFromRounds(rounds);
  const confidence = champion
    ? minConfidence(baseConfidence, champion.confidence)
    : 'reject';
  const riskFlags = [
    ...failedFlags,
    ...rounds.flatMap((round) => round.riskFlags),
  ];
  const partial: Omit<ResearchResultEvaluation, 'verdict'> = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    runId: result.runId,
    status: result.status,
    confidence,
    ...(champion ? { championRound: champion.round } : {}),
    rounds,
    riskFlags,
    failureReasons,
  };

  return {
    ...partial,
    verdict: buildResearchVerdict(partial),
  };
}
