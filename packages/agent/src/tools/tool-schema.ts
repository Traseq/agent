import { OPERATION_REGISTRY } from '../generated/operation-registry.js';

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly endpoint: {
    readonly method: string;
    readonly path: string;
  };
  readonly input_schema: Record<string, unknown>;
  readonly destructive?: boolean;
  readonly longRunning?: boolean;
}

export function getToolDefinitions(): readonly ToolDefinition[] {
  return OPERATION_REGISTRY as readonly ToolDefinition[];
}
