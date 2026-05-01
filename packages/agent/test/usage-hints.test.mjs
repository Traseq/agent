import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderUsageStatusMarkdown,
  summarizeUsageHints,
} from '../dist/index.js';

function freeWorkspace() {
  return { subscription: { tier: 'free' } };
}

function teamWorkspace() {
  return { subscription: { tier: 'team' } };
}

function usage({
  used = 0,
  total = 1,
  strategiesUsed = 0,
  strategiesMax = 3,
  retainedStrategiesUsed = 0,
  retainedStrategiesMax = 9,
  savedUsed = 0,
  savedMax = 10,
} = {}) {
  return {
    billingPeriod: { start: '2026-04-01', end: '2026-05-01' },
    budget: {
      totalUsd: total,
      usedUsd: used,
      remainingUsd: Math.max(0, total - used),
    },
    limits: {
      strategies: {
        used: strategiesUsed,
        max: strategiesMax,
        remaining: Math.max(0, strategiesMax - strategiesUsed),
        exceeded: strategiesUsed >= strategiesMax,
      },
      retainedStrategies: {
        used: retainedStrategiesUsed,
        max: retainedStrategiesMax,
        remaining: Math.max(0, retainedStrategiesMax - retainedStrategiesUsed),
        exceeded: retainedStrategiesUsed >= retainedStrategiesMax,
      },
      savedResults: {
        used: savedUsed,
        max: savedMax,
        remaining: Math.max(0, savedMax - savedUsed),
        exceeded: savedUsed >= savedMax,
      },
    },
  };
}

describe('summarizeUsageHints', () => {
  it('returns ok when budget and counts have headroom', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        strategiesUsed: 0,
        savedUsed: 0,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'ok');
    assert.equal(status.tier, 'free');
    assert.deepEqual(status.bottlenecks, []);
    assert.deepEqual(status.nextSteps, []);
    assert.deepEqual(status.links, []);
    assert.deepEqual(renderUsageStatusMarkdown(status), []);
  });

  it('flags low when budget is between 80% and 95% spent (no cleanup link for budget)', () => {
    const status = summarizeUsageHints({
      usage: usage({ used: 0.85, total: 1 }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'low');
    assert.equal(status.bottlenecks.length, 1);
    assert.equal(status.bottlenecks[0].resource, 'budget');
    assert.equal(status.bottlenecks[0].level, 'low');
    assert.equal(
      status.nextSteps[0],
      'Plan remaining work for this period carefully, or upgrade for more research credits.',
    );
    const planLink = status.links.find((link) => link.rel === 'billing_plan');
    assert.ok(planLink);
    assert.match(planLink.href, /targetTier=plus/);
    assert.match(planLink.href, /entrySource=public_agent_limit/);
    assert.ok(
      !status.links.some((link) => link.rel === 'manage_strategies'),
      'budget bottleneck should not surface a strategy cleanup link',
    );
  });

  it('flags exhausted when budget is at or above 95% spent', () => {
    const status = summarizeUsageHints({
      usage: usage({ used: 0.96, total: 1 }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'exhausted');
    assert.equal(status.bottlenecks[0].level, 'exhausted');
    assert.equal(
      status.nextSteps[0],
      'Wait for the next billing period to reset, or upgrade the workspace plan for more research credits.',
    );
  });

  it('exhausted strategies cap surfaces cleanup deeplink + backend-verbatim cleanup nextStep', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        strategiesUsed: 3,
        strategiesMax: 3,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'exhausted');
    assert.equal(status.bottlenecks.length, 1);
    assert.equal(status.bottlenecks[0].resource, 'strategies');
    // Backend verbatim — must match entitlement.guard.ts saved_results_limit_reached/strategy_limit_reached strings.
    assert.deepEqual(status.nextSteps, [
      'Move unused active strategies to Trash using trash_strategy with confirm=true.',
      'Upgrade the workspace plan for more strategy capacity.',
    ]);
    const cleanupLink = status.links.find(
      (link) => link.rel === 'manage_strategies',
    );
    assert.ok(cleanupLink, 'cleanup deeplink for strategies should be present');
    assert.match(cleanupLink.href, /\/strategies$/);
  });

  it('exhausted savedResults cap surfaces cleanup deeplink + backend-verbatim cleanup nextStep', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        savedUsed: 10,
        savedMax: 10,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'exhausted');
    assert.deepEqual(status.nextSteps, [
      'Delete old saved results that are no longer needed.',
      'Upgrade the workspace plan for more saved result capacity.',
    ]);
    const cleanupLink = status.links.find(
      (link) => link.rel === 'manage_backtests',
    );
    assert.ok(cleanupLink);
    assert.match(cleanupLink.href, /\/backtests$/);
  });

  it('exhausted retained strategies cap points to retention cleanup instead of more trashing', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        strategiesUsed: 1,
        strategiesMax: 3,
        retainedStrategiesUsed: 9,
        retainedStrategiesMax: 9,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'exhausted');
    assert.equal(status.bottlenecks[0].resource, 'retainedStrategies');
    assert.deepEqual(status.nextSteps, [
      'Wait for the 30-day Trash retention cleanup to permanently purge old strategies.',
      'Upgrade the workspace plan for more retained strategy capacity.',
    ]);
  });

  it('count limit near cap stays silent until fully exhausted', () => {
    // Hard count caps are sharp cliffs, not slopes; "running low" warnings on
    // tiny caps (e.g. free tier max=3) read as alarmist while the user can do
    // nothing partial about them. Only the final hit surfaces.
    const nearCap = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        strategiesUsed: 28,
        strategiesMax: 30,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(nearCap.level, 'ok');
    assert.deepEqual(nearCap.bottlenecks, []);

    const lastSlot = summarizeUsageHints({
      usage: usage({
        used: 0.1,
        total: 1,
        strategiesUsed: 2,
        strategiesMax: 3,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(lastSlot.level, 'ok');
    assert.deepEqual(lastSlot.bottlenecks, []);
  });

  it('mixed bottlenecks order cleanup before upgrade and dedupe links', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.96,
        total: 1,
        strategiesUsed: 3,
        strategiesMax: 3,
        savedUsed: 10,
        savedMax: 10,
      }),
      workspace: freeWorkspace(),
    });
    assert.equal(status.level, 'exhausted');
    assert.deepEqual(status.nextSteps, [
      'Move unused active strategies to Trash using trash_strategy with confirm=true.',
      'Delete old saved results that are no longer needed.',
      'Wait for the next billing period to reset, or upgrade the workspace plan for more research credits.',
      'Upgrade the workspace plan for more strategy capacity.',
      'Upgrade the workspace plan for more saved result capacity.',
    ]);
    // Both cleanup deeplinks must be present, plus usage and billing_plan, with no duplicates.
    const rels = status.links.map((link) => link.rel);
    assert.deepEqual(rels, [
      'manage_strategies',
      'manage_backtests',
      'usage',
      'billing_plan',
    ]);
  });

  it('omits the billing-plan link on team tier (already top tier) but still shows cleanup links', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.99,
        total: 1,
        strategiesUsed: 100,
        strategiesMax: 100,
      }),
      workspace: teamWorkspace(),
    });
    assert.equal(status.tier, 'team');
    assert.equal(status.level, 'exhausted');
    assert.ok(
      !status.links.some((link) => link.rel === 'billing_plan'),
      'team tier should not be offered a billing_plan upgrade link',
    );
    assert.ok(status.links.some((link) => link.rel === 'usage'));
    assert.ok(status.links.some((link) => link.rel === 'manage_strategies'));
  });

  it('targets plus tier when current tier is unknown', () => {
    const status = summarizeUsageHints({
      usage: usage({ used: 0.99, total: 1 }),
      workspace: { subscription: {} },
    });
    assert.equal(status.tier, 'unknown');
    const planLink = status.links.find((link) => link.rel === 'billing_plan');
    assert.ok(planLink);
    assert.match(planLink.href, /targetTier=plus/);
  });

  it('returns ok when usage payload is missing or malformed', () => {
    assert.equal(
      summarizeUsageHints({ usage: undefined, workspace: freeWorkspace() })
        .level,
      'ok',
    );
    assert.equal(
      summarizeUsageHints({ usage: null, workspace: freeWorkspace() }).level,
      'ok',
    );
    assert.equal(
      summarizeUsageHints({
        usage: { budget: { totalUsd: 0, usedUsd: 0 } },
        workspace: freeWorkspace(),
      }).level,
      'ok',
    );
  });

  it('renders a Workspace Usage section with status, bottlenecks, nextSteps, and links', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.92,
        total: 1,
        strategiesUsed: 3,
        strategiesMax: 3,
        savedUsed: 10,
        savedMax: 10,
      }),
      workspace: freeWorkspace(),
    });
    const lines = renderUsageStatusMarkdown(status);
    const text = lines.join('\n');
    assert.match(text, /## Workspace Usage/);
    assert.match(text, /tier: free/);
    assert.match(text, /strategies 3 \/ 3/);
    assert.match(text, /saved results 10 \/ 10/);
    assert.match(text, /\*\*Next steps:\*\*/);
    assert.match(
      text,
      /Move unused active strategies to Trash using trash_strategy with confirm=true\./,
    );
    assert.match(text, /Delete old saved results that are no longer needed\./);
    assert.match(text, /Compare workspace plans/);
    assert.match(text, /Manage strategies/);
    assert.match(text, /Manage saved backtests/);
    assert.match(text, /Review workspace usage/);
  });

  it('builds deeplinks against manifest.appBaseUrl when provided (per-environment correctness)', () => {
    const status = summarizeUsageHints({
      usage: usage({
        used: 0.96,
        total: 1,
        strategiesUsed: 3,
        strategiesMax: 3,
        savedUsed: 10,
        savedMax: 10,
      }),
      workspace: freeWorkspace(),
      // Use a host distinct from the hardcoded fallback so a regression that
      // ignores the manifest would surface here instead of accidentally passing.
      manifest: { appBaseUrl: 'https://alpha.traseq.com/' },
    });
    for (const link of status.links) {
      assert.match(
        link.href,
        /^https:\/\/alpha\.traseq\.com\//,
        `link ${link.rel} should follow manifest.appBaseUrl, got ${link.href}`,
      );
    }
    const planLink = status.links.find((link) => link.rel === 'billing_plan');
    assert.match(
      planLink.href,
      /^https:\/\/alpha\.traseq\.com\/settings\/billing\/plan\?/,
    );
  });

  it('falls back to the hardcoded base URL when manifest is absent or omits appBaseUrl', () => {
    const exhausted = summarizeUsageHints({
      usage: usage({ used: 0.99, total: 1 }),
      workspace: freeWorkspace(),
    });
    for (const link of exhausted.links) {
      assert.match(link.href, /^https:\/\/app\.traseq\.com\//);
    }

    const empty = summarizeUsageHints({
      usage: usage({ used: 0.99, total: 1 }),
      workspace: freeWorkspace(),
      manifest: { appBaseUrl: '   ' }, // whitespace-only — treat as absent
    });
    for (const link of empty.links) {
      assert.match(link.href, /^https:\/\/app\.traseq\.com\//);
    }
  });

  it('rejects non-http(s) appBaseUrl schemes and falls back (defense-in-depth)', () => {
    // A misconfigured server emitting `javascript:` / `file:` / a non-URL
    // string must not land in user-facing link.href values.
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://example.com',
      'not a url',
    ]) {
      const status = summarizeUsageHints({
        usage: usage({ used: 0.99, total: 1 }),
        workspace: freeWorkspace(),
        manifest: { appBaseUrl: bad },
      });
      for (const link of status.links) {
        assert.match(
          link.href,
          /^https:\/\/app\.traseq\.com\//,
          `bad appBaseUrl ${JSON.stringify(bad)} must fall back, got ${link.href}`,
        );
      }
    }
  });
});
