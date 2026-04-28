import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  requireEnv,
  TRASEQ_API_KEY_SETUP_HELP,
  TRASEQ_API_KEY_SETUP_URL,
} from '../dist/index.js';

function withoutEnv(name, callback) {
  const previous = process.env[name];
  try {
    delete process.env[name];
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

function runCli(args, envOverrides = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...envOverrides };
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) {
        delete env[key];
      }
    }

    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('..', import.meta.url),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('environment onboarding help', () => {
  it('guides missing TRASEQ_API_KEY users to start with the free tier', () => {
    withoutEnv('TRASEQ_API_KEY', () => {
      assert.throws(
        () => requireEnv('TRASEQ_API_KEY'),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Missing TRASEQ_API_KEY/);
          assert.match(error.message, /Start with the free tier/);
          assert.match(
            error.message,
            /\/login\?redirectTo=%2Fsettings%2Fapi-keys/,
          );
          assert.match(error.message, /entry_surface=agent_cli/);
          assert.match(error.message, /entry_source=missing_traseq_api_key/);
          assert.match(error.message, /cta_id=start_with_free_tier/);
          assert.doesNotMatch(error.message, /agent trial/i);
          return true;
        },
      );
    });

    assert.match(TRASEQ_API_KEY_SETUP_HELP, /Start with the free tier/);
    assert.match(TRASEQ_API_KEY_SETUP_HELP, /create a workspace API key/);
    assert.ok(
      TRASEQ_API_KEY_SETUP_URL.includes(
        '/login?redirectTo=%2Fsettings%2Fapi-keys',
      ),
    );
    assert.doesNotMatch(TRASEQ_API_KEY_SETUP_HELP, /agent trial/i);
  });

  it('keeps non-Traseq required env failures generic', () => {
    withoutEnv('OTHER_REQUIRED_ENV', () => {
      assert.throws(
        () => requireEnv('OTHER_REQUIRED_ENV'),
        /^Error: OTHER_REQUIRED_ENV is required\.$/,
      );
    });
  });

  it('prints free tier guidance from check-env when TRASEQ_API_KEY is missing', async () => {
    const result = await runCli(['check-env'], {
      TRASEQ_API_KEY: undefined,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.code, 0);
    assert.match(output, /Start with the free tier/);
    assert.match(output, /\/login\?redirectTo=%2Fsettings%2Fapi-keys/);
    assert.match(output, /entry_surface=agent_cli/);
    assert.match(output, /entry_source=missing_traseq_api_key/);
    assert.match(output, /cta_id=start_with_free_tier/);
    assert.doesNotMatch(output, /agent trial/i);
  });
});
