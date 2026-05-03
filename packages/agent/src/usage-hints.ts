import type { TraseqPublicAgentLink } from '@traseq/sdk';

import { TRASEQ_APP_URL } from './env.js';
import { asJsonObject, asNumber } from './normalize.js';
import type { JsonObject } from './types.js';

export type UsageHintLevel = 'ok' | 'low' | 'exhausted';

export type UsageHintTier = 'free' | 'plus' | 'pro' | 'team' | 'unknown';

export type UsageHintUnit = 'count' | 'usd';

export type UsageBottleneckResource =
  | 'budget'
  | 'strategies'
  | 'retainedStrategies'
  | 'savedResults';

export interface UsageBottleneck {
  resource: UsageBottleneckResource;
  used: number;
  limit: number;
  remaining: number;
  unit: UsageHintUnit;
  // Count resources only ever surface as 'exhausted' — see classifyCount for
  // why. Budget keeps both brackets because USD consumption is gradual.
  level: 'low' | 'exhausted';
}

/**
 * Mirrors the backend's `TraseqPublicAgentMetadata` shape so error-path and
 * success-path consumers see one contract. `nextSteps` is ordered: cleanup
 * remediation comes first (cheaper, reversible), upgrade comes last.
 */
export interface UsageStatus {
  level: UsageHintLevel;
  tier: UsageHintTier;
  bottlenecks: UsageBottleneck[];
  message: string;
  nextSteps: string[];
  links: TraseqPublicAgentLink[];
}

export interface SummarizeUsageHintsInput {
  usage?: unknown;
  workspace?: unknown;
  /** Override the workspace tier (skips workspace.subscription lookup). */
  tier?: string;
  /**
   * Manifest from `getManifest()`, used to resolve the frontend base URL for
   * cleanup/upgrade deeplinks. When absent or missing `appBaseUrl`, falls
   * back to the hardcoded `TRASEQ_APP_URL` constant.
   *
   * Always prefer wiring the manifest through — the backend is the only
   * authoritative source of the frontend it's bound to (dev/staging/prod).
   */
  manifest?: unknown;
}

/**
 * Resolve the frontend base URL for deeplink construction. Manifest is the
 * source of truth (the backend knows which frontend it's bound to); the
 * hardcoded constant is only the fallback for missing or malformed
 * `manifest.appBaseUrl` values.
 *
 * Defense-in-depth: the manifest comes from a trusted server, but a
 * misconfigured or buggy server could emit a non-http(s) value (e.g.
 * `javascript:`, `file:`) that would otherwise land directly in `link.href`.
 * Reject anything that does not parse as an absolute http(s) URL.
 */
function resolveAppBaseUrl(manifest: unknown): string {
  const value = asJsonObject(manifest)?.appBaseUrl;
  if (typeof value !== 'string') return TRASEQ_APP_URL;
  const trimmed = value.trim();
  if (trimmed.length === 0) return TRASEQ_APP_URL;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return TRASEQ_APP_URL;
    }
    return trimmed;
  } catch {
    return TRASEQ_APP_URL;
  }
}

const PAID_TIERS = ['plus', 'pro', 'team'] as const satisfies readonly Exclude<
  UsageHintTier,
  'unknown' | 'free'
>[];
const TIER_ORDER: UsageHintTier[] = ['free', ...PAID_TIERS];
const DEFAULT_PAID_TIER: (typeof PAID_TIERS)[number] = 'plus';

// Budget classification thresholds. Mirrors the soft/hard distinction the
// backend's EntitlementGuard already enforces, surfaced one bracket earlier so
// the user sees the upgrade hint before the next operation is rejected.
const BUDGET_LOW_RATIO = 0.8;
const BUDGET_EXHAUSTED_RATIO = 0.95;

// Hard-count limits (strategies, saved results) are sharp cliffs, not a slope:
// the user can do nothing partial about a "running low" warning when remaining
// is 1 of 3, and the message reads as alarmist on tiny caps. Only surface
// count bottlenecks once the cap is fully exhausted. Budget keeps its "low"
// bracket — gradual USD consumption is where advance warning is actionable.

// Verbatim with the backend's EntitlementGuard error nextSteps so the same
// string lands on both the success and error path. Diverging copy here would
// silently fork the product surface.
const COPY = {
  strategies: {
    exhaustedCleanup:
      'Move unused active strategies to Trash using trash_strategy with confirm=true.',
    exhaustedUpgrade: 'Upgrade the workspace plan for more strategy capacity.',
  },
  retainedStrategies: {
    exhaustedCleanup:
      'Wait for the 30-day Trash retention cleanup to permanently purge old strategies.',
    exhaustedUpgrade:
      'Upgrade the workspace plan for more retained strategy capacity.',
  },
  savedResults: {
    exhaustedCleanup: 'Delete old saved results that are no longer needed.',
    exhaustedUpgrade:
      'Upgrade the workspace plan for more saved result capacity.',
  },
  budget: {
    exhausted:
      'Wait for the next billing period to reset, or upgrade the workspace plan for more research credits.',
    low: 'Plan remaining work for this period carefully, or upgrade for more research credits.',
  },
} as const;

function normalizeTier(value: unknown): UsageHintTier {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const lower = value.trim().toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(lower)
    ? (lower as UsageHintTier)
    : 'unknown';
}

function nextPaidTier(
  tier: UsageHintTier,
): (typeof PAID_TIERS)[number] | undefined {
  if (tier === 'team') {
    return undefined;
  }
  const currentRank = tier === 'unknown' ? 0 : TIER_ORDER.indexOf(tier);
  const minimumRank = TIER_ORDER.indexOf(DEFAULT_PAID_TIER);
  const targetRank = Math.max(
    minimumRank,
    Math.min(currentRank + 1, TIER_ORDER.length - 1),
  );
  const target = TIER_ORDER[targetRank];
  return target === 'free'
    ? DEFAULT_PAID_TIER
    : (target as (typeof PAID_TIERS)[number]);
}

function appUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
): string {
  // Construct absolute URL without depending on global URL polyfills; mirror
  // backend's publicAgentBillingPlanLink query layout so error-path and
  // success-path links land on the same upgrade flow.
  const base = baseUrl.replace(/\/+$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  if (!params) {
    return `${base}${trimmedPath}`;
  }
  const query = new URLSearchParams(params).toString();
  return query ? `${base}${trimmedPath}?${query}` : `${base}${trimmedPath}`;
}

function buildUsageLink(baseUrl: string): TraseqPublicAgentLink {
  return {
    rel: 'usage',
    label: 'Review workspace usage',
    href: appUrl(baseUrl, '/settings/usage'),
  };
}

function buildBillingPlanLink(
  baseUrl: string,
  targetTier: (typeof PAID_TIERS)[number],
): TraseqPublicAgentLink {
  return {
    rel: 'billing_plan',
    label: 'Compare workspace plans',
    href: appUrl(baseUrl, '/settings/billing/plan', {
      targetTier,
      billingCycle: 'monthly',
      entrySource: 'public_agent_limit',
      autoOpen: '1',
    }),
  };
}

function buildManageStrategiesLink(baseUrl: string): TraseqPublicAgentLink {
  return {
    rel: 'manage_strategies',
    label: 'Manage strategies',
    href: appUrl(baseUrl, '/strategies'),
  };
}

function buildManageBacktestsLink(baseUrl: string): TraseqPublicAgentLink {
  return {
    rel: 'manage_backtests',
    label: 'Manage saved backtests',
    href: appUrl(baseUrl, '/backtests'),
  };
}

function classifyBudget(
  budget: JsonObject | undefined,
): UsageBottleneck | undefined {
  if (!budget) {
    return undefined;
  }

  const totalUsd = asNumber(budget.totalUsd);
  const usedUsd = asNumber(budget.usedUsd);
  const remainingUsd = asNumber(budget.remainingUsd);

  if (totalUsd === undefined || usedUsd === undefined || totalUsd <= 0) {
    return undefined;
  }

  const remaining = remainingUsd ?? Math.max(0, totalUsd - usedUsd);
  const ratio = usedUsd / totalUsd;

  let level: UsageBottleneck['level'] | undefined;
  if (ratio >= BUDGET_EXHAUSTED_RATIO || remaining <= 0) {
    level = 'exhausted';
  } else if (ratio >= BUDGET_LOW_RATIO) {
    level = 'low';
  }

  if (!level) {
    return undefined;
  }

  return {
    resource: 'budget',
    used: usedUsd,
    limit: totalUsd,
    remaining: Math.max(0, remaining),
    unit: 'usd',
    level,
  };
}

function classifyCount(
  resource: Exclude<UsageBottleneckResource, 'budget'>,
  limit: JsonObject | undefined,
): UsageBottleneck | undefined {
  if (!limit) {
    return undefined;
  }

  const used = asNumber(limit.used);
  const max = asNumber(limit.max);
  const remaining = asNumber(limit.remaining);

  if (used === undefined || max === undefined || max <= 0) {
    return undefined;
  }

  const computedRemaining = remaining ?? Math.max(0, max - used);
  const exceeded =
    limit.exceeded === true || computedRemaining <= 0 || used >= max;

  if (!exceeded) {
    return undefined;
  }

  return {
    resource,
    used,
    limit: max,
    remaining: Math.max(0, computedRemaining),
    unit: 'count',
    level: 'exhausted',
  };
}

function describeBottleneck(bottleneck: UsageBottleneck): string {
  if (bottleneck.unit === 'usd') {
    return `research budget $${bottleneck.used.toFixed(2)} / $${bottleneck.limit.toFixed(2)} used ($${bottleneck.remaining.toFixed(2)} left)`;
  }
  const noun =
    bottleneck.resource === 'strategies'
      ? 'strategies'
      : bottleneck.resource === 'retainedStrategies'
        ? 'retained strategies'
        : 'saved results';
  return `${noun} ${bottleneck.used} / ${bottleneck.limit} used (${bottleneck.remaining} left)`;
}

function buildMessage(
  level: Exclude<UsageHintLevel, 'ok'>,
  bottlenecks: UsageBottleneck[],
): string {
  const summary = bottlenecks.map(describeBottleneck).join('; ');
  if (level === 'exhausted') {
    return `Workspace usage exhausted: ${summary}. Further write or backtest operations on the current plan will be blocked until usage resets or the plan is upgraded.`;
  }
  return `Workspace usage running low: ${summary}. Subsequent operations may hit plan limits during this billing period.`;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function dedupeLinks(
  values: readonly TraseqPublicAgentLink[],
): TraseqPublicAgentLink[] {
  const seen = new Set<string>();
  const out: TraseqPublicAgentLink[] = [];
  for (const link of values) {
    const key = `${link.rel}|${link.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

function remediationFor(
  bottleneck: UsageBottleneck,
  baseUrl: string,
): {
  cleanupSteps: string[];
  upgradeSteps: string[];
  cleanupLinks: TraseqPublicAgentLink[];
} {
  if (bottleneck.resource === 'budget') {
    return {
      cleanupSteps: [],
      upgradeSteps: [
        bottleneck.level === 'exhausted'
          ? COPY.budget.exhausted
          : COPY.budget.low,
      ],
      cleanupLinks: [],
    };
  }

  // Count resources only ever surface as 'exhausted' — classifyCount drops the
  // 'low' bracket entirely. No 'low' branch needed here.
  const copy =
    bottleneck.resource === 'strategies'
      ? COPY.strategies
      : bottleneck.resource === 'retainedStrategies'
        ? COPY.retainedStrategies
        : COPY.savedResults;
  const cleanupLink =
    bottleneck.resource === 'strategies' ||
    bottleneck.resource === 'retainedStrategies'
      ? buildManageStrategiesLink(baseUrl)
      : buildManageBacktestsLink(baseUrl);

  return {
    cleanupSteps: [copy.exhaustedCleanup],
    upgradeSteps: [copy.exhaustedUpgrade],
    cleanupLinks: [cleanupLink],
  };
}

function buildRemediation(
  level: Exclude<UsageHintLevel, 'ok'>,
  tier: UsageHintTier,
  bottlenecks: UsageBottleneck[],
  baseUrl: string,
): { nextSteps: string[]; links: TraseqPublicAgentLink[] } {
  const cleanupSteps: string[] = [];
  const upgradeSteps: string[] = [];
  const cleanupLinks: TraseqPublicAgentLink[] = [];

  for (const bottleneck of bottlenecks) {
    const {
      cleanupSteps: cs,
      upgradeSteps: us,
      cleanupLinks: cl,
    } = remediationFor(bottleneck, baseUrl);
    cleanupSteps.push(...cs);
    upgradeSteps.push(...us);
    cleanupLinks.push(...cl);
  }

  void level;

  const nextSteps = dedupeStrings([...cleanupSteps, ...upgradeSteps]);

  const links: TraseqPublicAgentLink[] = [];
  links.push(...cleanupLinks);
  links.push(buildUsageLink(baseUrl));

  const targetTier = nextPaidTier(tier);
  if (targetTier) {
    links.push(buildBillingPlanLink(baseUrl, targetTier));
  }

  return { nextSteps, links: dedupeLinks(links) };
}

export function summarizeUsageHints(
  input: SummarizeUsageHintsInput,
): UsageStatus {
  const usage = asJsonObject(input.usage);
  const workspace = asJsonObject(input.workspace);
  const subscription = asJsonObject(workspace?.subscription);
  const tier = normalizeTier(input.tier ?? subscription?.tier);
  const baseUrl = resolveAppBaseUrl(input.manifest);

  const budget = asJsonObject(usage?.budget);
  const limits = asJsonObject(usage?.limits);

  const bottlenecks: UsageBottleneck[] = [];

  const budgetBottleneck = classifyBudget(budget);
  if (budgetBottleneck) {
    bottlenecks.push(budgetBottleneck);
  }

  const strategiesBottleneck = classifyCount(
    'strategies',
    asJsonObject(limits?.strategies),
  );
  if (strategiesBottleneck) {
    bottlenecks.push(strategiesBottleneck);
  }

  const retainedStrategiesBottleneck = classifyCount(
    'retainedStrategies',
    asJsonObject(limits?.retainedStrategies),
  );
  if (retainedStrategiesBottleneck) {
    bottlenecks.push(retainedStrategiesBottleneck);
  }

  const savedResultsBottleneck = classifyCount(
    'savedResults',
    asJsonObject(limits?.savedResults),
  );
  if (savedResultsBottleneck) {
    bottlenecks.push(savedResultsBottleneck);
  }

  const level: UsageHintLevel = bottlenecks.some((b) => b.level === 'exhausted')
    ? 'exhausted'
    : bottlenecks.length > 0
      ? 'low'
      : 'ok';

  if (level === 'ok') {
    return {
      level,
      tier,
      bottlenecks: [],
      message: 'Workspace has headroom on budget and stored-result limits.',
      nextSteps: [],
      links: [],
    };
  }

  const remediation = buildRemediation(level, tier, bottlenecks, baseUrl);

  return {
    level,
    tier,
    bottlenecks,
    message: buildMessage(level, bottlenecks),
    nextSteps: remediation.nextSteps,
    links: remediation.links,
  };
}

export function renderUsageStatusMarkdown(status: UsageStatus): string[] {
  if (status.level === 'ok') {
    return [];
  }

  const headline =
    status.level === 'exhausted'
      ? 'Workspace usage is exhausted for this billing period.'
      : 'Workspace usage is running low for this billing period.';

  const lines: string[] = [
    '## Workspace Usage',
    '',
    `- **Status:** ${status.level} (tier: ${status.tier})`,
    `- **Why:** ${headline}`,
  ];

  if (status.bottlenecks.length > 0) {
    lines.push('- **Bottlenecks:**');
    for (const bottleneck of status.bottlenecks) {
      lines.push(`  - ${describeBottleneck(bottleneck)} — ${bottleneck.level}`);
    }
  }

  if (status.nextSteps.length > 0) {
    lines.push('- **Next steps:**');
    for (const step of status.nextSteps) {
      lines.push(`  - ${step}`);
    }
  }

  if (status.links.length > 0) {
    lines.push('- **Links:**');
    for (const link of status.links) {
      lines.push(`  - **${link.label}:** [Open](${link.href})`);
    }
  }

  lines.push('');
  return lines;
}
