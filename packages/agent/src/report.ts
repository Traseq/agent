import { evaluateResearchResult } from './evaluation.js';
import type {
  ResearchArtifactBundle,
  ResearchConfidence,
  ResearchDecision,
  ResearchResultEvaluation,
  ResearchRunnerResult,
  ResearchRoundEvaluation,
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

function roundSection(round: ResearchRoundEvaluation): string[] {
  return [
    `## Round ${round.round}`,
    '',
    `- **Confidence:** ${humanizeConfidence(round.confidence)}`,
    `- **Decision:** ${humanizeDecision(round.decision)}`,
    `- **Score:** ${number(round.score.total)}`,
    `- **Return:** ${pct(round.metrics.returnPct)}`,
    `- **Sharpe:** ${number(round.metrics.sharpeRatio)}`,
    `- **Profit factor:** ${number(round.metrics.profitFactor)}`,
    `- **Max drawdown:** ${pct(round.metrics.maxDrawdown)}`,
    `- **Trades:** ${round.metrics.totalPositions}`,
    '',
    'Strengths:',
    ...lineList(round.strengths),
    '',
    'Weaknesses:',
    ...lineList(round.weaknesses.map((item) => item.message)),
  ];
}

export function formatResearchReport(
  result: ResearchRunnerResult,
  evaluation: ResearchResultEvaluation = evaluateResearchResult(result),
): string {
  const input = result.input;
  const lines = [
    '# Traseq Research Report',
    '',
    '## Summary',
    '',
    `- **Run ID:** ${result.runId}`,
    `- **Prompt:** ${input.prompt}`,
    `- **Instrument:** ${input.instrument}`,
    `- **Timeframe:** ${input.timeframe}`,
    `- **Runner status:** ${result.status}`,
    `- **Evaluation confidence:** ${humanizeConfidence(evaluation.confidence)}`,
    `- **Champion round:** ${evaluation.championRound ?? 'none'}`,
    '',
    '## Verdict',
    '',
    `- **Confidence:** ${humanizeConfidence(evaluation.confidence)}`,
    `- **Decision:** ${humanizeDecision(evaluation.verdict.decision)}`,
    `- **Summary:** ${evaluation.verdict.summary}`,
    `- **Next action:** ${evaluation.verdict.nextAction}`,
    '',
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
    ...evaluation.rounds.flatMap((round) => [...roundSection(round), '']),
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
