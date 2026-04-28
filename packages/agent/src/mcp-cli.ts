#!/usr/bin/env node
import { TraseqApiError, formatTraseqAgentError } from '@traseq/sdk';
import { startMcpServer } from './mcp/index.js';

function reportFatal(error: unknown): never {
  const message =
    error instanceof TraseqApiError
      ? formatTraseqAgentError(error)
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

try {
  startMcpServer();
} catch (error) {
  reportFatal(error);
}

process.on('uncaughtException', reportFatal);
process.on('unhandledRejection', reportFatal);
