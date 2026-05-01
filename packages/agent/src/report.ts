import { evaluateResearchResult } from './evaluation.js';
import {
  renderUsageStatusMarkdown,
  summarizeUsageHints,
  type UsageStatus,
} from './usage-hints.js';
import type {
  ResearchArtifactBundle,
  ResearchConfidence,
  ResearchDecision,
  ResearchResultEvaluation,
  ResearchRunnerResult,
  ResearchRoundEvaluation,
  NormalizedBacktestAppLinks,
  NormalizedBacktestResult,
  NormalizedBacktestRunContext,
} from './types.js';

const CONFIDENCE_LABEL: Record<ResearchConfidence, string> = {
  robust: 'Robust',
  promising: 'Promising',
  weak: 'Weak',
  reject: 'Reject',
};

const DECISION_LABEL: Record<ResearchDecision, string> = {
  keep_candidate: 'Keep candidate',
  continue_iterating: 'Continue iterating',
  rethink_thesis: 'Rethink thesis',
  reject_candidate: 'Reject candidate',
};

function humanizeConfidence(value: ResearchConfidence): string {
  return `${CONFIDENCE_LABEL[value]} (\`${value}\`)`;
}

function humanizeDecision(value: ResearchDecision): string {
  return `${DECISION_LABEL[value]} (\`${value}\`)`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function number(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

// runId is currently produced by randomUUID(), but the bundle path is part of
// the public surface (callers may persist artifacts at this exact path). Sanitize
// defensively so we never emit a path segment that breaks `.traseq/research/<id>`.
function safePathSegment(value: string): string {
  const trimmed = value.trim();
  const safe = trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'research-run';
}

function lineList(items: readonly string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ['- None'];
}

// Picks the backtest that should represent an engagement for navigation +
// "what we tested" framing. Prefers the evaluation's champion round, falls
// back to the result-level pointer, then to the first round with a backtest.
export function representativeBacktest(
  result: ResearchRunnerResult,
  evaluation?: ResearchResultEvaluation,
): NormalizedBacktestResult | undefined {
  const championRound = evaluation?.championRound ?? result.championRound;
  const champion =
    championRound !== undefined
      ? result.rounds.find(
          (round) => round.round === championRound && round.backtest,
        )?.backtest
      : undefined;

  return (
    champion ??
    result.rounds.find((round) => round.backtest)?.backtest ??
    undefined
  );
}

// Heuristic: timestamps below this magnitude are interpreted as Unix seconds
// rather than milliseconds. 1e12 ms ≈ year 2001, 1e12 s ≈ year 33658, so any
// realistic timestamp lands cleanly on one side. Backend currently always
// emits ms, but agent normalize() also accepts older fixtures.
const MS_TIMESTAMP_THRESHOLD = 1e12;

function formatRangePoint(value: number | string | null | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis =
      Math.abs(value) < MS_TIMESTAMP_THRESHOLD ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

function formatRange(
  range: NormalizedBacktestRunContext['range'] | undefined,
): string {
  if (!range) {
    return 'not specified';
  }
  return `${formatRangePoint(range.start)} to ${formatRangePoint(range.end)}`;
}

function formatOpenInTraseq(
  links: NormalizedBacktestAppLinks | undefined,
): string[] {
  if (!links) {
    return [];
  }

  const rows = [
    ['Backtest', links.backtest],
    ['Charts', links.backtestCharts],
    ['Trades', links.backtestTrades],
    ['Analytics', links.backtestAnalytics],
    ['Strategy', links.strategy],
    ['All backtests for strategy', links.strategyBacktests],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (rows.length === 0) {
    return [];
  }

  return [
    '## Open in Traseq',
    '',
    ...rows.map(([label, href]) => `- **${label}:** [Open](${href})`),
    '',
  ];
}

function roundEvidenceSection(round: ResearchRoundEvaluation): string[] {
  return [
    `### Round ${round.round}`,
    '',
    `- Confidence: ${humanizeConfidence(round.confidence)}`,
    `- Decision: ${humanizeDecision(round.decision)}`,
    `- Score: ${number(round.score.total)}`,
    `- Return: ${pct(round.metrics.returnPct)}`,
    `- Sharpe: ${number(round.metrics.sharpeRatio)}`,
    `- Profit factor: ${number(round.metrics.profitFactor)}`,
    `- Max drawdown: ${pct(round.metrics.maxDrawdown)}`,
    `- Trades: ${round.metrics.totalPositions}`,
    '',
    'Strengths',
    ...lineList(round.strengths),
    '',
    'Weaknesses',
    ...lineList(round.weaknesses.map((item) => item.message)),
  ];
}

export interface FormatResearchReportOptions {
  /**
   * Pre-computed usage status. If omitted, derived from `result.live.usage`
   * and `result.live.workspace` so the upgrade hint stays in lock-step with
   * the live snapshot the runner already captured.
   */
  usageStatus?: UsageStatus;
}

export function formatResearchReport(
  result: ResearchRunnerResult,
  evaluation: ResearchResultEvaluation = evaluateResearchResult(result),
  options: FormatResearchReportOptions = {},
): string {
  const input = result.input;
  const backtest = representativeBacktest(result, evaluation);
  const runContext = backtest?.runContext;
  const instrument = runContext?.instrument.symbol ?? input.instrument;
  const timeframe = runContext?.timeframe ?? input.timeframe;
  const initialBalance =
    runContext?.initialBalance ?? input.initialBalance ?? undefined;
  const evidenceLines =
    evaluation.rounds.length > 0
      ? evaluation.rounds.flatMap((round) => [
          ...roundEvidenceSection(round),
          '',
        ])
      : ['- No completed rounds produced backtest evidence.', ''];
  const usageStatus =
    options.usageStatus ??
    summarizeUsageHints({
      usage: result.live.usage,
      workspace: result.live.workspace,
      manifest: result.live.manifest,
    });
  const usageSection = renderUsageStatusMarkdown(usageStatus);
  const lines = [
    '# Traseq Guided Research Memo',
    '',
    'This memo summarizes historical research evidence only. It is not investment advice, trade execution guidance, or live-trading approval.',
    '',
    '## Executive Verdict',
    '',
    `- **Run ID:** ${result.runId}`,
    `- **Runner status:** ${result.status}`,
    `- **Evaluation confidence:** ${humanizeConfidence(evaluation.confidence)}`,
    `- **Champion round:** ${evaluation.championRound ?? 'none'}`,
    '',
    ...formatOpenInTraseq(backtest?.appLinks),
    ...usageSection,
    '## What We Tested',
    '',
    `- **Prompt:** ${input.prompt}`,
    `- **Instrument:** ${instrument}`,
    `- **Timeframe:** ${timeframe}`,
    `- **Backtest range:** ${formatRange(runContext?.range)}`,
    `- **Initial balance:** ${initialBalance ?? 'not specified'}`,
    `- **Strategy version:** ${runContext?.strategyVersionId ?? 'not specified'}`,
    `- **Position style:** ${input.positionStyle}`,
    `- **Objective:** ${input.objective}`,
    '',
    '## Evidence',
    '',
    ...evidenceLines,
    '## Risk Flags',
    '',
    ...lineList(
      evaluation.riskFlags.map(
        (flag) =>
          `${flag.severity.toUpperCase()} ${flag.code}${
            flag.round !== undefined ? ` (round ${flag.round})` : ''
          }: ${flag.message}`,
      ),
    ),
    '',
    '## Decision',
    '',
    `- **Decision:** ${humanizeDecision(evaluation.verdict.decision)}`,
    `- **Summary:** ${evaluation.verdict.summary}`,
    '',
    '## Recommended Next Step',
    '',
    evaluation.verdict.nextAction,
  ];

  return `${lines.join('\n').trim()}\n`;
}

export function buildResearchArtifactBundle(
  result: ResearchRunnerResult,
  evaluation: ResearchResultEvaluation = evaluateResearchResult(result),
): ResearchArtifactBundle {
  const root = `.traseq/research/${safePathSegment(result.runId)}`;
  const report = formatResearchReport(result, evaluation);

  return {
    root,
    files: [
      {
        path: `${root}/result.json`,
        mediaType: 'application/json',
        contents: `${JSON.stringify(result, null, 2)}\n`,
      },
      {
        path: `${root}/evaluation.json`,
        mediaType: 'application/json',
        contents: `${JSON.stringify(evaluation, null, 2)}\n`,
      },
      {
        path: `${root}/report.md`,
        mediaType: 'text/markdown',
        contents: report,
      },
    ],
  };
}
