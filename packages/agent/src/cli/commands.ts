import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

import { TraseqClient } from '@traseq/sdk';

import {
  DEFAULT_BASE_URL,
  DEFAULT_SERVER_NAME,
  getWriter,
  parseTarget,
  resolveDefaultInputs,
  redactEntry,
  type InstallTarget,
} from '../install/index.js';
import { packagePin, packageVersion } from '../install/version.js';
import { probeTraseqMcpSetup } from '../mcp/probe.js';
import {
  DEFAULT_SECRET_REF,
  formatSecretRef,
  getDefaultSecretStore,
  parseSecretRef,
  type SecretRef,
} from '../secrets/index.js';
import {
  defaultDoctorContext,
  runDoctor,
  type CheckStatus,
  type DoctorCheckResult,
} from '../doctor/index.js';
import { TRASEQ_API_KEY_SETUP_URL, TRASEQ_APP_URL } from '../env.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function exec(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolveExec, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) =>
      resolveExec({ exitCode: exitCode ?? -1, stdout, stderr }),
    );
  });
}

function statusGlyph(status: CheckStatus): string {
  return status === 'green' ? '✓' : status === 'yellow' ? '!' : '✗';
}

function printResults(results: DoctorCheckResult[]): void {
  for (const r of results) {
    const head = `${statusGlyph(r.status)} [${r.status.toUpperCase()}] ${r.title}`;
    process.stdout.write(`${head}\n`);
    process.stdout.write(`    ${r.detail.split('\n').join('\n    ')}\n`);
    if (r.fix) {
      process.stdout.write(`    fix: ${r.fix}\n`);
    }
  }
}

function exitCodeFromResults(results: DoctorCheckResult[]): number {
  return results.some((r) => r.status === 'red') ? 1 : 0;
}

interface ParsedFlags {
  values: Record<string, string | boolean>;
  positional: string[];
}

function parseSubcommandArgs(argv: readonly string[]): ParsedFlags {
  const values: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        values[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          values[key] = true;
        } else {
          values[key] = next;
          i++;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { values, positional };
}

function readFlag(flags: ParsedFlags, key: string): string | undefined {
  const v = flags.values[key];
  return typeof v === 'string' ? v : undefined;
}

function readBool(flags: ParsedFlags, key: string): boolean {
  return flags.values[key] === true || flags.values[key] === 'true';
}

function resolveSecretRefFromFlags(flags: ParsedFlags): SecretRef {
  const ref = readFlag(flags, 'secret-ref');
  if (ref) return parseSecretRef(ref);
  return DEFAULT_SECRET_REF;
}

async function promptApiKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Cannot prompt for API key in a non-TTY shell. Pass --api-key or set TRASEQ_API_KEY in the environment.\nGet a key: ${TRASEQ_API_KEY_SETUP_URL}`,
    );
  }
  process.stderr.write(
    `Create or rotate a workspace API key here:\n  ${TRASEQ_API_KEY_SETUP_URL}\n\n`,
  );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question('Paste your TRASEQ_API_KEY: ');
  rl.close();
  return answer.trim();
}

async function probeApiKey(apiKey: string, baseUrl: string): Promise<void> {
  const client = new TraseqClient({ apiKey, baseUrl });
  await probeTraseqMcpSetup({
    client: {
      getManifest: () => client.getManifest(),
      getWorkspaceContext: () => client.getWorkspaceContext(),
      getUsage: () => client.getUsage(),
      getCapabilities: () => client.getCapabilities(),
    },
  });
}

export async function runLoginCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const store = readFlag(flags, 'store') ?? 'keychain';
  const baseUrl = readFlag(flags, 'base-url') ?? DEFAULT_BASE_URL;
  const apiKey = readFlag(flags, 'api-key') ?? (await promptApiKey());
  if (apiKey.length === 0) {
    process.stderr.write(
      `Empty API key. Aborting.\nGet a key: ${TRASEQ_API_KEY_SETUP_URL}\n`,
    );
    return 1;
  }
  process.stderr.write('Probing API key...\n');
  try {
    await probeApiKey(apiKey, baseUrl);
  } catch (error) {
    process.stderr.write(
      `API probe failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  if (store === 'env') {
    process.stdout.write(
      `API key validated. To persist for future shells, append this to your shell rc:\n\n  export TRASEQ_API_KEY="${apiKey}"\n\nOpen your Traseq workspace: ${TRASEQ_APP_URL}\n`,
    );
    return 0;
  }
  if (store === 'inline') {
    process.stdout.write(
      `API key validated. (--store=inline does not persist; pass --inline to install commands as needed.)\nOpen your Traseq workspace: ${TRASEQ_APP_URL}\n`,
    );
    return 0;
  }
  const ks = getDefaultSecretStore();
  const availability = await ks.available();
  if (!availability.ok) {
    process.stderr.write(
      `Keychain unavailable: ${availability.reason ?? 'unknown'}.\nFalling back to env hint.\n\n  export TRASEQ_API_KEY="${apiKey}"\n\nOpen your Traseq workspace: ${TRASEQ_APP_URL}\n`,
    );
    return 2;
  }
  await ks.set(DEFAULT_SECRET_REF.service, DEFAULT_SECRET_REF.account, apiKey);
  process.stdout.write(
    `API key stored at ${formatSecretRef(DEFAULT_SECRET_REF)} (${ks.kind}).\nOpen your Traseq workspace: ${TRASEQ_APP_URL}\n`,
  );
  return 0;
}

export async function runLogoutCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const store = readFlag(flags, 'store') ?? 'keychain';
  if (store !== 'keychain') {
    process.stderr.write(
      'Only `--store=keychain` is supported for logout. Remove env vars from your shell rc manually.\n',
    );
    return 1;
  }
  const ks = getDefaultSecretStore();
  const availability = await ks.available();
  if (!availability.ok) {
    process.stderr.write(`Keychain unavailable: ${availability.reason}\n`);
    return 2;
  }
  await ks.delete(DEFAULT_SECRET_REF.service, DEFAULT_SECRET_REF.account);
  process.stdout.write(
    `Removed ${formatSecretRef(DEFAULT_SECRET_REF)} from ${ks.kind}.\n`,
  );
  return 0;
}

interface InstallFlags {
  target: InstallTarget;
  serverName: string;
  secretRef: SecretRef;
  inline?: string;
  baseUrl: string;
  packageVersion?: string;
  acknowledgeShared: boolean;
  dryRun: boolean;
  profile: 'guided' | 'full';
}

function parseInstallFlags(argv: readonly string[]): InstallFlags {
  const flags = parseSubcommandArgs(argv);
  const targetSpec = readFlag(flags, 'target');
  if (!targetSpec) {
    throw new Error(
      'Missing --target=<client>:<location>. Examples: claude-code:user, claude-desktop:user, codex:user, file:./mcp.json, file:-',
    );
  }
  const target = parseTarget(targetSpec);
  const inline = readBool(flags, 'inline')
    ? (process.env.TRASEQ_API_KEY ?? readFlag(flags, 'api-key'))
    : readFlag(flags, 'inline-value');
  return {
    target,
    serverName: readFlag(flags, 'server-name') ?? DEFAULT_SERVER_NAME,
    secretRef: resolveSecretRefFromFlags(flags),
    ...(inline !== undefined ? { inline } : {}),
    baseUrl: readFlag(flags, 'base-url') ?? DEFAULT_BASE_URL,
    ...(readFlag(flags, 'package-version') !== undefined
      ? { packageVersion: readFlag(flags, 'package-version')! }
      : {}),
    acknowledgeShared: readBool(flags, 'i-know-this-is-shared'),
    dryRun: readBool(flags, 'dry-run'),
    profile: readFlag(flags, 'profile') === 'full' ? 'full' : 'guided',
  };
}

export async function runInstallCommand(
  argv: readonly string[],
): Promise<number> {
  let flags: InstallFlags;
  try {
    flags = parseInstallFlags(argv);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const writer = getWriter(flags.target);
  const input = resolveDefaultInputs(flags.target, {
    serverName: flags.serverName,
    secretRef: flags.secretRef,
    baseUrl: flags.baseUrl,
    ...(flags.inline !== undefined ? { inline: flags.inline } : {}),
    ...(flags.packageVersion !== undefined
      ? { packageVersion: flags.packageVersion }
      : {}),
    acknowledgeShared: flags.acknowledgeShared,
    profile: flags.profile,
  });

  const plan = writer.plan(input);
  process.stderr.write(
    `Plan for ${flags.target.raw}:\n  command: ${plan.entry.command} ${plan.entry.args.join(' ')}\n`,
  );
  const redacted = redactEntry(plan.entry);
  process.stderr.write(`  env: ${JSON.stringify(redacted.env)}\n`);
  if (plan.warnings.length > 0) {
    for (const w of plan.warnings) process.stderr.write(`  warn: ${w}\n`);
  }
  if (flags.dryRun) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return 0;
  }

  const detect = await writer.detect();
  if (!detect.present) {
    process.stderr.write(
      `${flags.target.client} not present: ${detect.reason ?? 'unknown reason'}\n`,
    );
    return 2;
  }

  const result = await writer.apply(plan);
  if (result.writeTarget) {
    process.stdout.write(`Wrote ${result.writeTarget}\n`);
  }
  for (const f of result.followups) process.stdout.write(`Next: ${f}\n`);
  return 0;
}

export async function runUninstallCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const targetSpec = readFlag(flags, 'target');
  if (!targetSpec) {
    process.stderr.write('Missing --target=<client>:<location>.\n');
    return 1;
  }
  const target = parseTarget(targetSpec);
  const serverName = readFlag(flags, 'server-name') ?? DEFAULT_SERVER_NAME;
  const writer = getWriter(target);
  await writer.remove({ target, serverName });
  process.stdout.write(`Removed ${serverName} from ${target.raw}.\n`);
  return 0;
}

export async function runUpgradeCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const cacheDir = await exec('npm', ['config', 'get', 'cache']);
  if (cacheDir.exitCode === 0) {
    const npxPath = join(cacheDir.stdout.trim(), '_npx');
    process.stderr.write(`Clearing npx cache at ${npxPath}...\n`);
    try {
      rmSync(npxPath, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `npx cache clear warning: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  const pkgVersion = readFlag(flags, 'package-version');
  process.stdout.write(
    `Pinning to ${packagePin(pkgVersion)} (this binary is ${packageVersion()}).\n`,
  );
  process.stdout.write(
    'Re-run `traseq-agent install --target=<...>` for each MCP client to repin and reinstall.\n',
  );
  return 0;
}

export async function runDoctorCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const ctx = defaultDoctorContext({
    serverName: readFlag(flags, 'server-name') ?? DEFAULT_SERVER_NAME,
    secretRef: readFlag(flags, 'secret-ref')
      ? parseSecretRef(readFlag(flags, 'secret-ref')!)
      : DEFAULT_SECRET_REF,
    ...(readFlag(flags, 'api-key') !== undefined
      ? { apiKeyOverride: readFlag(flags, 'api-key')! }
      : {}),
    ...(readFlag(flags, 'base-url') !== undefined
      ? { baseUrl: readFlag(flags, 'base-url')! }
      : {}),
    ...(readFlag(flags, 'timeout') !== undefined
      ? { handshakeTimeoutMs: Number(readFlag(flags, 'timeout')) }
      : {}),
  });
  const results = await runDoctor(ctx);
  if (readBool(flags, 'json')) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    printResults(results);
  }
  if (readBool(flags, 'fix')) {
    process.stderr.write(
      '\n--fix is interactive; not yet automated for v0.2.0. Use the suggested commands above.\n',
    );
  }
  return exitCodeFromResults(results);
}

export async function runPrintConfigCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSubcommandArgs(argv);
  const targetSpec = readFlag(flags, 'target') ?? 'file:-';
  const newArgv = [
    ...argv.filter((a) => !a.startsWith('--target')),
    `--target=${targetSpec}`,
    '--dry-run',
  ];
  return runInstallCommand(newArgv);
}

export async function runMcpServer(): Promise<number> {
  const { startMcpServer } = await import('../mcp/server.js');
  await startMcpServer();
  return 0;
}

void homedir;
